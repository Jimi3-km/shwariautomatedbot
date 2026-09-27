import 'dotenv/config';

async function main() {
  const apiKey = process.env.SHWARI_API_KEY;
  const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await res.json();
  const ids = data.data.map((m: any) => m.id);
  console.log(ids.join('\n'));
}

main();
