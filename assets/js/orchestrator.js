import { chat } from './api.js';
import { getAgentById, AGENTS } from './agents.js';

function sanitizeText(text) {
  if (!text) return '';
  let clean = text.replace(/^\[[^\]]+\]:\s*/gi, '');
  clean = clean.replace(/^[A-Z\.\s\-]{3,}:\s*/gi, '');
  return clean.trim();
}

function buildMessages(agent, history, activeAgentIds) {
  const activeNames = AGENTS.filter(a => activeAgentIds.includes(a.id)).map(a => a.name).join(', ');
  const inactiveNames = AGENTS.filter(a => !activeAgentIds.includes(a.id) && a.active).map(a => a.name).join(', ');
  
  let sysContent = agent.systemPrompt;
  sysContent += `\n\n[CONTEXTO DE LA SALA]: Estás en una sesión junto a: ${activeNames}. Los que NO están conectados son: ${inactiveNames || 'Ninguno'}.`;
  sysContent += `\n[INSTRUCCIÓN]: Lee atentamente el historial de la conversación que te acompaña. Tienes memoria de todo lo que se ha hablado en esta sesión.`;

  const sys = { role: 'system', content: sysContent };
  
  let contextToSend = history;
  if (history.length > 25) {
    contextToSend = history.slice(-25);
  }

  const dialogue = contextToSend.map(m => {
    const safeText = sanitizeText(m.text);
    const speaker = m.role === 'user' ? 'Usuario' : m.agentName;
    
    return {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: `${speaker}: ${safeText}`,
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

async function agentSpeak(agent, currentHistory, activeAgentIds, onMessage, onStatus, statusMsg, signal, onChunk) {
  if (signal?.aborted) return { text: '', aborted: true };
  onStatus(statusMsg);
  
  try {
    const { text } = await chat({
      provider: agent.provider, model: agent.model,
      messages: buildMessages(agent, currentHistory, activeAgentIds), 
      temperature: agent.temperature,
    }, (chunk) => {
      if (onChunk) onChunk(chunk, agent.name, agent.avatar);
    });
    
    if (signal?.aborted) return { text: '', aborted: true };

    let cleanText = sanitizeText(text);
    cleanText = cleanText.replace(/\[DRAFT SECRETO[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace(/\[DRAFT[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace('[PAUSA_USUARIO]', '').trim();

    if (!cleanText) return { text: '', aborted: false };

    const msg = { agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText };
    currentHistory.push({ role: 'assistant', ...msg });
    onMessage(msg);

    return { text: cleanText, aborted: false };
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError') return { text: '', aborted: true };
    // 🚨 MUESTRA EL ERROR REAL EN EL CHAT 🚨
    onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ *${err.message}*` });
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
    if (director) await agentSpeak(director, currentHistory, selectedAgentIds, onMessage, onStatus, `J.A.R.V.I.S. se despide`, signal, onChunk);
    return; 
  }

  const requestedId = detectRequestedAgent(lastUserMsg);
  if (requestedId) {
    const targetAgent = agents.find(a => a.id === requestedId);
    if (targetAgent) {
      onStatus(`Llamando a ${targetAgent.name}...`);
      await agentSpeak(targetAgent, currentHistory, selectedAgentIds, onMessage, onStatus, `${targetAgent.name} responde`, signal, onChunk);
      return; 
    } else {
      const missingAgent = getAgentById(requestedId);
      const responder = director || agents[0]; 
      onStatus(`Avisando que ${missingAgent.name} no está...`);
      await agentSpeak(responder, currentHistory, selectedAgentIds, onMessage, onStatus, `${responder.name} interviene`, signal, onChunk);
      return;
    }
  }

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
      const res = await agentSpeak(currentAgent, currentHistory, selectedAgentIds, onMessage, onStatus, `${currentAgent.name} interviene...`, signal, onChunk);
      if (res.aborted) return;
    }
  }
  onStatus('Sesión en pausa. Esperando tu intervención.');
}

export async function runDirected({ agentId, userText, history, onMessage, onChunk, selectedAgentIds }) {
  const agent = getAgentById(agentId);
  if (!agent || !agent.active) throw new Error('Agente no disponible.');
  
  const enrichedHistory = [...history, { role: 'user', agentName: 'Usuario', text: userText }];
  
  const { text } = await chat({
    provider: agent.provider, model: agent.model,
    messages: buildMessages(agent, enrichedHistory, selectedAgentIds || [agent.id]), 
    temperature: agent.temperature,
  }, (chunk) => {
    if (onChunk) onChunk(chunk, agent.name, agent.avatar);
  });
  
  const cleanText = sanitizeText(text).replace('[PAUSA_USUARIO]', '').trim();
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });
  return cleanText;
}
