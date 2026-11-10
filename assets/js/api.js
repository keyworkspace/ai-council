import { WORKER_URL } from './config.js';

export async function chat({ provider, model, messages, temperature = 0.5 }, onChunk) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s

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

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let isStream = false;
  let buffer = '';

  // 🚨 LEEMOS LA RESPUESTA EN TIEMPO REAL 🚨
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    
    // Si el texto empieza con "data: ", sabemos que es un stream.
    if (!isStream && buffer.trim().startsWith('data: ')) {
      isStream = true;
    }

    if (isStream) {
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Guardamos la última línea incompleta

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (onChunk) onChunk(delta); // Pintamos la letra
            }
          } catch (e) {}
        }
      }
    } else {
      // Si no es un stream, es un JSON normal, lo acumulamos
      fullText += buffer;
      buffer = ''; 
    }
  }

  // Al terminar, devolvemos todo el texto
  if (isStream) {
    return { text: fullText, provider };
  } else {
    const data = JSON.parse(fullText);
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
