import { chat } from './api.js';
import { getAgentById } from './agents.js';

// 🚨 FUNCIÓN PARA LIMPIAR EL TEXTO DE ETIQUETAS 🚨
function sanitizeText(text) {
  if (!text) return '';
  // Borra [CualquierCosa]: al inicio
  let clean = text.replace(/^\[[^\]]+\]:\s*/gi, '');
  // Borra "Nombre:" al inicio
  clean = clean.replace(/^[A-Z\.\s\-]{3,}:\s*/gi, '');
  return clean.trim();
}

function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  
  let contextToSend = history;
  if (history.length > 10) {
    contextToSend = [history[0], ...history.slice(-9)];
  }

  // 🚨 HISTORIAL TOTALMENTE LIMPIO 🚨
  const dialogue = contextToSend.map(m => {
    const safeText = sanitizeText(m.text);
    return {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: `${m.agentName || 'Usuario'} dijo: ${safeText}`,
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

// 🚨 DETECTOR DE DESPEDIDAS 🚨
function isFarewell(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const words = ['adios', 'adiós', 'nos vemos', 'hasta luego', 'buenas noches', 'me voy', 'hasta mañana', 'suerte', 'chao'];
  return words.some(w => lower.includes(w));
}

async function agentSpeak(agent, currentHistory, onMessage, onStatus, statusMsg, signal) {
  if (signal?.aborted) return { text: '', needsUser: false, aborted: true };
  onStatus(statusMsg);
  
  try {
    const { text } = await chat({
      provider: agent.provider, model: agent.model,
      messages: buildMessages(agent, currentHistory), temperature: agent.temperature,
    });
    
    if (signal?.aborted) return { text: '', needsUser: false, aborted: true };

    let cleanText = sanitizeText(text);
    let needsUser = false;

    // Limpieza de borradores
    cleanText = cleanText.replace(/\[DRAFT SECRETO[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace(/\[DRAFT[\s\S]*?-----+/gi, '');

    if (cleanText.includes('[PAUSA_USUARIO]')) {
      needsUser = true;
      cleanText = cleanText.replace('[PAUSA_USUARIO]', '').trim();
    }

    const msg = { agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText.trim() };
    currentHistory.push({ role: 'assistant', ...msg });
    onMessage(msg);

    return { text: cleanText, needsUser, aborted: false };
  } catch (err) {
    onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ Error: ${err.message}` });
    return { text: '', needsUser: false, aborted: false };
  }
}

export async function runAutonomous({ history, selectedAgentIds, maxRounds, onMessage, onStatus, signal }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos.');

  let currentHistory = [...history];

  // 1. Interceptor de agente específico
  const lastUserMsg = history[history.length - 1]?.text || '';
  const requestedId = detectRequestedAgent(lastUserMsg);
  
  if (requestedId) {
    const targetAgent = agents.find(a => a.id === requestedId);
    if (targetAgent) {
      onStatus(`Llamando a ${targetAgent.name}...`);
      await agentSpeak(targetAgent, currentHistory, onMessage, onStatus, `El usuario solicita a ${targetAgent.name}`, signal);
      return; 
    }
  }

  const director = agents.find(a => a.id === 'director');
  const analista = agents.find(a => a.id === 'analista');
  const critico = agents.find(a => a.id === 'critico');
  const estratega = agents.find(a => a.id === 'estratega');
  const asesor = agents.find(a => a.id === 'asesor') || agents.find(a => a.id === 'director');

  // 2. 🚨 INTERCEPTOR DE DESPEDIDA 🚨
  if (isFarewell(lastUserMsg)) {
    if (director) {
      onStatus(`Despidiéndose...`);
      await agentSpeak(director, currentHistory, onMessage, onStatus, `J.A.R.V.I.S. se despide`, signal);
    }
    return; // Detenemos el bucle, no hay debate si el usuario se va.
  }

  // 3. Bucle normal
  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    if (director) {
      const res = await agentSpeak(director, currentHistory, onMessage, onStatus, `Ronda ${ronda} · J.A.R.V.I.S. modera...`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (analista) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla F.R.I.D.A.Y.`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (critico) {
      const res = await agentSpeak(critico, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ULTRON`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (analista && critico) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · F.R.I.D.A.Y. responde a ULTRON`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (estratega) {
      const res = await agentSpeak(estratega, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla E.D.I.T.H.`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (ronda === maxRounds && asesor) {
      const res = await agentSpeak(asesor, currentHistory, onMessage, onStatus, `El ASESOR formula la conclusión...`, signal);
      if (res.aborted || res.needsUser) return;
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
