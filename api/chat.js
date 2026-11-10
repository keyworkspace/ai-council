import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

export const config = { runtime: 'nodejs' }; // 🚨 Forzamos Node.js para Firebase

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
  });
}
const db = getFirestore();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const FALLBACK_MODELS = {
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash']
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    let uid;
    try {
      const decodedToken = await getAuth().verifyIdToken(idToken);
      uid = decodedToken.uid;
    } catch (error) {
      return res.status(401).json({ error: 'Token inválido o expirado.' });
    }

    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    let currentCredits = 50; 

    if (userDoc.exists) {
      currentCredits = userDoc.data().credits;
    } else {
      // Si es nuevo, lo creamos con 50 créditos
      await userRef.set({ credits: 50, lastUpdated: new Date() });
    }

    if (currentCredits <= 0) {
      return res.status(403).json({ error: 'Te has quedado sin créditos. Vuelve mañana.' });
    }

    try {
      const { provider, model, messages, temperature = 0.5 } = req.body;
      let safeMessages = messages;
      if (messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) > 80000) {
        safeMessages = [messages[0], ...messages.slice(-15)];
      }

      let resultText = '';
      
      // 1. Groq
      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
          for (const currentModel of FALLBACK_MODELS.groq) {
            let attempts = 0;
            while (attempts < 2) {
              try {
                const groqController = new AbortController();
                const timeout = setTimeout(() => groqController.abort(), 15000);

                const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                  body: JSON.stringify({ model: currentModel, messages: safeMessages, temperature, max_tokens: 4096, stream: true }),
                  signal: groqController.signal
                });
                clearTimeout(timeout);

                if (groqRes.ok) {
                  await userRef.set({ credits: currentCredits - 1, lastUpdated: new Date() }, { merge: true });
                  
                  res.setHeader('Content-Type', 'text/event-stream');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  
                  const reader = groqRes.body.getReader();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                  }
                  return res.end();
                } else if (groqRes.status === 429) {
                  await sleep(1500);
                  attempts++;
                } else {
                  break;
                }
              } catch (e) { break; }
            }
          }
        }
      }

      // 2. Gemini (Respaldo)
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

            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${geminiKey}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });

            if (geminiRes.ok) {
              const data = await geminiRes.json();
              resultText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
              await userRef.set({ credits: currentCredits - 1, lastUpdated: new Date() }, { merge: true });
              return res.status(200).json({ text: resultText, provider: 'gemini', creditsLeft: currentCredits - 1 });
            }
          } catch (e) {}
        }
      }

      throw new Error('Servidores de IA saturados. Intenta de nuevo.');

    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: 'Ruta no encontrada.' });
}
