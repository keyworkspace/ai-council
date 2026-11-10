export const config = { runtime: 'edge' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const FALLBACK_MODELS = {
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash']
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);

  if (url.pathname === '/api/chat' && req.method === 'GET') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    try {
      const { provider, model, messages, temperature = 0.5 } = await req.json();
      
      let safeMessages = messages;
      // 🚨 LÍMITE AMPLIADO A 80K CARACTERES Y MANTENIENDO MÁS CONTEXTO 🚨
      const totalChars = messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
      if (totalChars > 80000) {
        safeMessages = [messages[0], ...messages.slice(-15)];
      }

      let resultText = '';
      
      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
          for (const currentModel of FALLBACK_MODELS.groq) {
            let attempts = 0;
            while (attempts < 2) {
              try {
                const groqController = new AbortController();
                const timeout = setTimeout(() => groqController.abort(), 15000);

                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({ model: currentModel, messages: safeMessages, temperature, max_tokens: 4096, stream: true }),
                  signal: groqController.signal
                });
                clearTimeout(timeout);

                if (res.ok) {
                  return new Response(res.body, {
                    status: 200,
                    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream' }
                  });
                } else if (res.status === 429) {
                  await sleep(1500);
                  attempts++;
                } else {
                  break; 
                }
              } catch (e) {
                break; 
              }
            }
          }
        }
      }

      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        for (const currentModel of FALLBACK_MODELS.gemini) {
          try {
            const systemMsg = safeMessages.find(m => m.role === 'system');
            const contents = safeMessages.filter(m => m.role !== 'system').map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }],
            }));
            if (contents.length > 0 && contents[contents.length - 1].role === 'model') {
              contents.push({ role: 'user', parts: [{ text: 'Continúa.' }] });
            }
            const body = { contents, generationConfig: { temperature, maxOutputTokens: 4096 } };
            if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${geminiKey}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });

            if (res.ok) {
              const data = await res.json();
              resultText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
              return new Response(JSON.stringify({ text: resultText, provider: 'gemini' }), {
                status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
              });
            }
          } catch (e) {}
        }
      }

      throw new Error('Servidores de IA saturados. Intenta de nuevo.');

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Ruta no encontrada.' }), {
    status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
