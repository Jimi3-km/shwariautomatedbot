// Serverless entry point (Vercel). It builds the app without starting a
// listener -- server.ts is the long-running local/self-hosted entry point and
// calls app.listen(), which must not happen in a serverless function.
import { createApp, assertSupabaseConfigured } from '../src/server/app.js';

// Fail fast, exactly as server.ts does: a deployment missing its Supabase
// configuration must not come up and serve requests against nothing.
assertSupabaseConfigured();

export default createApp();
