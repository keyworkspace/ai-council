import { chat } from './api.js';
import { getAgentById } from './agents.js';

function sanitizeText(text) {
  if (!text) return '';
  let clean = text.replace(/^\[[^\]]+\]:\s*/gi, '');
  clean = clean.replace(/^[A-Z\.\s\-]{3,}:\s*/gi, '');
  return clean.trim();
}

function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  
  // Truncamos el historial si es muy largo para no perder el foco
  let contextToSend = history;
  if (history.length > 8) {
    contextToSend = history.slice(-8);
  }

  // 🚨 FORMATO DE TRANSCRIPCIÓN DE SALA DE JUNTAS 🚨
  const dialogue = contextToSend.map(m => {
    const safeText = sanitizeText(m.text);
    const speaker = m.role === 'user' ? 'USUARIO' : m.agentName;
    
    return {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: `[${speaker}]: ${safeText}`,
    };
  });
  
  return [sys, ...dialogue];
}

function detectRequestedAgent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower.includes('ultron')) return 'critico';
  if (lower.includes('friday') || lower.includes('f.r.i.d.a.y')) return 'analista';
  if (lower.includes('edith') || lower.includes('e.d.i.t.h')) return 'estratega';
  if (lower.includes('jarvis') || lower.includes('j.a.r.v.i.s')) return 'director';
  return null;
}

function isFarewell(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const words = ['adios', 'adiós', 'nos vemos', 'hasta luego', 'buenas noches', 'me voy', 'hasta mañana', 'suerte', 'chao', 'descansar', 'sueño'];
  return words.some(w => lower.includes(w));
}

async function agentSpeak(agent, currentHistory, onMessage, onStatus, statusMsg, signal) {
  if (signal?.aborted) return { text: '', aborted: true };
  onStatus(statusMsg);
  
  try {
    const { text } = await chat({
      provider: agent.provider, model: agent.model,
      messages: buildMessages(agent, currentHistory), temperature: agent.temperature,
    });
    
    if (signal?.aborted) return { text: '', aborted: true };

    let cleanText = sanitizeText(text);
    cleanText = cleanText.replace(/\[DRAFT SECRETO[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace(/\[DRAFT[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace('[PAUSA_USUARIO]', '').trim();

    const msg = { agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText };
    currentHistory.push({ role: 'assistant', ...msg });
    onMessage(msg);

    return { text: cleanText, aborted: false };
  } catch (err) {
    onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ Error: ${err.message}` });
    return { text: '', aborted: false };
  }
}

export async function runAutonomous({ history, selectedAgentIds, maxRounds, onMessage, onStatus, signal }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos.');

  let currentHistory = [...history];
  const lastUserMsg = history[history.length - 1]?.text || '';
  const director = agents.find(a => a.id === 'director');

  if (isFarewell(lastUserMsg)) {
    if (director) await agentSpeak(director, currentHistory, onMessage, onStatus, `Despidiéndose`, signal);
    return; 
  }

  const requestedId = detectRequestedAgent(lastUserMsg);
  if (requestedId) {
    const targetAgent = agents.find(a => a.id === requestedId);
    if (targetAgent) {
      onStatus(`Llamando a ${targetAgent.name}...`);
      await agentSpeak(targetAgent, currentHistory, onMessage, onStatus, `Respondiendo al usuario`, signal);
      return; 
    }
  }

  // RONDA DE DEBATE EN GRUPO
  const analista = agents.find(a => a.id === 'analista');
  const critico = agents.find(a => a.id === 'critico');
  const estratega = agents.find(a => a.id === 'estratega');

  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    if (director && ronda === 1) {
      const res = await agentSpeak(director, currentHistory, onMessage, onStatus, `J.A.R.V.I.S. modera la sala...`, signal);
      if (res.aborted) return;
    }
    if (analista) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `F.R.I.D.A.Y. expone...`, signal);
      if (res.aborted) return;
    }
    if (critico) {
      const res = await agentSpeak(critico, currentHistory, onMessage, onStatus, `ULTRON ataca los argumentos...`, signal);
      if (res.aborted) return;
    }
    // Hacemos que F.R.I.D.A.Y. o E.D.I.T.H. puedan responderle a ULTRON
    if (estratega) {
      const res = await agentSpeak(estratega, currentHistory, onMessage, onStatus, `E.D.I.T.H. propone un plan...`, signal);
      if (res.aborted) return;
    }
  }
  onStatus('Sesión finalizada.');
}

export async function runDirected({ agentId, userText, history, onMessage }) {
  const agent = getAgentById(agentId);
  if (!agent || !agent.active) throw new Error('Agente no disponible.');
  const enrichedHistory = [...history, { role: 'user', agentName: 'Usuario', text: userText }];
  const { text } = await chat({
    provider: agent.provider, model: agent.model,
    messages: buildMessages(agent, enrichedHistory), temperature: agent.temperature,
  });
  
  const cleanText = sanitizeText(text).replace('[PAUSA_USUARIO]', '').trim();
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });
  return cleanText;
}
