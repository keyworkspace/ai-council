import { chat } from './api.js';
import { getAgentById } from './agents.js';

function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  const dialogue = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: `[${m.agentName || 'Usuario'}]: ${m.text}`,
  }));
  return [sys, ...dialogue];
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

    let cleanText = text;
    let needsUser = false;

    if (text.includes('[PAUSA_USUARIO]')) {
      needsUser = true;
      cleanText = text.replace('[PAUSA_USUARIO]', '').trim();
    }

    const msg = { agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText };
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
  if (!agents.length) throw new Error('No hay agentes activos seleccionados.');

  let currentHistory = [...history];

  // 1. El DIRECTOR abre el debate
  const director = agents.find(a => a.id === 'director');
  if (director) {
    const res = await agentSpeak(director, currentHistory, onMessage, onStatus, 'El DIRECTOR abre la sesión…', signal);
    if (res.aborted || res.needsUser) return;
  }

  // 2. Rondas de debate
  const analista = agents.find(a => a.id === 'analista');
  const critico = agents.find(a => a.id === 'critico');
  const estratega = agents.find(a => a.id === 'estratega');

  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    // TURNO DEL ANALISTA
    if (analista) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${analista.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    // TURNO DEL CRÍTICO (Ataca al Analista)
    if (critico) {
      const res = await agentSpeak(critico, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${critico.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    // 🚨 CONTRA-RÉPLICA: El ANALISTA se defiende de las críticas
    if (analista && critico) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · ${analista.name} responde a ${critico.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    // TURNO DEL ESTRATEGA
    if (estratega) {
      const res = await agentSpeak(estratega, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${estratega.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }
  }

  // 3. Conclusión final
  const asesor = agents.find(a => a.id === 'asesor');
  if (asesor && !signal?.aborted) {
    await agentSpeak(asesor, currentHistory, onMessage, onStatus, 'El ASESOR formula la conclusión…', signal);
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
  
  const cleanText = text.replace('[PAUSA_USUARIO]', '').trim();
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });
  return cleanText;
}
