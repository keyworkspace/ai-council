import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s por el streaming

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
    if (networkErr.name === 'AbortError') throw new Error("Petición interrumpida o tiempo de espera agotado.");
    throw new Error(`Fallo de red. Detalle: ${networkErr.message}`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  // 🚨 LÓGICA DE STREAMING 🚨
  const contentType = res.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (onChunk) onChunk(delta); // Mandamos el trozo a la UI
            }
          } catch (e) {}
        }
      }
    }
    return { text: fullText, provider };
  } else {
    // Fallback normal
    const data = await res.json();
    if (onChunk) onChunk(data.text);
    return data;
  }
}

export async function checkHealth() {
  try {
    const res = await fetch(`${WORKER_URL}/api/chat`);
    return res.ok;
  } catch (e) {
    return false;
  }
}
