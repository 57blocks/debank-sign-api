const {getSignHeaders} = require('./puppeteer');

(async () => {
    try {
        const headers = await getSignHeaders("0xd100b6645eb05bd88ff6491cb9f1c2688948b838");
        console.log(headers);
    }catch (err){
        console.error(err);
    }
})()
