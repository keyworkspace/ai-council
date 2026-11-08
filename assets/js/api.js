import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  const proxyUrl = 'https://api.cors.lol/?url=';
  const targetUrl = encodeURIComponent(`${WORKER_URL}/api/chat`);

  let res;
  try {
    res = await fetch(proxyUrl + targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, messages, temperature }),
    });
  } catch (networkErr) {
    throw new Error(`Fallo de red: ${networkErr.message}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error (HTTP ${res.status}): ${errText.slice(0, 100)}`);
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const proxyUrl = 'https://api.cors.lol/?url=';
    const targetUrl = encodeURIComponent(`${WORKER_URL}/health`);
    const res = await fetch(proxyUrl + targetUrl);
    return res.ok;
  } catch (e) {
    return false;
  }
}
