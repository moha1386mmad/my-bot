// ============================================
// ربات مدیریت ورکرهای کلادفلر - نسخه نهایی
// منبع کدها: https://github.com/moha1386mmad/my-bot
// ============================================

const WEBHOOK_PATH = "/webhook";

// خواندن کد worker.js از ریپازیتوری گیت‌هاب (لینک مستقیم شما)
async function getWorkerCode() {
    const response = await fetch("https://raw.githubusercontent.com/moha1386mmad/my-bot/main/worker.js");
    if (!response.ok) {
        throw new Error(`Failed to fetch worker code from GitHub: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

// ============================================
// توابع کمکی و اعتبارسنجی
// ============================================
function isValidWorkerName(name) {
    return /^[a-zA-Z0-9\-]+$/.test(name);
}

function isValidUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

async function sendMessage(chatId, text, token, parseMode = "HTML") {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: text, 
            parse_mode: parseMode, 
            disable_web_page_preview: true 
        })
    });
}

async function sendKeyboard(chatId, text, keyboard, token) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
            chat_id: chatId, 
            text: text, 
            reply_markup: { inline_keyboard: keyboard }, 
            parse_mode: "HTML" 
        })
    });
}

// ============================================
// توابع مدیریت وضعیت در KV
// ============================================
async function setUserState(kv, userId, state) {
    await kv.put(`user:${userId}:state`, JSON.stringify(state));
}

async function getUserState(kv, userId) {
    const data = await kv.get(`user:${userId}:state`, "json");
    return data || { step: "idle", data: {} };
}

async function clearUserState(kv, userId) {
    await kv.delete(`user:${userId}:state`);
}

async function getAccounts(kv, userId) {
    const data = await kv.get(`user:${userId}:accounts`, "json");
    return data || [];
}

async function addAccount(kv, userId, accountId, apiToken, name = null) {
    const accounts = await getAccounts(kv, userId);
    const accountName = name || `ac${accounts.length + 1}`;
    accounts.push({ 
        id: accountId, 
        token: apiToken, 
        name: accountName, 
        created: Date.now() 
    });
    await kv.put(`user:${userId}:accounts`, JSON.stringify(accounts));
    return accountName;
}

async function getAccount(kv, userId, accountName) {
    const accounts = await getAccounts(kv, userId);
    return accounts.find(acc => acc.name === accountName);
}

async function deleteAccount(kv, userId, accountName) {
    const accounts = await getAccounts(kv, userId);
    const filtered = accounts.filter(acc => acc.name !== accountName);
    await kv.put(`user:${userId}:accounts`, JSON.stringify(filtered));
}

// ============================================
// توابع ارتباط با API کلادفلر
// ============================================
async function createWorker(accountId, apiToken, scriptName, workerCode) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
    const response = await fetch(url, {
        method: "PUT",
        headers: { 
            "Authorization": `Bearer ${apiToken}`, 
            "Content-Type": "application/javascript" 
        },
        body: workerCode
    });
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.errors?.[0]?.message || "Failed to create worker");
    }
    return result;
}

async function createKVNamespace(accountId, apiToken, title) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`;
    const response = await fetch(url, {
        method: "POST",
        headers: { 
            "Authorization": `Bearer ${apiToken}`, 
            "Content-Type": "application/json" 
        },
        body: JSON.stringify({ title })
    });
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.errors?.[0]?.message || "Failed to create KV namespace");
    }
    return result.result;
}

