import { initDb } from '../src/db.js';
import 'dotenv/config';

async function main() {
    console.log('🚀 Initializing Accessories Table...');
    await initDb();
    console.log('✅ Done.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
