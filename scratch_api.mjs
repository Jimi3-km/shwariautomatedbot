import fetch from 'node-fetch';
import { config } from 'dotenv';
config();

async function run() {
  const payload = {
    model: "meta/llama-3.2-11b-vision-instruct",
    messages: [
      { role: "system", content: 'You are an assistant. Services Catalog: When the owner asks to add a service, call `save_service` with name, price_amount, and duration_minutes. When updating an existing service (price, duration, description, booking mode, or name), call `save_service` with the service name and the updated attributes. Once saved, confirm in a single clean sentence stating what was added or updated (e.g. "Added Deluxe Car Wash (1,500 KES, 45 mins) to your services." or "Updated Deluxe Car Wash price to 1,800 KES.").' },
      { role: "user", content: "Add a Deluxe Car Wash service for 1500 KES, duration 45 mins" }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "save_service",
          description: "Create a service.",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string" },
              price_amount: { type: "number" },
              duration_minutes: { type: "number" }
            },
            required: ["name", "price_amount", "duration_minutes"]
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
