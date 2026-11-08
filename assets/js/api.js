import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  // Usamos allorigins.win, que es gratuito y no pide clave
  const proxyUrl = 'https://api.allorigins.win/raw?url=';
  const targetUrl = encodeURIComponent(`${WORKER_URL}/api/chat`);

  let res;
  try {
    res = await fetch(proxyUrl + targetUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ provider, model, messages, temperature }),
    });
  } catch (networkErr) {
    throw new Error(`Fallo de red en el proxy: ${networkErr.message}`);
  }

  if (!res.ok) {
    // Intentamos leer el error real que devuelve el Worker
    const errText = await res.text();
    try {
      const errJson = JSON.parse(errText);
      throw new Error(errJson.error || `Error HTTP ${res.status}`);
    } catch (e) {
      throw new Error(`Error del proxy (HTTP ${res.status}): ${errText.slice(0, 100)}`);
    }
  }
  
  return res.json();
}

export async function checkHealth() {
  try {
    const proxyUrl = 'https://api.allorigins.win/raw?url=';
    const targetUrl = encodeURIComponent(`${WORKER_URL}/health`);
    const res = await fetch(proxyUrl + targetUrl);
    return res.ok;
  } catch (e) {
    return false;
  }
}
