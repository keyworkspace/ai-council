import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

export const config = { runtime: 'nodejs' };

if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      }),
    });
  } catch (err) {
    console.error("Error al inicializar Firebase en Vercel:", err.message);
  }
}
const db = getFirestore();

const FALLBACK_MODELS = {
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash']
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  // 🚨 1. SIEMPRE PONEMOS LAS CABECERAS CORS PRIMERO 🚨
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method === 'POST') {
    try {
      // 2. VALIDACIÓN DEL TOKEN
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
        return res.status(401).json({ error: 'Token inválido. Vuelve a iniciar sesión.' });
      }

      const userRef = db.collection('users').doc(uid);
      
      // 3. VERIFICAR Y RESTAR CRÉDITO
      let currentCredits = 50;
      try {
        await db.runTransaction(async (t) => {
          const doc = await t.get(userRef);
          if (doc.exists) {
            currentCredits = doc.data().credits;
          } else {
            t.set(userRef, { credits: 50, lastUpdated: new Date() });
          }
          
          if (currentCredits <= 0) {
            throw new Error('Sin créditos');
          }
          
          t.set(userRef, { credits: currentCredits - 1, lastUpdated: new Date() }, { merge: true });
        });
      } catch (e) {
        if (e.message === 'Sin créditos') {
          return res.status(403).json({ error: 'Te has quedado sin créditos. Vuelve más tarde.' });
        }
        throw new Error('Error de base de datos: ' + e.message);
      }

      // 4. LLAMADA A LA IA
      const { provider, model, messages, temperature = 0.5 } = req.body;
      
      let safeMessages = messages;
      if (messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) > 80000) {
        safeMessages = [messages[0], ...messages.slice(-15)];
      }

      let resultText = '';
      
      if (provider === 'groq') {
        const apiKey = process.env.GROQ_API_KEY;
        if (apiKey) {
          for (const currentModel of FALLBACK_MODELS.groq) {
            try {
              const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ model: currentModel, messages: safeMessages, temperature, max_tokens: 4096 }),
              });

              if (groqRes.ok) {
                const data = await groqRes.json();
                resultText = data.choices?.[0]?.message?.content || '';
                return res.status(200).json({ text: resultText, provider: 'groq', creditsLeft: currentCredits - 1 });
              } else if (groqRes.status === 429) {
                await sleep(1500);
              } else {
                break;
              }
            } catch (e) { break; }
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

            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${geminiKey}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });

            if (geminiRes.ok) {
              const data = await geminiRes.json();
              resultText = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
              return res.status(200).json({ text: resultText, provider: 'gemini', creditsLeft: currentCredits - 1 });
            }
          } catch (e) {}
        }
      }

      throw new Error('Servidores de IA saturados. Intenta de nuevo.');

    } catch (err) {
      // 🚨 SI HAY CUALQUIER ERROR, DEVOLVEMOS EL CRÉDITO Y EL MENSAJE EXACTO 🚨
      // (Si el error es por falta de créditos, no llegó aquí)
      await db.collection('users').doc(req.headers.authorization.split('Bearer ')[1]).set({ credits: currentCredits }, { merge: true }).catch(()=>{});
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(404).json({ error: 'Ruta no encontrada.' });
}
