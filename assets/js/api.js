import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }) {
  // Proxy CodeTabs (soporta POST y es gratuito)
  const proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
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
    const errText = await res.text();
    throw new Error(`Error (HTTP ${res.status}): ${errText.slice(0, 150)}`);
  }
  
  return res.json();
}

export async function checkHealth() {
  try {
    const proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=';
    const targetUrl = encodeURIComponent(`${WORKER_URL}/health`);
    const res = await fetch(proxyUrl + targetUrl);
    return res.ok;
  } catch (e) {
    return false;
  }
}
