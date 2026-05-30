import { Pool } from 'pg';
import { config } from './config.js';

let pool: Pool | null = null;

/** Call this after updating SUPABASE_DATABASE_URL at runtime so a fresh pool is created. */
export async function resetPool() {
    if (pool) {
        try { await pool.end(); } catch { /* ignore */ }
        pool = null;
    }
}

export function getPool() {
    if (!pool) {
        if (!config.SUPABASE_DATABASE_URL) {
            console.error('No SUPABASE_DATABASE_URL — using local fallback.');
            pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/postgres', max: 5 });
        } else {
            try {
                const url = new URL(config.SUPABASE_DATABASE_URL);
                console.log(`📡 Connecting to Supabase at ${url.host}...`);
                pool = new Pool({
                    connectionString: config.SUPABASE_DATABASE_URL,
                    ssl: config.SUPABASE_DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
                    max: 20,                  // handle concurrent webhook bursts
                    idleTimeoutMillis: 30000, // release idle connections
                    connectionTimeoutMillis: 5000,
                });
            } catch (err) {
                console.error('Invalid SUPABASE_DATABASE_URL:', err);
                pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/postgres', max: 5 });
            }
        }
    }
    return pool;
}

export async function initDb() {
    if (!config.SUPABASE_DATABASE_URL) return;

    try {
        const p = getPool();

        // Symmetric Inventory Tables
        const inventoryTables = ['general_pricelist', 'lipa_mdogo_mdogo'];
        for (const table of inventoryTables) {
            await p.query(`
                CREATE TABLE IF NOT EXISTS ${table} (
                    id SERIAL PRIMARY KEY,
                    "Phone Model" VARCHAR(100) NOT NULL, -- Dashboard key
                    "Specs" TEXT,                        -- Dashboard key
                    "Cash Price" TEXT NOT NULL,         -- Dashboard key
                    "Deposit" TEXT,                      -- Dashboard key
                    "12 Weeks" TEXT,
                    "Deposit_1" TEXT,
                    "24 Weeks" TEXT,
                    
                    -- n8n / AI Agent Keys (Clean Mapping)
                    model VARCHAR(100),
                    storage VARCHAR(50),
                    condition VARCHAR(50),
                    full_price TEXT,
                    lipa_mdogo_deposit TEXT,
                    lipa_mdogo_weekly TEXT,
                    lipa_mdogo_duration_weeks TEXT,
                    stock_status VARCHAR(50) DEFAULT 'in_stock',
                    
                    availability BOOLEAN DEFAULT TRUE,
                    notes TEXT,
                    image_url TEXT,
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);
            // ── Safe column repair ──
            const missingCols: [string, string][] = [
                ['"Deposit"', 'TEXT'],
                ['"12 Weeks"', 'TEXT'],
                ['"Deposit_1"', 'TEXT'],
                ['"24 Weeks"', 'TEXT'],
                ['model', 'VARCHAR(100)'],
                ['storage', 'VARCHAR(50)'],
                ['condition', 'VARCHAR(50)'],
                ['full_price', 'TEXT'],
                ['lipa_mdogo_deposit', 'TEXT'],
                ['lipa_mdogo_weekly', 'TEXT'],
                ['lipa_mdogo_duration_weeks', 'TEXT'],
                ['stock_status', "VARCHAR(50) DEFAULT 'in_stock'"],
                ['notes', 'TEXT'],
                ['image_url', 'TEXT'],
                ['availability', 'BOOLEAN DEFAULT TRUE'],
                ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()'],
                ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
            ];
            for (const [col, type] of missingCols) {
                await p.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type};`);
            }

            // ── Data Migration: Sync legacy to n8n columns ──
            // Handle both NULL and empty strings
            await p.query(`UPDATE ${table} SET model = "Phone Model" WHERE model IS NULL OR model = '';`);
            await p.query(`UPDATE ${table} SET full_price = "Cash Price" WHERE full_price IS NULL OR full_price = '';`);
            await p.query(`UPDATE ${table} SET lipa_mdogo_deposit = "Deposit" WHERE lipa_mdogo_deposit IS NULL OR lipa_mdogo_deposit = '';`);
            await p.query(`UPDATE ${table} SET lipa_mdogo_weekly = "12 Weeks" WHERE lipa_mdogo_weekly IS NULL OR lipa_mdogo_weekly = '';`);

            // Availability index for agent lookups
            await p.query(`CREATE INDEX IF NOT EXISTS idx_${table}_availability ON ${table}(availability);`);
        }

        // Leads Table
        await p.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(50) UNIQUE NOT NULL,
                customer_name TEXT,
                email VARCHAR(255),
                interest VARCHAR(100),
                intent VARCHAR(50),
                urgency VARCHAR(50),
                delivery_location TEXT,
                payment_method TEXT,
                transaction_code VARCHAR(100),
                product_model VARCHAR(100),
                product_storage VARCHAR(50),
                product_condition VARCHAR(50),
                product_price VARCHAR(50),
                upsell_items TEXT,
                stage VARCHAR(50) DEFAULT 'new',
                last_message TEXT,
                last_contact TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Payments Table (UUID & n8n compliant)
        await p.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await p.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                customer_phone VARCHAR(50) NOT NULL,
                customer_name TEXT,
                customer_email VARCHAR(255),
                transaction_code VARCHAR(100) UNIQUE NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_method VARCHAR(50) DEFAULT 'M-Pesa',
                delivery_location TEXT,
                product_model VARCHAR(100),
                product_storage VARCHAR(50),
                product_condition VARCHAR(50),
                upsell_items TEXT,
                payment_status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ
            );
        `);

        // Conversation Logs Table
        await p.query(`
            CREATE TABLE IF NOT EXISTS conversation_logs (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                customer_phone VARCHAR(50) NOT NULL REFERENCES leads(phone) ON DELETE CASCADE,
                customer_name TEXT,
                message TEXT NOT NULL,
                response TEXT,
                sender VARCHAR(50) NOT NULL,
                intent VARCHAR(50),
                email VARCHAR(255),
                delivery_location TEXT,
                payment_method VARCHAR(50),
                transaction_code VARCHAR(100),
                product_model VARCHAR(100),
                product_storage VARCHAR(50),
                product_condition VARCHAR(50),
                product_price VARCHAR(50),
                upsell_items TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // ── Critical performance indexes ──
        await p.query(`CREATE INDEX IF NOT EXISTS idx_conv_logs_phone    ON conversation_logs(customer_phone);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_conv_logs_created  ON conversation_logs(created_at DESC);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_leads_stage        ON leads(stage);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_leads_last_contact ON leads(last_contact DESC);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_phone     ON payments(customer_phone);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_status    ON payments(payment_status);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_payments_created   ON payments(created_at DESC);`);

        // ── Subscriptions Table ──
        await p.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id SERIAL PRIMARY KEY,
                status VARCHAR(20) DEFAULT 'active',
                expiry_date TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
                last_payment_date TIMESTAMPTZ,
                paystack_reference TEXT,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed or Reset subscription to start from today (30 days period)
        const { rows: subRows } = await p.query('SELECT count(*) FROM subscriptions');
        if (parseInt(subRows[0].count) === 0) {
            console.log('🌱 Seeding initial 30-day subscription plan...');
            await p.query("INSERT INTO subscriptions (status, expiry_date) VALUES ('active', NOW() + INTERVAL '30 days')");
        } else {
            console.log('🔄 Resetting subscription period to 30 days from today...');
            await p.query("UPDATE subscriptions SET expiry_date = NOW() + INTERVAL '30 days', status = 'active' WHERE id = (SELECT id FROM subscriptions LIMIT 1)");
        }

        // Accessories Table
        await p.query(`
            CREATE TABLE IF NOT EXISTS accessories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                brand TEXT NOT NULL,
                accessory_name TEXT NOT NULL,
                price INTEGER NOT NULL,
                currency TEXT DEFAULT 'KES',
                stock INTEGER DEFAULT 0,
                description TEXT,
                image_url TEXT,
                is_featured BOOLEAN DEFAULT FALSE,
                is_available BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_accessories_brand ON accessories(brand);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_accessories_price ON accessories(price);`);
        await p.query(`CREATE INDEX IF NOT EXISTS idx_accessories_name ON accessories(accessory_name);`);

        // ── Profiles & Settings ──
        await p.query(`
            CREATE TABLE IF NOT EXISTS profiles (
                id UUID PRIMARY KEY,
                full_name TEXT,
                email TEXT UNIQUE,
                role TEXT DEFAULT 'admin',
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Seed brand name if missing
        await p.query("INSERT INTO app_settings (key, value) VALUES ('brand_name', 'Shwari Agent') ON CONFLICT DO NOTHING");

        console.log('✅ Database initialized and indexes verified.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}