async function createKVBinding(accountId, apiToken, scriptName, kvNamespaceId) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/bindings`;
    const response = await fetch(url, {
        method: "PUT",
        headers: { 
            "Authorization": `Bearer ${apiToken}`, 
            "Content-Type": "application/json" 
        },
        body: JSON.stringify({ 
            bindings: [{ 
                name: "kv", 
                type: "kv_namespace", 
                namespace_id: kvNamespaceId 
            }] 
        })
    });
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.errors?.[0]?.message || "Failed to create binding");
    }
    return result;
}

async function updateWorkerVariables(accountId, apiToken, scriptName, variables) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`;
    for (const [key, value] of Object.entries(variables)) {
        const response = await fetch(url, {
            method: "PUT",
            headers: { 
                "Authorization": `Bearer ${apiToken}`, 
                "Content-Type": "application/json" 
            },
            body: JSON.stringify({ 
                name: key, 
                text: value, 
                type: "plain_text" 
            })
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(`Failed to set variable ${key}: ${result.errors?.[0]?.message}`);
        }
    }
    return true;
}

async function getWorkerUrl(accountId, scriptName) {
    return `https://${scriptName}.${accountId}.workers.dev`;
}

// ============================================
// مدیریت دستورات ربات
// ============================================
async function handleStart(chatId, kv, token) {
    await clearUserState(kv, chatId);
    const text = `🚀 **به ربات مدیریت ورکرهای کلادفلر خوش آمدید!**

✅ **قابلیت‌ها:**
• ثبت و مدیریت چندین اکانت کلادفلر
• ساخت Worker جدید با کد سفارشی
• مدیریت KV Namespace و Binding

⚠️ **توکن API نیاز به دسترسی:**  
Workers Scripts: Edit و Workers KV: Edit

🔰 **برای شروع، یکی از گزینه‌های زیر را انتخاب کنید:**`;

    const keyboard = [[
        { text: "➕ ثبت اکانت جدید", callback_data: "add_account" },
        { text: "📋 لیست اکانت‌ها", callback_data: "list_accounts" }
    ]];
    await sendKeyboard(chatId, text, keyboard, token);
}

async function handleAddAccount(chatId, kv, token, text = null) {
    const state = await getUserState(kv, chatId);
    
    if (state.step === "idle") {
        await setUserState(kv, chatId, { step: "awaiting_account_id", data: {} });
        await sendMessage(chatId, "📝 لطفاً **Account ID** خود را ارسال کنید:\n\n(از Cloudflare Dashboard > Workers & Pages پیدا می‌شود)", token);
        return;
    }
    
    if (state.step === "awaiting_account_id" && text) {
        state.data.accountId = text.trim();
        state.step = "awaiting_api_token";
        await setUserState(kv, chatId, state);
        await sendMessage(chatId, "🔑 لطفاً **API Token** خود را ارسال کنید:\n\n(حداقل دسترسی‌های Workers Scripts: Edit و Workers KV: Edit)", token);
        return;
    }
    
    if (state.step === "awaiting_api_token" && text) {
        state.data.apiToken = text.trim();
        state.step = "awaiting_account_name";
        await setUserState(kv, chatId, state);
        
        const keyboard = [[{ text: "🔘 استفاده از نام پیش‌فرض", callback_data: "use_default_name" }]];
        await sendKeyboard(chatId, "🏷️ یک نام برای این اکانت وارد کنید:\n(فقط حروف انگلیسی، اعداد و خط تیره)", keyboard, token);
        return;
    }
    
    if (state.step === "awaiting_account_name" && text) {
        if (!isValidWorkerName(text)) {
            await sendMessage(chatId, "❌ نام معتبر نیست! فقط از حروف انگلیسی، اعداد و خط تیره (-) استفاده کنید.", token);
            return;
        }
        const accountName = await addAccount(kv, chatId, state.data.accountId, state.data.apiToken, text);
        await clearUserState(kv, chatId);
        await sendMessage(chatId, `✅ اکانت **${accountName}** با موفقیت ثبت شد!`, token);
        await handleStart(chatId, kv, token);
    }
}

