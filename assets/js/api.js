import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  let res;
  try {
    res = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, messages, temperature }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (networkErr) {
    clearTimeout(timeoutId);
    if (networkErr.name === 'AbortError') {
      throw new Error("El texto es demasiado largo o la IA tardó mucho en responder. Intenta con un mensaje más corto.");
    }
    throw new Error(`Fallo de red. Detalle: ${networkErr.message}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const res = await fetch(`${WORKER_URL}/api/chat`);
    return res.ok;
  } catch (e) {
    return false;
  }
}
