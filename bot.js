// به جای قرار دادن مستقیم کد worker.js، از گیتهاب بخون
async function getWorkerCode() {
    const response = await fetch("https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/worker.js");
    return await response.text();
}

// تابع createWorker رو تغییر بده:
async function createWorker(accountId, apiToken, scriptName, env) {
    const workerCode = await getWorkerCode(); // از گیتهاب میخونه
    
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`;
    
    const response = await fetch(url, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/javascript"
        },
        body: workerCode
    });
    // ...
}