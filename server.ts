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
const supabaseToken = config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_ANON_KEY;
const supabase = config.SUPABASE_URL && supabaseToken
  ? createClient(config.SUPABASE_URL, supabaseToken)
  : null;

const app = express();
const PORT = parseInt(config.PORT, 10) || 3000;
console.log(`🚀 Starting Shwari Server...`);
console.log(`📁 DB URL detected: ${config.SUPABASE_DATABASE_URL ? 'YES' : 'NO'}`);

// ----------------------------------------------------
// AUTH MIDDLEWARE — verifies Supabase JWT
// ----------------------------------------------------
async function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // If Supabase is not configured yet, allow through (for initial setup)
  if (!supabase) return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }

  (req as any).user = user;
  next();
}

app.use(express.json());
app.use(cors());

// Initialize DB safely
initDb().then(async () => {
  console.log('✅ Database initialized.');
  // Ensure Godmode user exists in Supabase
  if (supabase) {
    const email = 'jameskoikai04@gmail.com';
    const password = 'Godmode!';
    const { data: { users }, error: listError } = await (supabase.auth.admin as any).listUsers();
    if (!listError) {
      const exists = users.find((u: any) => u.email === email);
      if (!exists) {
        console.log(`👤 Creating Godmode user: ${email}...`);
        const { error: createError } = await (supabase.auth.admin as any).createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: 'James Koikai' }
        });
        if (createError) console.error('❌ Failed to create Godmode user:', createError.message);
        else console.log('✅ Godmode user created.');
      } else {
        console.log('✅ Godmode user found.');
      }
    }
  }

  // ── Sync Summary ──
  const pool = getPool();
  try {
    const { rows: leads } = await pool.query('SELECT count(*) FROM leads');
    const { rows: gPr } = await pool.query('SELECT count(*) FROM general_pricelist');
    const { rows: lPr } = await pool.query('SELECT count(*) FROM lipa_mdogo_mdogo');
    console.log(`📊 SYNC SUMMARY: ${leads[0].count} Leads, ${gPr[0].count} General Prods, ${lPr[0].count} Lipa Prods`);
  } catch (syncErr) {
    console.error('⚠️ Sync summary error:', syncErr);
  }
}).catch(err => {
  console.error('❌ Failed to initialize database during startup:', err);
});

// ----------------------------------------------------
// SETTINGS API
// ----------------------------------------------------
app.get('/api/settings', requireAuth, (req, res) => {
  // Only return non-sensitive config for display purposes
  const { PORT: _p, SUPABASE_DATABASE_URL: _db, SUPABASE_SERVICE_ROLE_KEY: _srk, PAYSTACK_SECRET_KEY: _psk, ...safeConfig } = config as any;
  res.json(safeConfig);
});

// Dead stub for old route — replaced above
app.get('/api/settings_noop', (req, res) => {
  res.json({});
});

app.get('/api/public-env', (req, res) => {
  res.json({ SUPABASE_URL: config.SUPABASE_URL, SUPABASE_ANON_KEY: config.SUPABASE_ANON_KEY });
});

