import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  let token = '';
  if (window.auth && window.auth.currentUser) {
    token = await window.auth.currentUser.getIdToken();
  } else {
    throw new Error('Debes iniciar sesión para hablar con la IA.');
  }

  let res;
  try {
    res = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ provider, model, messages, temperature }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (networkErr) {
    clearTimeout(timeoutId);
    if (networkErr.name === 'AbortError') throw new Error("La IA tardó demasiado en responder.");
    throw new Error('Fallo de red. Revisa tu conexión.');
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: `Error HTTP ${res.status}` }));
    throw new Error(errData.error || 'Error desconocido del servidor');
  }

  const data = await res.json();

  if (onChunk && data.text) {
    onChunk(data.text);
  }

  return data;
}

export async function checkHealth() {
  try {
    const res = await fetch(`${WORKER_URL}/api/chat`);
    return res.ok;
  } catch (e) {
    return false;
  }
}
