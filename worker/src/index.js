/**
 * Cloudflare Worker — proxy para AI COUNCIL.
 * Recibe { provider, model, messages, temperature } del frontend,
 * inyecta la clave desde secretos y normaliza la respuesta.
 */

const CORS_ORIGIN = '*'; // En producción, sustituir por 'https://TU_USUARIO.github.io'

// ── Utilidades ──
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
});

const error = (msg, status = 400) => json({ error: msg }, status);

// ── Adaptador Gemini ──
async function callGemini({ model, messages, temperature }, apiKey) {
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body = {
    contents,
    generationConfig: { temperature: Math.min(Math.max(temperature, 0), 2) },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return { text, provider: 'gemini', model };
}

// ── Adaptador compatible con OpenAI (Groq y OpenRouter) ──
async function callOpenAICompatible({ model, messages, temperature }, apiKey, baseUrl, providerName) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: 1024 }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${providerName} ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return { text, provider: providerName, model };
}

// ── Enrutador de proveedores ──
async function route(env, payload) {
  const { provider, model, messages, temperature = 0.5 } = payload;
  if (!provider || !model || !Array.isArray(messages)) {
    throw new Error('Faltan parámetros: provider, model o messages.');
  }

  switch (provider) {
    case 'gemini': {
      const key = env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY no configurada.');
      return callGemini({ model, messages, temperature }, key);
    }
    case 'groq': {
      const key = env.GROQ_API_KEY;
      if (!key) throw new Error('GROQ_API_KEY no configurada.');
      return callOpenAICompatible({ model, messages, temperature }, key, 'https://api.groq.com/openai/v1', 'groq');
    }
    case 'openrouter': {
      const key = env.OPENROUTER_API_KEY;
      if (!key) throw new Error('OPENROUTER_API_KEY no configurada.');
      return callOpenAICompatible({ model, messages, temperature }, key, 'https://openrouter.ai/api/v1', 'openrouter');
    }
    default:
      throw new Error(`Proveedor no soportado: ${provider}`);
  }
}

// ── Handler principal ──
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': CORS_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const payload = await request.json();
        // Validación básica
        if (JSON.stringify(payload).length > 50_000) {
          return error('Payload demasiado grande.', 413);
        }
        const result = await route(env, payload);
        return json(result);
      } catch (err) {
        return error(err.message, 502);
      }
    }

    return error('Ruta no encontrada.', 404);
  },
};
