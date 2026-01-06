require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE;
const BOT_API_SECRET = process.env.BOT_API_SECRET;

console.log('Testing Dashboard API...');
console.log(`URL: ${API_BASE}/api/bot/channels`);

async function testApi() {
    try {
        const response = await axios.get(`${API_BASE}/api/bot/channels`, {
            headers: {
                'Authorization': `Bearer ${BOT_API_SECRET}`
            }
        });
        console.log('Success!', response.data);
    } catch (error) {
        console.error('Error Status:', error.response ? error.response.status : 'No Response');
        console.error('Error Data:', error.response ? error.response.data : error.message);

        // Detailed error logging
        if (error.response && error.response.data) {
            console.log('Full Error Details:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testApi();
