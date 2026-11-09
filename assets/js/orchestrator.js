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

export async function runAutonomous({ topic, selectedAgentIds, maxRounds, onMessage, onStatus, signal }) {
  const agents = selectedAgentIds.map(getAgentById).filter(a => a && a.active);
  if (!agents.length) throw new Error('No hay agentes activos seleccionados.');

  // Si el historial está vacío, el usuario dicta el tema. Si no, continuamos el hilo.
  let history = [{ role: 'user', agentName: 'Usuario', text: `Tema de deliberación: ${topic}` }];

  // Apertura del DIRECTOR
  const director = agents.find(a => a.id === 'director');
  if (director) {
    onStatus('El DIRECTOR abre la sesión…');
    const { text } = await chat({
      provider: director.provider, model: director.model,
      messages: buildMessages(director, history), temperature: director.temperature,
    });
    if (signal?.aborted) return;
    history.push({ role: 'assistant', agentId: director.id, agentName: director.name, text });
    onMessage({ agentId: director.id, agentName: director.name, avatar: director.avatar, text });
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
          messages: buildMessages(agent, history), temperature: agent.temperature,
        });
        if (signal?.aborted) return;

        let cleanText = text;
        let needsUser = false;

        // DETECCIÓN DE PAUSA
        if (text.includes('[PAUSA_USUARIO]')) {
          needsUser = true;
          cleanText = text.replace('[PAUSA_USUARIO]', '').trim(); // Limpiamos la etiqueta para que no se vea fea
        }

        history.push({ role: 'assistant', agentId: agent.id, agentName: agent.name, text: cleanText });
        onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text: cleanText });

        if (needsUser) {
          onStatus('El consejo espera tu intervención...');
          return; // DETENEMOS EL DEBATE AQUÍ. La pelota está en tu tejado.
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
        messages: buildMessages(asesor, history), temperature: asesor.temperature,
      });
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text });
    } catch (err) {
      onMessage({ agentId: asesor.id, agentName: asesor.name, avatar: asesor.avatar, text: `⚠️ Error: ${err.message}` });
    }
  }
  onStatus('Sesión finalizada.');
}

// El modo dirigido se mantiene igual
export async function runDirected({ agentId, userText, history, onMessage }) {
  const agent = getAgentById(agentId);
  if (!agent || !agent.active) throw new Error('Agente no disponible.');
  const enrichedHistory = [...history, { role: 'user', agentName: 'Usuario', text: userText }];
  const { text } = await chat({
    provider: agent.provider, model: agent.model,
    messages: buildMessages(agent, enrichedHistory), temperature: agent.temperature,
  });
  onMessage({ agentId: agent.id, agentName: agent.name, avatar: agent.avatar, text });
  return text;
}