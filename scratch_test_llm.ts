import 'dotenv/config';
import { complete } from './src/server/ai/llm.js';

async function main() {
  console.log('Testing nvidia/llama-3.1-nemotron-70b-instruct...');
  try {
    const res = await complete({
      messages: [{ role: 'user', content: 'Hello' }],
      profile: 'fallback',
    });
    console.log('Fallback success:', res);
  } catch (err) {
    console.error('Fallback error:', err);
  }
}

main();
