import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import 'dotenv/config';
import { getPool, initDb } from './src/db.js';
import { config, updateConfig } from './src/config.js';
import { askClaude } from './src/anthropic.js';
import { sendWhatsAppMessage } from './src/whatsapp.js';
import axios from 'axios';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Use raw JSON for Meta webhook signatures if we wanted to verify strictly,
  // but Meta just sends standard JSON. We'll parse json.
  app.use(express.json());
  app.use(cors());

  // Initialize DB if URL is set
  initDb();

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
  app.get('/api/pricelist', async (req, res) => {
    try {
        const pool = getPool();
        const { rows } = await pool.query('SELECT * FROM iphone_pricelist ORDER BY id ASC');
        res.json(rows);
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  app.post('/api/pricelist', async (req, res) => {
    try {
        const { model, storage, color, condition, price_ksh, availability, notes } = req.body;
        const pool = getPool();
        const result = await pool.query(
            'INSERT INTO iphone_pricelist (model, storage, color, condition, price_ksh, availability, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [model, storage, color, condition, price_ksh, availability, notes]
        );
        res.json(result.rows[0]);
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  app.put('/api/pricelist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { model, storage, color, condition, price_ksh, availability, notes } = req.body;
        const pool = getPool();
        const result = await pool.query(
            'UPDATE iphone_pricelist SET model=$1, storage=$2, color=$3, condition=$4, price_ksh=$5, availability=$6, notes=$7, updated_at=CURRENT_TIMESTAMP WHERE id=$8 RETURNING *',
            [model, storage, color, condition, price_ksh, availability, notes, id]
        );
        res.json(result.rows[0]);
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  app.delete('/api/pricelist/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = getPool();
        await pool.query('DELETE FROM iphone_pricelist WHERE id=$1', [id]);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  // ----------------------------------------------------
  // CONVERSATIONS & STATS
  // ----------------------------------------------------
  app.get('/api/conversations', async (req, res) => {
    try {
        const pool = getPool();
        const { rows } = await pool.query('SELECT * FROM conversation_log ORDER BY created_at DESC LIMIT 100');
        res.json(rows);
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
        const pool = getPool();
        const todayStr = new Date().toISOString().split('T')[0];
        
        const convResult = await pool.query("SELECT COUNT(*) FROM conversation_log WHERE created_at >= $1::date", [todayStr]);
        const inStockResult = await pool.query("SELECT COUNT(*) FROM iphone_pricelist WHERE availability=true");
        const outStockResult = await pool.query("SELECT COUNT(*) FROM iphone_pricelist WHERE availability=false");
        
        res.json({
            conversationsToday: parseInt(convResult.rows[0].count),
            phonesInStock: parseInt(inStockResult.rows[0].count),
            phonesOutOfStock: parseInt(outStockResult.rows[0].count),
        });
    } catch(e) {
        res.status(500).json({error: String(e)});
    }
  });

  // ----------------------------------------------------
  // N8N INTEGRATION
  // ----------------------------------------------------
  app.post('/api/n8n/trigger', async (req, res) => {
    try {
        const workflowId = req.body.workflowId || config.N8N_WORKFLOW_ID;
        const apiUrl = config.N8N_API_URL;
        if(!apiUrl || !workflowId) {
            return res.status(400).json({error: 'n8n API URL or Workflow ID is missing'});
        }

        // Assuming a standard n8n webhook URL format if no specific endpoint is provided, 
        // normally N8N_API_URL includes the webhook path, e.g., https://your-n8n.com/webhook/something
        const result = await axios.post(apiUrl.replace('{id}', workflowId), req.body);
        res.json({ success: true, data: result.data });
    } catch(e: any) {
        res.status(500).json({error: String(e.message)});
    }
  });


  // ----------------------------------------------------
  // WHATSAPP WEBHOOK
  // ----------------------------------------------------
  app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.META_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  app.post('/webhook/whatsapp', async (req, res) => {
    // 1. Immediately return 200 OK
    res.sendStatus(200);

    try {
      const body = req.body;
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry) {
          for (const change of entry.changes) {
            if (change.value.messages && change.value.messages[0]) {
              const msg = change.value.messages[0];
              const contact = change.value.contacts?.[0];
              const senderPhone = msg.from;
              const senderName = contact?.profile?.name || 'Customer';
              
              if (msg.type === 'text') {
                const customerMessage = msg.text.body;

                // 2. Ask Claude
                const aiReply = await askClaude(customerMessage);

                // 3. Send WhatsApp Message
                await sendWhatsAppMessage(senderPhone, aiReply);

                // 4. Log to DB
                try {
                  const pool = getPool();
                  await pool.query(
                    'INSERT INTO conversation_log (sender_phone, sender_name, customer_message, ai_reply) VALUES ($1, $2, $3, $4)',
                    [senderPhone, senderName, customerMessage, aiReply]
                  );
                } catch (dbErr) {
                  console.error('Error logging conversation:', dbErr);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Error processing webhook:', err);
    }
  });

  // ----------------------------------------------------
  // VITE MIDDLEWARE (FRONTEND)
  // ----------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', Object.assign((req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    }));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
