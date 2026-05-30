import 'dotenv/config';
import { getPool } from './src/db.js';

async function testApi() {
    console.log('🔍 Testing Accessories Fetch...');
    const pool = getPool();
    try {
        const { rows } = await pool.query('SELECT * FROM accessories LIMIT 5');
        console.log('✅ Found accessories:', rows.length);
        console.log('Sample:', rows[0]);
    } catch (err) {
        console.error('❌ Error fetching accessories:', err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

testApi();
