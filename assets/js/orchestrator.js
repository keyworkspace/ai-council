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
  let contextToSend = history;
  if (history.length > 8) contextToSend = history.slice(-8);

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

async function agentSpeak(agent, currentHistory, onMessage, onStatus, statusMsg, signal, onChunk) {
  if (signal?.aborted) return { text: '', aborted: true };
  onStatus(statusMsg);
  
  try {
    const { text } = await chat({
      provider: agent.provider, model: agent.model,
      messages: buildMessages(agent, currentHistory), temperature: agent.temperature,
    }, (chunk) => {
      // 🚨 Pasamos el chunk a la UI 🚨
      if (onChunk) onChunk(chunk, agent.name, agent.avatar);
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
    if (signal?.aborted || err.name === 'AbortError') return { text: '', aborted: true };
    onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ Error: ${err.message}` });
    return { text: '', aborted: false };
  }
}

export async function runAutonomous({ history, selectedAgentIds, maxRounds, onMessage, onStatus, signal, onChunk }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos.');

  let currentHistory = [...history];
  const lastUserMsg = history[history.length - 1]?.text || '';
  const director = agents.find(a => a.id === 'director');

  if (isFarewell(lastUserMsg)) {
    if (director) await agentSpeak(director, currentHistory, onMessage, onStatus, `Despidiéndose`, signal, onChunk);
    return; 
  }

  const requestedId = detectRequestedAgent(lastUserMsg);
  if (requestedId) {
    const targetAgent = agents.find(a => a.id === requestedId);
    if (targetAgent) {
      onStatus(`Llamando a ${targetAgent.name}...`);
      await agentSpeak(targetAgent, currentHistory, onMessage, onStatus, `Respondiendo`, signal, onChunk);
      return; 
    }
  }

  const analista = agents.find(a => a.id === 'analista');
  const critico = agents.find(a => a.id === 'critico');
  const estratega = agents.find(a => a.id === 'estratega');
  const order = ['director', 'analista', 'critico', 'estratega'];
  
  let startIndex = 0;
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (lastAssistant) {
    const lastIdx = order.indexOf(lastAssistant.agentId);
    if (lastIdx !== -1) {
      startIndex = (lastIdx + 1) % order.length;
      if (order[startIndex] === 'director') startIndex = 1; 
    }
  }

  for (let i = 0; i < maxRounds; i++) {
    if (signal?.aborted) return;
    const currentAgentId = order[(startIndex + i) % order.length];
    const currentAgent = agents.find(a => a.id === currentAgentId);

    if (currentAgent) {
      const res = await agentSpeak(currentAgent, currentHistory, onMessage, onStatus, `${currentAgent.name} interviene...`, signal, onChunk);
      if (res.aborted) return;
    }
  }
  onStatus('Sesión en pausa. Esperando tu intervención.');
}

export async function runDirected({ agentId, userText, history, onMessage, onChunk }) {
  const agent = getAgentById(agentId);
  if (!agent || !agent.active) throw new Error('Agente no disponible.');
  const enrichedHistory = [...history, { role: 'user', agentName: 'Usuario', text: userText }];
  
  const { text } = await chat({
    provider: agent.provider, model: agent.model,
    messages: buildMessages(agent, enrichedHistory), temperature: agent.temperature,
  }, (chunk) => {
    if (onChunk) onChunk(chunk, agent.name, agent.avatar);
  });
  
  const cleanText = sanitizeText(text).replace('[PAUSA_USUARIO]', '').trim();
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });
  return cleanText;
}
