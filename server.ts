import express from 'express';
import cors from 'cors';
import path from 'path';
import 'dotenv/config';
import { getPool, initDb, resetPool } from './src/db.js';
import { config, updateConfig } from './src/config.js';
import axios from 'axios';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const upload = multer({ storage: multer.memoryStorage() });
const supabase = config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const app = express();
const PORT = parseInt(config.PORT, 10) || 3000;
console.log(`🚀 Starting Shwari Server...`);
console.log(`📁 DB URL detected: ${config.SUPABASE_DATABASE_URL ? 'YES' : 'NO'}`);

app.use(express.json());
app.use(cors());

// Initialize DB safely
initDb().catch(err => {
  console.error('❌ Failed to initialize database during startup:', err);
});

// ----------------------------------------------------
// SETTINGS API
// ----------------------------------------------------
app.get('/api/settings', (req, res) => {
  res.json(config);
});

app.get('/api/public-env', (req, res) => {
  res.json({ SUPABASE_URL: config.SUPABASE_URL, SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY });
});

app.post('/api/settings', async (req, res) => {
  // Only developer should set these via ENV or manual SQL, but we keep a restricted update
  const allowedKeys = ['N8N_API_URL'];
  const update: any = {};
  for (const k of allowedKeys) if (req.body[k]) update[k] = req.body[k];
  updateConfig(update);
  await resetPool();
  res.json({ success: true, config });
});