app.post('/api/settings', requireAuth, async (req, res) => {
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
app.get('/api/app-settings', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM app_settings');
    const settings = rows.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
    res.json(settings);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/app-settings', requireAuth, async (req, res) => {
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
app.get('/api/profiles', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM profiles ORDER BY created_at ASC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/profiles/sync', requireAuth, async (req, res) => {
  try {
    const { id, email, full_name } = req.body;
    const pool = getPool();
    await pool.query('INSERT INTO profiles (id, email, full_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = NOW()', [id, email, full_name]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/profiles/:id', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM profiles WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ----------------------------------------------------
// SUBSCRIPTION / PAYWALL API
// ----------------------------------------------------
async function getSubscriptionStatus(userEmail?: string) {
  // GODMODE BYPASS: Always return active for the specific admin email
  if (userEmail === 'jameskoikai04@gmail.com') {
    return { status: 'active', expiry_date: '2099-12-31T23:59:59.999Z', plan: 'unlimited' };
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM subscriptions LIMIT 1');
  if (rows.length === 0) return null;

  let sub = rows[0];
  const now = new Date();
  const expiry = new Date(sub.expiry_date);

  if (now > expiry && sub.status !== 'expired') {
    await pool.query("UPDATE subscriptions SET status = 'expired' WHERE id = $1", [sub.id]);
    sub.status = 'expired';
  }
  return sub;
}

app.get('/api/subscription', requireAuth, async (req, res) => {
  try {
    const userEmail = (req as any).user?.email;
    const sub = await getSubscriptionStatus(userEmail);
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
const validTables = ['general_pricelist', 'lipa_mdogo_mdogo', 'accessories'];
const getTableName = (category: any) => validTables.includes(category as string) ? category : 'general_pricelist';

app.get('/api/pricelist', requireAuth, async (req, res) => {
  try {
    const userEmail = (req as any).user?.email;
    const sub = await getSubscriptionStatus(userEmail);
    if (sub && sub.status === 'expired') {
      return res.status(402).json({ error: 'Payment Required' });
    }

    const tableName = getTableName(req.query.category);
    const pool = getPool();
    const orderBy = tableName === 'accessories' ? 'brand ASC, accessory_name ASC' : 'id ASC';
    const { rows } = await pool.query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/pricelist', requireAuth, upload.single('photo'), async (req, res) => {
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

    if (tableName === 'accessories') {
      const { brand, accessory_name, price, stock, description, is_featured, is_available } = req.body;
      const result = await pool.query(
        `INSERT INTO accessories (brand, accessory_name, price, stock, description, image_url, is_featured, is_available) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [brand, accessory_name, price, stock || 0, description, final_image_url, is_featured === 'true', is_available !== 'false']
      );
      return res.json(result.rows[0]);
    }

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "12 Weeks": w12, "Deposit_1": dep1, "24 Weeks": w24, availability, notes } = req.body;
    // Map availability to n8n's stock_status
    const stock_status = availability ? 'in_stock' : 'out_of_stock';
    const result = await pool.query(
      `INSERT INTO ${tableName} (
        "Phone Model", "Specs", "Cash Price", "Deposit", "12 Weeks", "Deposit_1", "24 Weeks", 
        model, full_price, lipa_mdogo_deposit, lipa_mdogo_weekly, stock_status, availability, notes, image_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [phone_model, specs, cash_price, deposit, w12, dep1, w24, phone_model, cash_price, deposit, w12, stock_status, availability, notes, final_image_url]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('POST /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/pricelist/:id', requireAuth, upload.single('photo'), async (req, res) => {
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

    if (tableName === 'accessories') {
      const { brand, accessory_name, price, stock, description, is_featured, is_available } = req.body;
      const result = await pool.query(
        `UPDATE accessories SET 
          brand=$1, accessory_name=$2, price=$3, stock=$4, description=$5, image_url=$6, 
          is_featured=$7, is_available=$8, updated_at=NOW() 
        WHERE id=$9 RETURNING *`,
        [brand, accessory_name, price, stock || 0, description, final_image_url, is_featured === 'true', is_available !== 'false', id]
      );
      return res.json(result.rows[0]);
    }

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "12 Weeks": w12, "Deposit_1": dep1, "24 Weeks": w24, availability, notes } = req.body;
    const stock_status = availability ? 'in_stock' : 'out_of_stock';
    const result = await pool.query(
      `UPDATE ${tableName} SET 
        "Phone Model"=$1, "Specs"=$2, "Cash Price"=$3, "Deposit"=$4, "12 Weeks"=$5, "Deposit_1"=$6, "24 Weeks"=$7, 
        model=$8, full_price=$9, lipa_mdogo_deposit=$10, lipa_mdogo_weekly=$11, stock_status=$12,
        availability=$13, notes=$14, image_url=$15, updated_at=CURRENT_TIMESTAMP 
      WHERE id=$16 RETURNING *`,
      [phone_model, specs, cash_price, deposit, w12, dep1, w24, phone_model, cash_price, deposit, w12, stock_status, availability, notes, final_image_url, id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('PUT /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.delete('/api/pricelist/:id', requireAuth, async (req, res) => {
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
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const userEmail = (req as any).user?.email;
    const sub = await getSubscriptionStatus(userEmail);
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

app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const userEmail = (req as any).user?.email;
    const sub = await getSubscriptionStatus(userEmail);
    if (sub && sub.status === 'expired') {
      return res.status(402).json({ error: 'Payment Required' });
    }

    const pool = getPool();

    let inStockTotal = 0;
    let outStockTotal = 0;

    for (const t of validTables) {
      const availCol = t === 'accessories' ? 'is_available' : 'availability';
      const inRes = await pool.query(`SELECT COUNT(*) FROM ${t} WHERE ${availCol}=true`);
      const outRes = await pool.query(`SELECT COUNT(*) FROM ${t} WHERE ${availCol}=false`);
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

app.put('/api/leads/:phone/stage', requireAuth, async (req, res) => {
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

app.get('/api/leads/:phone/conversations', requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const pool = getPool();
    // Use fuzzy phone match to handle + prefix discrepancies
    const cleanPhone = phone.replace(/\D/g, '');
    const { rows } = await pool.query(
      "SELECT * FROM conversation_logs WHERE REPLACE(customer_phone, '+', '') = $1 OR customer_phone = $2 ORDER BY created_at ASC",
      [cleanPhone, phone]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ----------------------------------------------------
// PAYMENTS API
// ----------------------------------------------------
app.get('/api/payments', requireAuth, async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT * FROM payments ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/payments', requireAuth, async (req, res) => {
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
