import fs from 'fs';
import path from 'path';
import { getPool } from '../src/db.js';
import 'dotenv/config';

async function main() {
    const pool = getPool();
    const sqlPath = path.join(process.cwd(), 'database', 'migrations', 'migration_accessories.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('🚀 Running migration_accessories.sql...');
    try {
        await pool.query(sql);
        console.log('✅ Migration successful.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();