// ----------------------------------------------------
// APP SETTINGS (BRAND)
// ----------------------------------------------------
app.get('/api/app-settings', async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM app_settings');
    const settings = rows.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
    res.json(settings);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/app-settings', async (req, res) => {
  try {
    const pool = getPool();
    const { key, value } = req.body;
    await pool.query('INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()', [key, value]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ----------------------------------------------------
// PROFILES / USERS
// ----------------------------------------------------
app.get('/api/profiles', async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM profiles ORDER BY created_at ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/profiles/sync', async (req, res) => {
  try {
    const { id, email, full_name } = req.body;
    const pool = getPool();
    await pool.query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()', [id, email, full_name]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM profiles WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ----------------------------------------------------
// SUBSCRIPTION / PAYWALL API
// ----------------------------------------------------
async function getSubscriptionStatus() {
  const pool = getPool();
  // Check first row
  const { rows } = await pool.query('SELECT * FROM subscriptions LIMIT 1');
  if (rows.length === 0) return null;

  let sub = rows[0];
  const now = new Date();
  const expiry = new Date(sub.expiry_date);

  // Auto-expire if past date
  if (sub.status === 'active' && expiry < now) {
    await pool.query("UPDATE subscriptions SET status = 'expired' WHERE id = $1", [sub.id]);
    sub.status = 'expired';
  }
  return sub;
}

app.get('/api/subscription', async (req, res) => {
  try {
    const sub = await getSubscriptionStatus();
    res.json(sub);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/subscription/verify', async (req, res) => {
  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: 'Reference required' });

  try {
    const pool = getPool();
    // 1. Verify with Paystack
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}` }
    });

    if (response.data.status && response.data.data.status === 'success') {
      const amountPaid = response.data.data.amount / 100; // in KES

      // Basic validation: Check if amount >= 18000
      if (amountPaid < config.SUBSCRIPTION_PRICE) {
        return res.status(400).json({ error: `Insufficient amount. Expected ${config.SUBSCRIPTION_PRICE}` });
      }

      // 2. Extend subscription (30 days from now or extend existing)
      const currentSub = await getSubscriptionStatus();
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 30);

      const result = await pool.query(
        "UPDATE subscriptions SET status = 'active', expiry_date = $1, last_payment_date = NOW(), paystack_reference = $2 WHERE id = $3 RETURNING *",
        [newExpiry, reference, currentSub.id]
      );

      res.json({ success: true, subscription: result.rows[0] });
    } else {
      res.status(400).json({ error: 'Transaction verification failed' });
    }
  } catch (e) {
    console.error('Paystack verification error:', e);
    res.status(500).json({ error: 'Verification error' });
  }
});

// ----------------------------------------------------
// PRICELIST API
// ----------------------------------------------------
const validTables = ['general_pricelist', 'lipa_mdogo_mdogo'];
const getTableName = (category: any) => validTables.includes(category as string) ? category : 'general_pricelist';

app.get('/api/pricelist', async (req, res) => {
  try {
    const sub = await getSubscriptionStatus();
    if (sub && sub.status === 'expired') {
      return res.status(402).json({ error: 'Payment Required' });
    }

    const tableName = getTableName(req.query.category);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM ${tableName} ORDER BY id ASC`);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/pricelist', upload.single('photo'), async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const pool = getPool();

    let final_image_url = req.body.image_url;
    if (req.file && supabase) {
      const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
      const { data, error } = await supabase.storage.from('product-images').upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });
      if (!error) {
        final_image_url = supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
      } else {
        console.error('Supabase upload error:', error);
      }
    }

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "12 Weeks": w12, "Deposit_1": dep1, "24 Weeks": w24, availability, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO ${tableName} ("Phone Model", "Specs", "Cash Price", "Deposit", "12 Weeks", "Deposit_1", "24 Weeks", availability, notes, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [phone_model, specs, cash_price, deposit, w12, dep1, w24, availability, notes, final_image_url]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('POST /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/pricelist/:id', upload.single('photo'), async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const { id } = req.params;
    const pool = getPool();

    let final_image_url = req.body.image_url;
    if (req.file && supabase) {
      const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;
      const { data, error } = await supabase.storage.from('product-images').upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });
      if (!error) {
        final_image_url = supabase.storage.from('product-images').getPublicUrl(fileName).data.publicUrl;
      } else {
        console.error('Supabase upload error:', error);
      }
    }

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "12 Weeks": w12, "Deposit_1": dep1, "24 Weeks": w24, availability, notes } = req.body;
    const result = await pool.query(
      `UPDATE ${tableName} SET "Phone Model"=$1, "Specs"=$2, "Cash Price"=$3, "Deposit"=$4, "12 Weeks"=$5, "Deposit_1"=$6, "24 Weeks"=$7, availability=$8, notes=$9, image_url=$10, updated_at=CURRENT_TIMESTAMP WHERE id=$11 RETURNING *`,
      [phone_model, specs, cash_price, deposit, w12, dep1, w24, availability, notes, final_image_url, id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('PUT /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/pricelist/:id', async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const { id } = req.params;
    const pool = getPool();
    await pool.query(`DELETE FROM ${tableName} WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ----------------------------------------------------
// DASHBOARD DATA
// Direct connections to Supabase (via pg) to fetch leads.
// ----------------------------------------------------
app.get('/api/leads', async (req, res) => {
  try {
    const sub = await getSubscriptionStatus();
    if (sub && sub.status === 'expired') {
      return res.status(402).json({ error: 'Payment Required' });
    }

    const pool = getPool();
    const { rows } = await pool.query(`
        SELECT l.*, 
               (SELECT customer_name FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.customer_name IS NOT NULL ORDER BY created_at DESC LIMIT 1) as derived_customer_name,
               (SELECT product_model FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.product_model IS NOT NULL ORDER BY created_at DESC LIMIT 1) as product_model,
               (SELECT product_storage FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.product_storage IS NOT NULL ORDER BY created_at DESC LIMIT 1) as product_storage,
               (SELECT delivery_location FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.delivery_location IS NOT NULL ORDER BY created_at DESC LIMIT 1) as derived_delivery_location,
               (SELECT payment_method FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.payment_method IS NOT NULL ORDER BY created_at DESC LIMIT 1) as derived_payment_method,
               (SELECT email FROM conversation_logs c WHERE c.customer_phone = l.phone AND c.email IS NOT NULL ORDER BY created_at DESC LIMIT 1) as derived_email
        FROM leads l 
        ORDER BY l.last_contact DESC
      `);

    const processedRows = rows.map((r: any) => ({
      ...r,
      customer_name: r.derived_customer_name || r.customer_name,
      delivery_location: r.derived_delivery_location || r.delivery_location,
      payment_method: r.derived_payment_method || r.payment_method,
      email: r.derived_email || r.email
    }));
    res.json(processedRows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const sub = await getSubscriptionStatus();
    if (sub && sub.status === 'expired') {
      return res.status(402).json({ error: 'Payment Required' });
    }

    const pool = getPool();

    let inStockTotal = 0;
    let outStockTotal = 0;

    for (const t of validTables) {
      const inRes = await pool.query(`SELECT COUNT(*) FROM ${t} WHERE availability=true`);
      const outRes = await pool.query(`SELECT COUNT(*) FROM ${t} WHERE availability=false`);
      inStockTotal += parseInt(inRes.rows[0].count);
      outStockTotal += parseInt(outRes.rows[0].count);
    }

    // Leads stats
    const { rows: leads } = await pool.query('SELECT * FROM leads');
    const stats = {
      totalLeads: leads.length,
      highValue: leads.filter(l => l.urgency === "high").length,
      mediumValue: leads.filter(l => l.urgency === "medium").length,
      lowValue: leads.filter(l => l.urgency === "low").length,
      byIntent: {
        pricing: leads.filter(l => l.intent === "pricing").length,
        serious_buyer: leads.filter(l => l.intent === "serious_buyer").length,
        availability: leads.filter(l => l.intent === "availability").length,
        browsing: leads.filter(l => l.intent === "browsing").length,
        spam: leads.filter(l => l.intent === "spam").length
      },
      byStage: {
        new: leads.filter(l => l.stage === "new").length,
        engaged: leads.filter(l => l.stage === "engaged").length,
        hot: leads.filter(l => l.stage === "hot").length,
        closed: leads.filter(l => l.stage === "closed").length
      },
      inventory: {
        inStock: inStockTotal,
        outOfStock: outStockTotal
      }
    };

    // Sales stats
    const salesRes = await pool.query("SELECT COUNT(*) as count, SUM(amount) as revenue FROM payments WHERE payment_status = 'confirmed' OR payment_status = 'completed'");
    const totalSales = parseInt(salesRes.rows[0].count) || 0;
    const totalRevenue = parseFloat(salesRes.rows[0].revenue) || 0;

    res.json({
      ...stats,
      totalSales,
      totalRevenue
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/leads/:phone/stage', async (req, res) => {
  try {
    const { phone } = req.params;
    const { stage, email, delivery_location, payment_method } = req.body;
    const pool = getPool();
    const result = await pool.query(
      'UPDATE leads SET stage = $1, email = COALESCE($2, email), delivery_location = COALESCE($3, delivery_location), payment_method = COALESCE($4, payment_method), last_contact = NOW() WHERE phone = $5 RETURNING *',
      [stage, email, delivery_location, payment_method, phone]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/leads/:phone/conversations', async (req, res) => {
  try {
    const { phone } = req.params;
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM conversation_logs WHERE customer_phone = $1 ORDER BY created_at ASC', [phone]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ----------------------------------------------------
// PAYMENTS API
// ----------------------------------------------------
app.get('/api/payments', async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM payments ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/payments', async (req, res) => {
  try {
    const {
      transaction_code,
      customer_phone,
      customer_email,
      amount,
      payment_status,
      payment_method,
      delivery_location,
      product_model,
      product_storage,
      product_condition,
      upsell_items
    } = req.body;
    const pool = getPool();
    const result = await pool.query(
      `INSERT INTO payments (
          transaction_code, 
          customer_phone, 
          customer_name,
          customer_email,
          amount, 
          payment_status, 
          payment_method, 
          delivery_location,
          product_model,
          product_storage,
          product_condition,
          upsell_items
        ) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         ON CONFLICT (transaction_code) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          updated_at = NOW()
         RETURNING *`,
      [
        transaction_code,
        customer_phone,
        req.body.customer_name || '',
        customer_email,
        amount,
        payment_status || 'pending',
        payment_method || 'M-Pesa',
        delivery_location,
        product_model,
        product_storage,
        product_condition,
        upsell_items
      ]
    );
    res.json(result.rows[0] || { success: true });
  } catch (e) {
    console.error('POST /api/payments error:', e);
    res.status(500).json({ error: String(e) });
  }
});

// ----------------------------------------------------
// VITE MIDDLEWARE & SERVER INITIALIZATION
// ----------------------------------------------------
if (!process.env.VERCEL) {
  if (process.env.NODE_ENV !== 'production') {
    import('vite').then(async ({ createServer: createViteServer }) => {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', Object.assign((req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    }));
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

export default app;
