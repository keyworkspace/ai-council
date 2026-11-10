import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

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
    if (networkErr.name === 'AbortError') throw new Error("La IA tardó demasiado en responder.");
    throw new Error(`Fallo de red (posible saturación de la API). Intenta de nuevo.`);
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  // 🚨 DETECTOR DE TIPO DE RESPUESTA 🚨
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream')) {
    // Es un STREAM (Letra por letra)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; 

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (onChunk) onChunk(delta);
            }
          } catch (e) { /* Ignorar líneas incompletas */ }
        }
      }
    }
    return { text: fullText, provider };

  } else {
    // Es un JSON NORMAL (Respaldo de Gemini o texto completo)
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
