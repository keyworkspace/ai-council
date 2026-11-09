export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  // 1. Manejo de CORS Preflight (Vercel exige 204 sin cuerpo)[reference:1]
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  // 2. Ruta de Healthcheck
  if (url.pathname === '/api/chat' && req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok', provider: 'vercel-edge' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // 3. Ruta principal de Chat (POST)
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { provider, model, messages, temperature = 0.5 } = await req.json();

      if (!provider || !model || !Array.isArray(messages)) {
        throw new Error('Faltan parámetros: provider, model o messages.');
      }

      let resultText = '';

      // Adaptador para Groq (Compatible con OpenAI)
      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY no configurada en Vercel.');

        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages, temperature, max_tokens: 1024 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Groq ${res.status}: ${JSON.stringify(data)}`);
        resultText = data.choices?.[0]?.message?.content || '';

      // Adaptador para Gemini
      } else if (provider === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY no configurada en Vercel.');

        const systemMsg = messages.find(m => m.role === 'system');
        const contents = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

        const body = { contents, generationConfig: { temperature: Math.min(Math.max(temperature, 0), 2) } };
        if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(data)}`);
        resultText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';

      } else {
        throw new Error(`Proveedor no soportado: ${provider}`);
      }

      // 4. Respuesta exitosa (siempre con CORS)[reference:2]
      return new Response(JSON.stringify({ text: resultText, provider, model }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      // 5. Manejo de errores (siempre con CORS)[reference:3]
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  // Ruta no encontrada
  return new Response(JSON.stringify({ error: 'Ruta no encontrada.' }), {
    status: 404,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
