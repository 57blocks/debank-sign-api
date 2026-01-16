const express = require('express');
const {getSignHeaders} = require('./puppeteer');

const app = express();
const port = 8899;

app.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'debank-sign-api',
        timestamp: new Date().toISOString()
    });
});

app.get('/sign', async (req, res) => {
    const address = req.query.address;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({error: 'Invalid address'});
    }

    try {
        const headers = await getSignHeaders(address);

        if (!headers) {
            return res.status(500).json({error: 'Failed to capture headers'});
        }

        res.json(headers);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).json({error: 'Internal error'});
    }
});

app.listen(port, () => {
    console.log(`Debank Sign API running on http://localhost:${port}`);
});