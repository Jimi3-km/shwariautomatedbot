import fetch from 'node-fetch';
import { config } from 'dotenv';
config();

async function run() {
  const payload = {
    model: "meta/llama-3.2-11b-vision-instruct",
    messages: [
      { role: "system", content: "You are an assistant. Always output proper JSON for tool calls." },
      { role: "user", content: "list all live products" }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "list_products",
          description: "List what the business sells, with prices and stock.",
          parameters: {
            type: "object",
            properties: {
              search: { type: "string", description: "Match part of a product name." }
            },
            additionalProperties: false
          }
        }
      }
    ],
    tool_choice: "auto",
    temperature: 0.3,
    max_tokens: 1000
  };

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.SHWARI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
