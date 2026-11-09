import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  let res;
  try {
    res = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, messages, temperature }),
    });
  } catch (networkErr) {
    throw new Error(`Fallo de red directo. Detalle: ${networkErr.message}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const res = await fetch(`${WORKER_URL}/health`);
    return res.ok;
  } catch (e) {
    return false;
  }
}
