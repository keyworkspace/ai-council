export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FALLBACK_MODELS = {
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant', 'llama3-8b-8192'],
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite']
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  if (url.pathname === '/api/chat' && req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', provider: 'vercel-edge-stream' }), {
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

      let safeMessages = messages;
      const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
      if (totalChars > 30000) {
        safeMessages = [messages[0], ...messages.slice(-5)];
      }

      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY no configurada.');

        const modelsToTry = [...new Set([model, ...FALLBACK_MODELS.groq])];

        for (const currentModel of modelsToTry) {
          try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({ 
                model: currentModel, 
                messages: safeMessages, 
                temperature, 
                max_tokens: 4096,
                stream: true // 🚨 ACTIVAMOS STREAMING
              }),
            });

            if (res.ok) {
              // Devolvemos el stream directamente al frontend
              return new Response(res.body, {
                status: 200,
                headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' }
              });
            }
          } catch (e) {
            console.warn(`Fallo en ${currentModel}, intentando siguiente...`);
          }
        }
      }

      // ── RESPALDO: Si Groq falla o es Gemini, usamos JSON normal ──
      let resultText = '';
      let finalProvider = provider;
      let finalModel = model;
      
      if (provider === 'gemini' || !resultText) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (apiKey) {
          const modelsToTry = [...new Set([model, ...FALLBACK_MODELS.gemini])];
          for (const currentModel of modelsToTry) {
            try {
              const systemMsg = safeMessages.find(m => m.role === 'system');
              const contents = safeMessages.filter(m => m.role !== 'system').map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
              }));

              if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
                contents.push({ role: 'user', parts: [{ text: 'Continúa.' }] });
              }

              const body = { contents, generationConfig: { temperature: Math.min(Math.max(temperature, 0), 2), maxOutputTokens: 4096 } };
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
                break;
              }
            } catch (e) {}
          }
        }
      }

      if (resultText) {
        return new Response(JSON.stringify({ text: resultText, provider: finalProvider, model: finalModel }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } else {
        throw new Error(`Todos los modelos fallaron.`);
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
