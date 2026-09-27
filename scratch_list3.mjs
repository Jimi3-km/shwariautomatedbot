import fetch from 'node-fetch';
import { config } from 'dotenv';
config();

async function run() {
  const payload = {
    model: "meta/llama-3.2-11b-vision-instruct",
    messages: [
      { role: "system", content: "You are an assistant. Always output proper JSON for tool calls. When a tool provides a list, format it nicely for the user." },
      { role: "user", content: "list all live products" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_123", type: "function", function: { name: "list_products", arguments: "{\"search\": \"\"}" } }] },
      { role: "tool", tool_call_id: "call_123", content: "{\"products\":[{\"id\":\"1\",\"name\":\"Deluxe Car Wash\",\"sku\":null,\"description\":null,\"price\":1500,\"currency\":\"KES\",\"in_stock\":true}]}" }
    ],
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
