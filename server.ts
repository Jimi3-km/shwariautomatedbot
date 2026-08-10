import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import express from 'express';
import { createApp, assertSupabaseConfigured } from './src/server/app.js';

// Fail fast rather than serving an unauthenticated API. The previous
// implementation let every request through when Supabase was unconfigured.
assertSupabaseConfigured();

const app = createApp();
const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
    }
  }

  app.listen(PORT, () => {
    console.log(`Dashboard API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
