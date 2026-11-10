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
  
  // Mantenemos un contexto amplio (últimos 12 mensajes) para que no pierdan el hilo
  let contextToSend = history;
  if (history.length > 12) {
    contextToSend = history.slice(-12);
  }

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
    if (signal?.aborted || err.name === 'AbortError') {
      return { text: '', aborted: true };
    }
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

  // 1. ¿El usuario se está despidiendo? Se detiene todo.
  if (isFarewell(lastUserMsg)) {
    if (director) await agentSpeak(director, currentHistory, onMessage, onStatus, `J.A.R.V.I.S. se despide`, signal);
    return; 
  }

  // 2. ¿El usuario llamó a alguien específico? Habla solo ese.
  const requestedId = detectRequestedAgent(lastUserMsg);
  if (requestedId) {
    const targetAgent = agents.find(a => a.id === requestedId);
    if (targetAgent) {
      onStatus(`Llamando a ${targetAgent.name}...`);
      await agentSpeak(targetAgent, currentHistory, onMessage, onStatus, `${targetAgent.name} responde`, signal);
      return; 
    }
  }

  // 3. DEBATE CONTINUO (El flujo principal)
  // Definimos el orden de la mesa redonda
  const order = ['director', 'analista', 'critico', 'estratega'];
  let startIndex = 0;

  // Buscamos quién fue el último agente que habló para saber a quién le toca
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  
  if (lastAssistant) {
    const lastIdx = order.indexOf(lastAssistant.agentId);
    if (lastIdx !== -1) {
      startIndex = (lastIdx + 1) % order.length;
      // Si el siguiente es el director, lo saltamos para que no reinicie la sesión.
      // Preferimos que el debate siga fluyendo entre los analistas y estrategas.
      if (order[startIndex] === 'director') startIndex = 1; 
    }
  }

  // El debate se ejecuta durante la cantidad de turnos configurada (Ciclos)
  for (let i = 0; i < maxRounds; i++) {
    if (signal?.aborted) return;

    const currentAgentId = order[(startIndex + i) % order.length];
    const currentAgent = agents.find(a => a.id === currentAgentId);

    if (currentAgent) {
      const res = await agentSpeak(
        currentAgent, 
        currentHistory, 
        onMessage, 
        onStatus, 
        `${currentAgent.name} interviene...`, 
        signal
      );
      
      if (res.aborted) return;
    }
  }
  
  onStatus('Sesión en pausa. Esperando tu intervención.');
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
