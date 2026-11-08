import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  // Usamos un proxy puente para evitar el bloqueo de tu ISP
  const proxyUrl = 'https://corsproxy.io/?';
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
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error del proveedor (${res.status})`);
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const proxyUrl = 'https://corsproxy.io/?';
    const targetUrl = encodeURIComponent(`${WORKER_URL}/health`);
    const res = await fetch(proxyUrl + targetUrl);
    return res.ok;
  } catch (e) {
    return false;
  }
}
