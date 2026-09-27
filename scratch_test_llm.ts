import 'dotenv/config';
import { complete } from './src/server/ai/llm.js';

async function main() {
  process.env.SHWARI_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';
  console.log('Testing nvidia/nemotron-3-ultra-550b-a55b with tools...');
  try {
    const res = await complete({
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      profile: 'primary',
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location']
          }
        }
      ]
    });
    console.log('Success:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

main();
