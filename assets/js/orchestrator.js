import { chat } from './api.js';
import { getAgentById } from './agents.js';

function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  
  let contextToSend = history;
  if (history.length > 10) {
    contextToSend = [history[0], ...history.slice(-8)];
  }

  const dialogue = contextToSend.map(m => ({
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

    // 🚨 LIMPIADOR DE ALUCINACIONES 🚨
    // Borra pensamientos internos o borradores si el modelo se confunde.
    cleanText = cleanText.replace(/\[DRAFT SECRETO[\s\S]*?-----+/gi, '');
    cleanText = cleanText.replace(/\[ESTRATEGA\]:\s*/gi, '');
    cleanText = cleanText.replace(/\[ANALISTA\]:\s*/gi, '');
    cleanText = cleanText.replace(/\[CRÍTICO\]:\s*/gi, '');

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
  const director = agents.find(a => a.id === 'director');
  const analista = agents.find(a => a.id === 'analista');
  const critico = agents.find(a => a.id === 'critico');
  const estratega = agents.find(a => a.id === 'estratega');
  const asesor = agents.find(a => a.id === 'asesor');

  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    if (director) {
      const res = await agentSpeak(director, currentHistory, onMessage, onStatus, `Ronda ${ronda} · El DIRECTOR modera...`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (analista) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${analista.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (critico) {
      const res = await agentSpeak(critico, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${critico.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (analista && critico) {
      const res = await agentSpeak(analista, currentHistory, onMessage, onStatus, `Ronda ${ronda} · ${analista.name} responde...`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (estratega) {
      const res = await agentSpeak(estratega, currentHistory, onMessage, onStatus, `Ronda ${ronda} · Habla ${estratega.name}`, signal);
      if (res.aborted || res.needsUser) return;
    }

    if (ronda === maxRounds && asesor) {
      const res = await agentSpeak(asesor, currentHistory, onMessage, onStatus, `El ASESOR concluye...`, signal);
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
  
  const cleanText = text.replace('[PAUSA_USUARIO]', '').trim();
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });
  return cleanText;
}
