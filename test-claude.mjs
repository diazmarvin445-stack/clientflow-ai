import { readFileSync } from 'fs';

const envContent = readFileSync('.env', 'utf8').replace(/\r?\n/g, '');
const match = envContent.match(/ANTHROPIC_API_KEY=(.+)/);
const key = match ? match[1].trim() : null;

console.log("Llave encontrada:", key ? "SI - longitud: " + key.length : "NO");

const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [{ role: "user", content: "Di hola en español" }]
  })
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
