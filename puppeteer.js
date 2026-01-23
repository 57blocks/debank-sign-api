const puppeteer = require('puppeteer');

const headersToCapture = [
    'x-api-sign',
    'x-api-ts',
    'x-api-nonce',
    'x-api-ver',
    'x-api-key',
    'x-api-time'
];

async function getSignHeaders(address) {
    let capturedHeaders = null;
    const targetPath = '/history/list';

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--lang=en-US,en;q=0.9',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        defaultViewport: {
            width: 1280,
            height: 800
        }
    });

    try {
        const page = await browser.newPage();

        // 注入反反爬虫脚本
        await evadeDetection(page);

        // 拦截请求并提取目标 headers
        const requestPromise = new Promise(resolve => {
            page.on('request', request => {
                const url = request.url();

                if (url.includes(targetPath)) {
                    const headers = request.headers();
                    const filteredHeaders = {};

                    for (const key of headersToCapture) {
                        if (headers[key]) {
                            filteredHeaders[key] = headers[key];
                        }
                    }

                    filteredHeaders['url'] = url;
                    capturedHeaders = filteredHeaders;

                    resolve(); // 一旦捕获就结束等待
                }
            });
        });

        const fullUrl = `https://debank.com/profile/${address}/history`;

        // 页面加载（最大等待 60 秒）
        await page.goto(fullUrl, {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // 等待目标请求或最多等 30 秒
        await Promise.race([
            requestPromise,
            delay(30000)
        ]);

        return capturedHeaders;
    } catch (err) {
        console.error('[getSignHeaders] Error:', err.message || err);
        throw err;
    } finally {
        await browser.close();
    }
}

// 注入反爬虫绕过脚本
async function evadeDetection(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
}

// 简单延时函数
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { getSignHeaders };