async function handleListAccounts(chatId, kv, token) {
    const accounts = await getAccounts(kv, chatId);
    if (accounts.length === 0) {
        await sendMessage(chatId, "❌ هیچ اکانتی ثبت نشده است!\n\nاز دکمه «ثبت اکانت جدید» استفاده کنید.", token);
        return;
    }
    
    let text = "📋 **لیست اکانت‌های شما:**\n\n";
    const keyboard = [];
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        text += `${i+1}. **${acc.name}**\n🆔 \`${acc.id.substring(0, 20)}...\`\n📅 ${new Date(acc.created).toLocaleDateString("fa-IR")}\n\n`;
        keyboard.push([{ text: `📁 ${acc.name}`, callback_data: `select:${acc.name}` }]);
    }
    keyboard.push([{ text: "🔙 بازگشت به منوی اصلی", callback_data: "back" }]);
    await sendKeyboard(chatId, text, keyboard, token);
}

async function handleSelectAccount(chatId, kv, token, accountName) {
    const account = await getAccount(kv, chatId, accountName);
    if (!account) {
        await sendMessage(chatId, "❌ اکانت مورد نظر یافت نشد!", token);
        return;
    }
    
    await setUserState(kv, chatId, { 
        step: "selected", 
        data: { 
            accountName: account.name, 
            accountId: account.id, 
            apiToken: account.token 
        } 
    });
    
    const text = `🗂️ **اکانت انتخاب شده:** ${account.name}\n🆔 \`${account.id.substring(0, 30)}...\`\n\n🔧 **عملیات موجود:**`;
    const keyboard = [
        [{ text: "➕ ساخت Worker جدید", callback_data: "create_worker" }],
        [{ text: "🗑️ حذف این اکانت", callback_data: "del_account" }],
        [{ text: "🔙 بازگشت به لیست", callback_data: "list_accounts" }]
    ];
    await sendKeyboard(chatId, text, keyboard, token);
}

