const puppeteer = require('puppeteer');

async function getSignHeaders(address) {
    const headersToCapture = ['x-api-sign', 'x-api-ts', 'x-api-nonce', 'x-api-ver', 'x-api-key', 'x-api-time'];
    let capturedHeaders = null;

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

        // 注入反反爬 JS
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
        });

        // 拦截请求
        page.on('request', request => {
            const url = request.url();
            if (url.includes('/history/list')) {
                const headers = request.headers();
                capturedHeaders = {};

                for (const key of headersToCapture) {
                    if (headers[key]) {
                        capturedHeaders[key] = headers[key];
                    }
                }

                capturedHeaders['url'] = url;
            }
        });

        //const fullUrl = `https://debank.com/profile/${address}/history?mode=analysis`;
        const fullUrl = `https://debank.com/profile/${address}/history`;
        await page.goto(fullUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000 // 120秒超时
        });

        // 等待请求完成，最长等60秒
        await new Promise(resolve => setTimeout(resolve, 60000));

        return capturedHeaders;
    } catch (err) {
        console.error('getSignHeaders error:', err);
        throw err;
    } finally {
        await browser.close();
    }
}

module.exports = {getSignHeaders};
