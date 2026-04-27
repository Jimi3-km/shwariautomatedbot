import Anthropic from '@anthropic-ai/sdk';
import { getPool } from './db.js';
import { config } from './config.js';

export async function askClaude(message: string): Promise<string> {
  if (!config.ANTHROPIC_API_KEY) {
    throw new Error('Anthropic API key is not configured.');
  }

  const anthropic = new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  });

  const pool = getPool();
  let pricelistInfo = 'The pricelist is currently unavailable. Ask the user to check back later.';

  try {
    const { rows } = await pool.query('SELECT * FROM iphone_pricelist ORDER BY model ASC');
    if (rows.length > 0) {
      pricelistInfo = rows.map(r => 
        `- ${r.model} ${r.storage} (${r.color}, ${r.condition}): ${r.price_ksh} KES. ${r.availability ? 'In Stock' : 'Out of Stock'}. ${r.notes || ''}`
      ).join('\n');
    } else {
      pricelistInfo = 'The pricelist is currently empty.';
    }
  } catch (err) {
    console.error('Error fetching pricelist for Claude:', err);
  }

  const systemPrompt = `You are a WhatsApp sales assistant for Shwari iPhones, a phone shop in Nairobi, Kenya. Answer customer questions ONLY using the pricelist provided. Be short, friendly, and conversational. Quote prices in KES. If something is out of stock say so. If you don't know, say you will check. Use simple English or Swahili if the customer writes in Swahili. Never make up prices.

CURRENT PRICELIST:
${pricelistInfo}
`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 250,
    system: systemPrompt,
    messages: [
      { role: 'user', content: message }
    ]
  });

  if (response.content.length > 0 && 'text' in response.content[0]) {
    return response.content[0].text;
  }
  
  return "I'm sorry, I couldn't understand that. Could you try asking again?";
}