async function handleCreateWorker(chatId, kv, token, userText = null) {
    const state = await getUserState(kv, chatId);
    const account = await getAccount(kv, chatId, state.data?.accountName);
    
    if (!account) {
        await sendMessage(chatId, "❌ اکانت یافت نشد! لطفاً دوباره انتخاب کنید.", token);
        return;
    }
    
    if (state.step === "selected") {
        await setUserState(kv, chatId, { 
            step: "awaiting_worker_name", 
            data: { 
                accountName: account.name, 
                accountId: account.id, 
                apiToken: account.token 
            } 
        });
        await sendMessage(chatId, "✏️ **نام Worker** خود را وارد کنید:\n\n(فقط حروف انگلیسی، اعداد و خط تیره - مثال: my-worker)", token);
        return;
    }
    
    if (state.step === "awaiting_worker_name" && userText) {
        if (!isValidWorkerName(userText)) {
            await sendMessage(chatId, "❌ نام معتبر نیست! فقط از حروف انگلیسی، اعداد و خط تیره (-) استفاده کنید.", token);
            return;
        }
        
        state.data.workerName = userText;
        state.step = "awaiting_variables";
        await setUserState(kv, chatId, state);
        await sendMessage(chatId, `⚙️ **متغیرهای مورد نیاز** را ارسال کنید:

\`\`\`
UUID=your-uuid-here
TR_PASS=your-password
SUB_PATH=your-subpath
\`\`\`

**مثال:**
\`\`\`
UUID=ccb3f592-ee67-4308-99b1-88ca3b065865
TR_PASS=1SFlA8Sv8KDR<9X^
SUB_PATH=wgY_A_Z0@wOlr70u
\`\`\`

⚠️ UUID باید معتبر باشد.`, token);
        return;
    }
    
    if (state.step === "awaiting_variables" && userText) {
        const lines = userText.split("\n");
        const vars = {};
        for (const line of lines) {
            const match = line.match(/^([A-Z_]+)=(.*)$/);
            if (match) vars[match[1]] = match[2].trim();
        }
        
        if (!vars.UUID || !vars.TR_PASS || !vars.SUB_PATH) {
            await sendMessage(chatId, "❌ هر سه متغیر **UUID**، **TR_PASS** و **SUB_PATH** الزامی هستند!", token);
            return;
        }
        
        if (!isValidUUID(vars.UUID)) {
            await sendMessage(chatId, "❌ **UUID** معتبر نیست! لطفاً یک UUID صحیح ارسال کنید.\n\nمثال: 550e8400-e29b-41d4-a716-446655440000", token);
            return;
        }
        
        await sendMessage(chatId, "🔄 **در حال ساخت Worker...** ⏳\nاین فرایند چند لحظه طول می‌کشد.", token);
        
        try {
            // مرحله 1: گرفتن کد worker.js از گیت‌هاب
            const workerCode = await getWorkerCode();
            await sendMessage(chatId, "✅ **مرحله 1/5:** کد Worker از گیت‌هاب دریافت شد.", token);
            
            // مرحله 2: ساخت Worker
            await createWorker(state.data.accountId, state.data.apiToken, state.data.workerName, workerCode);
            await sendMessage(chatId, "✅ **مرحله 2/5:** Worker با موفقیت ساخته شد.", token);
            
            // مرحله 3: ساخت KV Namespace
            const kvNs = await createKVNamespace(state.data.accountId, state.data.apiToken, `kv-${state.data.workerName}`);
            await sendMessage(chatId, `✅ **مرحله 3/5:** KV Namespace ساخته شد.`, token);
            
            // مرحله 4: ایجاد Binding
            await createKVBinding(state.data.accountId, state.data.apiToken, state.data.workerName, kvNs.id);
            await sendMessage(chatId, "✅ **مرحله 4/5:** Binding KV با موفقیت انجام شد.", token);
            
            // مرحله 5: اضافه کردن متغیرها
            await updateWorkerVariables(state.data.accountId, state.data.apiToken, state.data.workerName, vars);
            await sendMessage(chatId, "✅ **مرحله 5/5:** متغیرهای محیطی اضافه شدند.", token);
            
            // گرفتن لینک نهایی
            const url = await getWorkerUrl(state.data.accountId, state.data.workerName);
            await clearUserState(kv, chatId);
            
            const finalMessage = `🎉 **Worker با موفقیت ساخته شد!**

🔗 **لینک Worker:**  
\`${url}\`

📁 **لینک پنل مدیریت:**  
\`${url}/panel\`

📊 **متغیرهای تنظیم شده:**
• UUID: \`${vars.UUID}\`
• TR_PASS: \`${vars.TR_PASS}\`
• SUB_PATH: \`${vars.SUB_PATH}\`

✅ Worker شما آماده استفاده است.`;
            await sendMessage(chatId, finalMessage, token);
            
        } catch (error) {
            console.error("Create worker error:", error);
            await sendMessage(chatId, `❌ **خطا در ساخت Worker:**\n\n\`${error.message}\`\n\nلطفاً اطلاعات را بررسی کنید و دوباره تلاش نمایید.`, token);
        }
    }
}

async function handleDeleteSelected(chatId, kv, token) {
    const state = await getUserState(kv, chatId);
    if (state.data?.accountName) {
        await deleteAccount(kv, chatId, state.data.accountName);
        await clearUserState(kv, chatId);
        await sendMessage(chatId, `✅ اکانت **${state.data.accountName}** با موفقیت حذف شد!`, token);
    }
    await handleStart(chatId, kv, token);
}

// ============================================
// مدیریت دکمه‌های شیشه‌ای (Callback)
// ============================================
async function handleCallback(chatId, callbackData, kv, token) {
    console.log(`Callback received: ${callbackData} from chat ${chatId}`);
    
    if (callbackData === "add_account") {
        await handleAddAccount(chatId, kv, token);
    } 
    else if (callbackData === "list_accounts") {
        await handleListAccounts(chatId, kv, token);
    } 
    else if (callbackData === "back") {
        await handleStart(chatId, kv, token);
    } 
    else if (callbackData === "create_worker") {
        await handleCreateWorker(chatId, kv, token);
    } 
    else if (callbackData === "del_account") {
        await handleDeleteSelected(chatId, kv, token);
    } 
    else if (callbackData === "use_default_name") {
        const state = await getUserState(kv, chatId);
        const defaultName = `ac${Math.floor(Math.random() * 1000) + 1}`;
        await addAccount(kv, chatId, state.data.accountId, state.data.apiToken, defaultName);
        await clearUserState(kv, chatId);
        await sendMessage(chatId, `✅ اکانت با نام پیش‌فرض **${defaultName}** ثبت شد!`, token);
        await handleStart(chatId, kv, token);
    }
    else if (callbackData.startsWith("select:")) {
        const accountName = callbackData.split(":")[1];
        await handleSelectAccount(chatId, kv, token, accountName);
    }
    else {
        await sendMessage(chatId, "❌ دستور نامعتبر! لطفاً از دکمه‌های منو استفاده کنید.", token);
    }
}

