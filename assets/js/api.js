import { WORKER_URL } from './config.js';

/**
 * Envía una solicitud de generación al Worker.
 * @param {Object} params
 * @param {string} params.provider  - 'groq' | 'gemini' | 'openrouter'
 * @param {string} params.model     - ID del modelo
 * @param {Array}  params.messages  - [{role:'system'|'user'|'assistant', content:string}]
 * @param {number} params.temperature
 * @returns {Promise<{text:string, provider:string, model:string}>}
 */
export async function chat({ provider, model, messages, temperature = 0.5 }) {
  const res = await fetch(`${WORKER_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, messages, temperature }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Error del proveedor (${res.status})`);
  }
  return res.json();
}

export async function checkHealth() {
  try {
    const res = await fetch(`${WORKER_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
