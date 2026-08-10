// Serverless entry point (Vercel). It builds the app without starting a
// listener -- server.ts is the long-running local/self-hosted entry point and
// calls app.listen(), which must not happen in a serverless function.
import { createApp } from '../src/server/app.js';

export default createApp();
