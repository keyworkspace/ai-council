import { chat } from './api.js';
import { getAgentById, getActiveAgents } from './agents.js';

/**
 * Construye el array de mensajes para un agente concreto.
 * El historial completo se pasa como contexto; el system prompt es específico del agente.
 */
function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  const dialogue = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: `[${m.agentName || 'Usuario'}]: ${m.text}`,
  }));
  return [sys, ...dialogue];
}

/**
 * Modo autónomo: itera por rondas y agentes, respetando el límite.
 * @param {Object} opts
 * @param {string} opts.topic
 * @param {Array}  opts.selectedAgentIds
 * @param {number} opts.maxRounds
 * @param {Function} opts.onMessage  - callback({agentId, agentName, text})
 * @param {Function} opts.onStatus   - callback(estado)
 * @param {AbortSignal} opts.signal
 */
export async function runAutonomous({ topic, selectedAgentIds, maxRounds, onMessage, onStatus, signal }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos seleccionados.');

  let history = [{ role: 'user', agentName: 'Usuario', text: `Tema de deliberación: ${topic}` }];

  // Apertura del DIRECTOR (si está seleccionado)
  const director = agents.find(a => a.id === 'director');
  if (director) {
    onStatus('El DIRECTOR abre la sesión…');
    const { text } = await chat({
      provider: director.provider,
      model: director.model,
      messages: buildMessages(director, history),
      temperature: director.temperature,
    });
    if (signal?.aborted) return;
    history.push({ role: 'assistant', agentId: director.id, agentName: director.name, text });
    onMessage({ agentId: director.id, agentName: director.name, avatar: director.avatar, text });
  }

  // Rondas
  const speakingAgents = agents.filter(a => a.id !== 'director' && a.id !== 'asesor');
  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    for (const agent of speakingAgents) {
      if (signal?.aborted) { onStatus('Detenido por el usuario.'); return; }
      onStatus(`Ronda ${ronda}/${maxRounds} · Habla ${agent.name}`);
      try {
        const { text } = await chat({
          provider: agent.provider,
          model: agent.model,
          messages: buildMessages(agent, history),
          temperature: agent.temperature,
        });
        if (signal?.aborted) return;
        history.push({ role: 'assistant', agentId: agent.id, agentName: agent.name, text });
        onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text });
      } catch (err) {
        onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ Error: ${err.message}` });
      }
    }
  }

  // Conclusión del ASESOR
  const asesor = agents.find(a => a.id === 'asesor');
  if (asesor && !signal?.aborted) {
    onStatus('El ASESOR formula la conclusión…');
    try {
      const { text } = await chat({
        provider: asesor.provider,
        model: asesor.model,
        messages: buildMessages(asesor, history),
        temperature: asesor.temperature,
      });
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text });
    } catch (err) {
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text: `⚠️ Error: ${err.message}` });
    }
  }
  onStatus('Sesión finalizada.');
}

/**
 * Modo dirigido: envía un mensaje del usuario a un agente concreto.
 */
export async function runDirected({ agentId, userText, history, onMessage }) {
  const agent = getAgentById(agentId);
  if (!agent || !agent.active) throw new Error('Agente no disponible.');

  const enrichedHistory = [
    ...history,
    { role: 'user', agentName: 'Usuario', text: userText },
  ];

  const { text } = await chat({
    provider: agent.provider,
    model: agent.model,
    messages: buildMessages(agent, enrichedHistory),
    temperature: agent.temperature,
  });

  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text });
  return text;
}
