import { Pool } from 'pg';
import 'dotenv/config';

let pool: Pool | null = null;

export function getDbString(): string {
  // If the environment variable isn't set, try to use a local or in-memory one or throw
  // But wait, user provides NEON_DATABASE_URL from dashboard.
  return process.env.NEON_DATABASE_URL || '';
}

export function updateDbString(url: string) {
  if (pool) {
    pool.end();
  }
  process.env.NEON_DATABASE_URL = url;
  pool = new Pool({ connectionString: url });
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getDbString() });
  }
  return pool;
}

export async function initDb() {
  const dbPool = getPool();
  if (!process.env.NEON_DATABASE_URL) {
    console.warn("No Neon DB URL provided yet. Skipping DB init.");
    return;
  }
  
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS iphone_pricelist (
        id SERIAL PRIMARY KEY,
        model VARCHAR(255) NOT NULL,
        storage VARCHAR(255) NOT NULL,
        color VARCHAR(255),
        condition VARCHAR(255),
        price_ksh INTEGER NOT NULL,
        availability BOOLEAN DEFAULT true,
        notes TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS conversation_log (
        id SERIAL PRIMARY KEY,
        sender_phone VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255),
        customer_message TEXT,
        ai_reply TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed if empty
    const { rows } = await dbPool.query('SELECT COUNT(*) FROM iphone_pricelist');
    if (parseInt(rows[0].count) === 0) {
      console.log('Seeding initial phone data...');
      await dbPool.query(`
        INSERT INTO iphone_pricelist (model, storage, color, condition, price_ksh, availability, notes) VALUES
        ('iPhone 11', '64GB', 'Black', 'Used', 35000, true, 'Good condition'),
        ('iPhone 11', '128GB', 'White', 'Used', 42000, true, 'Minor scratches'),
        ('iPhone 12 Pro', '128GB', 'Blue', 'Used', 65000, true, 'Pristine'),
        ('iPhone 13', '128GB', 'Pink', 'New', 85000, true, 'Sealed'),
        ('iPhone 14 Pro Max', '256GB', 'Deep Purple', 'Used', 150000, true, 'Battery health 95%'),
        ('iPhone 15 Pro Max', '256GB', 'Natural Titanium', 'New', 185000, true, 'With AppleCare+'),
        ('iPhone 16 Pro Max', '256GB', 'Desert Titanium', 'New', 230000, false, 'Coming soon')
      `);
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}
