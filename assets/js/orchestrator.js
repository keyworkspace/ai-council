import { chat } from './api.js';
import { getAgentById } from './agents.js';

/**
 * Construye el historial para la IA.
 * Si el agente es el DIRECTOR, le pasamos el hilo completo.
 * Si es otro agente, le pasamos el hilo para que sepa de qué se habla.
 */
function buildMessages(agent, history) {
  const sys = { role: 'system', content: agent.systemPrompt };
  const dialogue = history.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: `[${m.agentName || 'Usuario'}]: ${m.text}`,
  }));
  return [sys, ...dialogue];
}

export async function runAutonomous({ history, selectedAgentIds, maxRounds, onMessage, onStatus, signal }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos seleccionados.');

  // Clonamos el historial para no mutar el original directamente
  let currentHistory = [...history];

  // Apertura / Turno del DIRECTOR
  const director = agents.find(a => a.id === 'director');
  if (director) {
    onStatus('El DIRECTOR toma la palabra…');
    const { text } = await chat({
      provider: director.provider, model: director.model,
      messages: buildMessages(director, currentHistory), temperature: director.temperature,
    });
    if (signal?.aborted) return;
    
    // Limpiamos posibles etiquetas de pausa si el director se equivoca
    const cleanText = text.replace('[PAUSA_USUARIO]', '').trim();
    const msg = { agentId: director.id, agentName: director.name, avatar: director.avatar, text: cleanText };
    currentHistory.push({ role: 'assistant', ...msg });
    onMessage(msg);
  }

  // Rondas de debate
  const speakingAgents = agents.filter(a => a.id !== 'director' && a.id !== 'asesor');
  for (let ronda = 1; ronda <= maxRounds; ronda++) {
    for (const agent of speakingAgents) {
      if (signal?.aborted) { onStatus('Detenido por el usuario.'); return; }
      onStatus(`Ronda ${ronda}/${maxRounds} · Habla ${agent.name}`);
      
      try {
        const { text } = await chat({
          provider: agent.provider, model: agent.model,
          messages: buildMessages(agent, currentHistory), temperature: agent.temperature,
        });
        if (signal?.aborted) return;

        let cleanText = text;
        let needsUser = false;

        // 🚨 DETECCIÓN DE PAUSA: Si el agente pide opinión al usuario
        if (text.includes('[PAUSA_USUARIO]')) {
          needsUser = true;
          cleanText = text.replace('[PAUSA_USUARIO]', '').trim();
        }

        const msg = { agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText };
        currentHistory.push({ role: 'assistant', ...msg });
        onMessage(msg);

        if (needsUser) {
          onStatus('El consejo espera tu intervención para continuar...');
          return; // DETENEMOS EL DEBATE AQUÍ. Esperamos al usuario.
        }

      } catch (err) {
        onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: `⚠️ Error: ${err.message}` });
      }
    }
  }

  // Conclusión final (solo si terminaron las rondas sin pausas)
  const asesor = agents.find(a => a.id === 'asesor');
  if (asesor && !signal?.aborted) {
    onStatus('El ASESOR formula la conclusión…');
    try {
      const { text } = await chat({
        provider: asesor.provider, model: asesor.model,
        messages: buildMessages(asesor, currentHistory), temperature: asesor.temperature,
      });
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text });
    } catch (err) {
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text: `⚠️ Error: ${err.message}` });
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