// ============================================
// Main Worker Handler - ورودی اصلی
// ============================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const token = env.TELEGRAM_TOKEN;
        
        // بررسی وجود توکن
        if (!token) {
            console.error("TELEGRAM_TOKEN not set!");
            return new Response("❌ TELEGRAM_TOKEN not set! Please add it as an environment variable.", { status: 500 });
        }
        
        // ============================================
        // Webhook endpoint برای دریافت پیام‌های تلگرام
        // ============================================
        if (url.pathname === WEBHOOK_PATH && request.method === "POST") {
            try {
                const body = await request.json();
                console.log("Webhook received:", JSON.stringify(body).substring(0, 200));
                
                // پاسخ به پیام‌های متنی
                if (body.message) {
                    const chatId = body.message.chat.id;
                    const text = body.message.text;
                    
                    if (text === "/start") {
                        await handleStart(chatId, env.KV_ACCOUNTS, token);
                    } else {
                        const state = await getUserState(env.KV_ACCOUNTS, chatId);
                        if (["awaiting_account_id", "awaiting_api_token", "awaiting_account_name"].includes(state.step)) {
                            await handleAddAccount(chatId, env.KV_ACCOUNTS, token, text);
                        } else if (["awaiting_worker_name", "awaiting_variables"].includes(state.step)) {
                            await handleCreateWorker(chatId, env.KV_ACCOUNTS, token, text);
                        } else {
                            await sendMessage(chatId, "❓ دستور نامعتبر. لطفاً از دکمه‌های منو استفاده کنید یا /start را بزنید.", token);
                        }
                    }
                }
                
                // پاسخ به دکمه‌های شیشه‌ای
                if (body.callback_query) {
                    const chatId = body.callback_query.message.chat.id;
                    const data = body.callback_query.data;
                    await handleCallback(chatId, data, env.KV_ACCOUNTS, token);
                }
                
                return new Response("OK", { status: 200 });
            } catch (error) {
                console.error("Webhook error:", error);
                return new Response(`Error: ${error.message}`, { status: 500 });
            }
        }
        
        // ============================================
        // Setup webhook (فقط یکبار اجرا کنید)
        // ============================================
        if (url.pathname === "/setup-webhook") {
            const webhookUrl = `https://${url.hostname}${WEBHOOK_PATH}`;
            console.log(`Setting webhook to: ${webhookUrl}`);
            
            const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: webhookUrl })
            });
            const result = await response.json();
            
            return new Response(JSON.stringify(result, null, 2), { 
                status: 200,
                headers: { "Content-Type": "application/json" }
            });
        }
        
        // ============================================
        // صفحه اصلی ربات
        // ============================================
        return new Response(`🤖 **ربات مدیریت ورکرهای کلادفلر در حال اجرا است!**

✅ وضعیت: فعال
📅 زمان: ${new Date().toLocaleString("fa-IR")}

🔰 **مراحل راه‌اندازی:**
1. ربات را در تلگرام استارت کنید
2. از دکمه «ثبت اکانت جدید» استفاده کنید
3. Account ID و API Token خود را وارد کنید
4. Worker مورد نظر خود را بسازید

🔗 **لینک Webhook:** ${url.origin}${WEBHOOK_PATH}
`, { 
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
    }
};
