export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Lista de modelos de respaldo en orden de prioridad (del más potente al más ligero)
const FALLBACK_MODELS = {
  groq: [
    'openai/gpt-oss-120b', 
    'openai/gpt-oss-20b', 
    'llama-3.1-8b-instant',
    'llama3-8b-8192'
  ],
  gemini: [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.1-flash-lite'
  ]
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  if (url.pathname === '/api/chat' && req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', provider: 'vercel-edge-fallback' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { provider, model, messages, temperature = 0.5 } = await req.json();

      if (!provider || !model || !Array.isArray(messages)) {
        throw new Error('Faltan parámetros: provider, model o messages.');
      }

      let resultText = '';
      let finalProvider = provider;
      let finalModel = model;
      let lastError = '';

      // ── FASE 1: Intentar con Groq ──
      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY no configurada en Vercel.');

        // Creamos una lista única empezando por el modelo solicitado y luego los respaldos
        const modelsToTry = [...new Set([model, ...FALLBACK_MODELS.groq])];

        for (const currentModel of modelsToTry) {
          try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ model: currentModel, messages, temperature, max_tokens: 1024 }),
            });

            if (res.ok) {
              const data = await res.json();
              resultText = data.choices?.[0]?.message?.content || '';
              finalModel = currentModel;
              break; // ¡Éxito! Rompemos el bucle y devolvemos la respuesta
            } else {
              lastError = `Groq ${res.status}: ${await res.text()}`;
            }
          } catch (e) {
            lastError = e.message;
          }
        }
      }

      // ── FASE 2: Si Groq falló (o el proveedor era Gemini), intentar con Gemini ──
      if (!resultText) {
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (apiKey) {
          const modelsToTry = [...new Set([model, ...FALLBACK_MODELS.gemini])];

          for (const currentModel of modelsToTry) {
            try {
              // Formateo especial para Gemini
              const systemMsg = messages.find(m => m.role === 'system');
              const contents = messages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              }));

              // Evitar el error 400 de Gemini si el último mensaje es del modelo
              if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
                contents.push({ role: 'user', parts: [{ text: 'Continúa con tu intervención basándote en lo anterior.' }] });
              }

              const body = { contents, generationConfig: { temperature: Math.min(Math.max(temperature, 0), 2) } };
              if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

              const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              });

              if (res.ok) {
                const data = await res.json();
                resultText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
                finalProvider = 'gemini';
                finalModel = currentModel;
                break; // ¡Éxito! Rompemos el bucle
              } else {
                lastError = `Gemini ${res.status}: ${await res.text()}`;
              }
            } catch (e) {
              lastError = e.message;
            }
          }
        }
      }

      // ── RESPUESTA FINAL ──
      if (resultText) {
        return new Response(JSON.stringify({ 
          text: resultText, 
          provider: finalProvider, 
          model: finalModel,
          fallbackUsed: finalModel !== model 
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } else {
        // Si todo falló catastróficamente
        throw new Error(`El consejo está en mantenimiento. Todos los modelos fallaron. Último error: ${lastError}`);
      }

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Ruta no encontrada.' }), {
    status: 404,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
