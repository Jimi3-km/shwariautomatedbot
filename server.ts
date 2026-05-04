import express from 'express';
import cors from 'cors';
import path from 'path';
import 'dotenv/config';
import { getPool, initDb } from './src/db.js';
import { config, updateConfig } from './src/config.js';
import axios from 'axios';

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

app.post('/api/settings', (req, res) => {
  updateConfig(req.body);
  res.json({ success: true, config });
});

// ----------------------------------------------------
// PRICELIST API
// ----------------------------------------------------
const validTables = ['general_pricelist', 'lipa_mdogo_mdogo'];
const getTableName = (category: any) => validTables.includes(category as string) ? category : 'general_pricelist';

app.get('/api/pricelist', async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT * FROM ${tableName} ORDER BY id ASC`);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/pricelist', async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const pool = getPool();

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "3 Months Plan": p3m, "12 Weeks": w12, "Deposit_1": dep1, "6 Months Plan": p6m, "24 Weeks": w24, availability, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO ${tableName} ("Phone Model", "Specs", "Cash Price", "Deposit", "3 Months Plan", "12 Weeks", "Deposit_1", "6 Months Plan", "24 Weeks", availability, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [phone_model, specs, cash_price, deposit, p3m, w12, dep1, p6m, w24, availability, notes]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('POST /api/pricelist error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.put('/api/pricelist/:id', async (req, res) => {
  try {
    const tableName = getTableName(req.query.category);
    const { id } = req.params;
    const pool = getPool();

    const { "Phone Model": phone_model, "Specs": specs, "Cash Price": cash_price, "Deposit": deposit, "3 Months Plan": p3m, "12 Weeks": w12, "Deposit_1": dep1, "6 Months Plan": p6m, "24 Weeks": w24, availability, notes } = req.body;
    const result = await pool.query(
      `UPDATE ${tableName} SET "Phone Model"=$1, "Specs"=$2, "Cash Price"=$3, "Deposit"=$4, "3 Months Plan"=$5, "12 Weeks"=$6, "Deposit_1"=$7, "6 Months Plan"=$8, "24 Weeks"=$9, availability=$10, notes=$11, updated_at=CURRENT_TIMESTAMP WHERE id=$12 RETURNING *`,
      [phone_model, specs, cash_price, deposit, p3m, w12, dep1, p6m, w24, availability, notes, id]
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
    const pool = getPool();
    const { rows } = await pool.query(`
        SELECT l.*, 
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
         ON CONFLICT (transaction_code) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          updated_at = NOW()
         RETURNING *`,
      [
        transaction_code,
        customer_phone,
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
