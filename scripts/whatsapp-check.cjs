const axios = require('axios');
require('dotenv').config();

async function checkWhatsAppConfig() {
    const configs = [
        { name: 'STUDENTS', token: process.env.WHATSAPP_TOKEN_STUDENTS, id: process.env.WHATSAPP_ID_STUDENTS },
        { name: 'ACCESSORIES', token: process.env.WHATSAPP_TOKEN_ACCESSORIES, id: process.env.WHATSAPP_ID_ACCESSORIES },
    ];

    console.log('--- WhatsApp ID Diagnostic Tool ---\n');

    for (const item of configs) {
        console.log(`Checking ${item.name}...`);
        if (!item.token || !item.id) {
            console.log(`❌ ERROR: Missing token or ID for ${item.name} in .env\n`);
            continue;
        }

        try {
            const res = await axios.get(`https://graph.facebook.com/v18.0/${item.id}`, {
                headers: { Authorization: `Bearer ${item.token}` }
            });

            const data = res.data;
            console.log(`✅ Success! Resource Found:`);
            console.log(`   ID: ${data.id}`);

            if (data.verified_name) {
                console.log(`   Type: Phone Number (CORRECT)`);
                console.log(`   Name: ${data.verified_name}`);
            } else {
                console.log(`   Type: WhatsApp Business Account (INCORRECT for messaging)`);
                console.log(`   ⚠️ WARNING: You need the "Phone Number ID".`);
            }
        } catch (e) {
            console.log(`❌ ERROR for ${item.name}:`);
            if (e.response && e.response.data) {
                console.log(`   Message: ${e.response.data.error.message}`);
                console.log(`   Code: ${e.response.data.error.code} (Subcode: ${e.response.data.error.error_subcode})`);
            }

            console.log(`\n🔍 Let's try to find your available Phone Number IDs for this token...`);
            try {
                // First get the WABA ID if possible, then list phone numbers
                const meRes = await axios.get(`https://graph.facebook.com/v18.0/me`, {
                    headers: { Authorization: `Bearer ${item.token}` }
                });
                console.log(`   Found App/User: ${meRes.data.name} (ID: ${meRes.data.id})`);

                // This endpoint lists phone numbers associated with the token's WABAs
                const wabaRes = await axios.get(`https://graph.facebook.com/v18.0/client_whatsapp_business_accounts`, {
                    headers: { Authorization: `Bearer ${item.token}` }
                });

                if (wabaRes.data.data && wabaRes.data.data.length > 0) {
                    for (const waba of wabaRes.data.data) {
                        console.log(`   Checking WABA: ${waba.name} (ID: ${waba.id})...`);
                        const phoneRes = await axios.get(`https://graph.facebook.com/v18.0/${waba.id}/phone_numbers`, {
                            headers: { Authorization: `Bearer ${item.token}` }
                        });
                        if (phoneRes.data.data) {
                            phoneRes.data.data.forEach(p => {
                                console.log(`   💡 FOUND Correct Phone Number ID: ${p.id} (Number: ${p.display_phone_number})`);
                            });
                        }
                    }
                } else {
                    console.log(`   No WABAs found for this token.`);
                }
            } catch (innerE) {
                console.log(`   Discovery failed: ${innerE.message}`);
            }
        }
        console.log('\n');
    }
}

checkWhatsAppConfig();
