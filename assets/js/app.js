import { AGENTS, getActiveAgents, getAgentById } from './agents.js';
import { runAutonomous, runDirected } from './orchestrator.js';
import { getAllRooms, saveRoom, deleteRoom } from './db.js';
import { checkHealth } from './api.js';

const state = {
  rooms: [],
  currentRoomId: null,
  history: [],            
  abortController: null,
  isRunning: false,
};

const $ = (sel) => document.querySelector(sel);
const roomListEl = $('#room-list');
const agentListEl = $('#agent-list');
const messagesEl = $('#messages');
const roomNameEl = $('#room-name');
const roomTopicEl = $('#room-topic');
const roomStatusEl = $('#room-status');
const modeSelect = $('#mode-select');
const agentSelect = $('#agent-select');
const maxRoundsInput = $('#max-rounds');
const btnSend = $('#btn-send');
const btnStop = $('#btn-stop');
const userInput = $('#user-input');
const dialogRoom = $('#dialog-room');
const sidebarEl = $('#sidebar');
const btnScrollBottom = $('#btn-scroll-bottom');

let activeStreamingEl = null;
let activeStreamingAgent = null;

async function init() {
  bindEvents();
  renderAgentList();
  try { await loadRooms(); } catch (e) { console.error(e); }
  try { await checkHealth(); } catch (e) { console.error(e); }
}

// 🚨 RENDERIZADO DINÁMICO DE AGENTES (Muestra si están ON u OFF) 🚨
function renderAgentList() {
  agentListEl.innerHTML = '';
  const currentRoom = state.rooms.find(r => r.id === state.currentRoomId);
  const activeIds = currentRoom ? currentRoom.agentIds : AGENTS.map(a => a.id);

  AGENTS.forEach(a => {
    const isActive = activeIds.includes(a.id);
    const li = document.createElement('li');
    li.className = isActive ? 'agent-on' : 'agent-off';
    li.style.cursor = 'pointer';
    li.title = isActive ? 'Desactivar agente' : 'Activar agente';
    
    // Evitar que el usuario apague a todos los agentes
    li.onclick = () => toggleAgent(a.id);

    li.innerHTML = `
      <span style="display:flex;align-items:center;gap:0.4rem">
        <span class="agent-dot ${isActive ? '' : 'off'}"></span>
        <span>${a.avatar} ${a.name}</span>
      </span>
      <small style="color:${isActive ? 'var(--accent-cyan)' : 'var(--text-muted)'}; font-weight:${isActive ? 'bold' : 'normal'};">
        ${isActive ? 'ON' : 'OFF'}
      </small>
    `;
    agentListEl.appendChild(li);
  });
}

async function toggleAgent(agentId) {
  if (!state.currentRoomId) {
    alert('Primero selecciona o crea una sala.');
    return;
  }
  const room = state.rooms.find(r => r.id === state.currentRoomId);
  if (!room) return;

  const index = room.agentIds.indexOf(agentId);
  if (index > -1) {
    if (room.agentIds.length <= 1) {
      alert('Debe haber al menos un agente activo en la sala.');
      return;
    }
    room.agentIds.splice(index, 1); // Apagar
  } else {
    room.agentIds.push(agentId); // Encender
  }

  await saveRoom(room);
  renderAgentList();
  updateAgentSelect(room.agentIds);
}

async function loadRooms() {
  state.rooms = await getAllRooms();
  state.rooms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  renderRoomList();
}

function renderRoomList() {
  roomListEl.innerHTML = '';
  state.rooms.forEach(r => {
    const li = document.createElement('li');
    li.textContent = r.name;
    li.classList.toggle('active', r.id === state.currentRoomId);
    li.onclick = () => selectRoom(r.id);
    roomListEl.appendChild(li);
  });
}

async function selectRoom(id) {
  if (state.isRunning) return;
  const room = state.rooms.find(r => r.id === id);
  if (!room) return;
  state.currentRoomId = id;
  state.history = room.history || [];
  roomNameEl.textContent = room.name;
  roomTopicEl.textContent = room.topic || 'Contexto inferido del primer mensaje';
  roomStatusEl.textContent = room.status || 'En espera';
  roomStatusEl.classList.toggle('active', room.status === 'Activa');
  maxRoundsInput.value = room.maxRounds || 3;
  modeSelect.value = room.mode || 'autonomous';
  
  updateAgentSelect(room.agentIds);
  renderMessages();
  renderRoomList();
  renderAgentList(); // Actualizamos el estado ON/OFF al cambiar de sala
}

function updateAgentSelect(agentIds) {
  agentSelect.innerHTML = '<option value="">· Agente ·</option>';
  (agentIds || []).forEach(id => {
    const a = getAgentById(id);
    if (a && a.active) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.avatar} ${a.name}`;
      agentSelect.appendChild(opt);
    }
  });
}

function renderMessages() {
  messagesEl.innerHTML = '';
  if (!state.history.length) {
    messagesEl.innerHTML = `<div class="empty-state"><div class="empty-icon">🛸</div><h3>Sistemas en espera</h3><p>Envía un comunicado para iniciar la deliberación.</p></div>`;
    return;
  }
  state.history.forEach(m => appendMessage(m, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  btnScrollBottom.classList.add('hidden');
}

function isUserAtBottom() {
  const threshold = 150;
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}

// 🚨 BURBUJA DE STREAMING (Letra por letra)
function createStreamingBubble(agentName, avatar) {
  const div = document.createElement('div');
  div.className = `msg agent thinking`;
  div.innerHTML = `
    <div class="msg-avatar">${avatar || '🤖'}</div>
    <div class="msg-body">
      <div class="msg-header">${agentName}</div>
      <div class="msg-text"></div>
    </div>
  `;
  messagesEl.appendChild(div);
  if (isUserAtBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function appendMessage({ agentId, agentName, avatar, text, role = 'assistant' }, scroll = true) {
  const wasAtBottom = isUserAtBottom();
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'agent'}`;
  
  const cleanText = text.replace(/\n{3,}/g, '\n\n');
  const htmlContent = window.marked ? window.marked.parse(cleanText) : cleanText;
  
  div.innerHTML = `
    <div class="msg-avatar">${avatar || (role === 'user' ? '👤' : '🤖')}</div>
    <div class="msg-body">
      <div class="msg-header">${agentName || 'Usuario'}</div>
      <div class="msg-text">${htmlContent}</div>
    </div>
  `;
  messagesEl.appendChild(div);

  if (scroll) {
    if (role === 'user' || wasAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    else btnScrollBottom.classList.remove('hidden');
  }
}

async function persistCurrentRoom() {
  const room = state.rooms.find(r => r.id === state.currentRoomId);
  if (!room) return;
  room.history = state.history;
  room.status = state.isRunning ? 'Activa' : 'En espera';
  room.mode = modeSelect.value;
  room.maxRounds = Number(maxRoundsInput.value);
  try { await saveRoom(room); } catch (e) {}
}

function bindEvents() {
  $('#btn-toggle-sidebar').onclick = () => { sidebarEl.classList.toggle('collapsed'); };
  
  messagesEl.onscroll = () => {
    if (isUserAtBottom()) btnScrollBottom.classList.add('hidden');
    else btnScrollBottom.classList.remove('hidden');
  };
  
  btnScrollBottom.onclick = () => { messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }); };

  $('#btn-new-room').onclick = () => {
    try {
      if (typeof dialogRoom.showModal === 'function') {
        renderAgentCheckboxes();
        dialogRoom.showModal();
      } else { throw new Error('Dialog no soportado'); }
    } catch (e) {
      const name = prompt('Nombre de la sala:');
      if (!name) return;
      createManualRoom(name);
    }
  };

  $('#btn-cancel-room').onclick = () => { if (dialogRoom.close) dialogRoom.close(); };
  
  $('#form-room').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#input-room-name').value.trim();
    const checked = [...document.querySelectorAll('#agent-checkboxes input:checked')].map(c => c.value);
    if (!name || !checked.length) return;
    await createManualRoom(name, checked);
    if (dialogRoom.close) dialogRoom.close();
    $('#form-room').reset();
  };

  $('#btn-edit-room-name').onclick = async () => {
    if (!state.currentRoomId || state.isRunning) return;
    const room = state.rooms.find(r => r.id === state.currentRoomId);
    if (!room) return;
    const newName = prompt('Nuevo nombre para la sala:', room.name);
    if (newName && newName.trim() !== '' && newName !== room.name) {
      room.name = newName.trim();
      await saveRoom(room);
      roomNameEl.textContent = room.name;
      renderRoomList();
    }
  };

  $('#btn-delete-room').onclick = async () => {
    if (!state.currentRoomId || state.isRunning) return;
    if (!confirm('¿Eliminar esta sala y su historial?')) return;
    try { await deleteRoom(state.currentRoomId); } catch(e) {}
    state.currentRoomId = null;
    state.history = [];
    await loadRooms();
    renderMessages();
    roomNameEl.textContent = 'Selecciona o crea una sala';
    roomTopicEl.textContent = '·';
  };

  $('#btn-export').onclick = () => {
    if (!state.currentRoomId) return;
    const blob = new Blob([JSON.stringify({ room: state.rooms.find(r => r.id === state.currentRoomId), history: state.history }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-council-${state.currentRoomId}.json`;
    a.click();
  };

  modeSelect.onchange = () => { agentSelect.disabled = modeSelect.value !== 'directed'; };
  
  btnStop.onclick = () => {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    setRunning(false);
    if (activeStreamingEl) {
      activeStreamingEl.classList.remove('thinking');
      activeStreamingEl = null;
    }
  };

  btnSend.onclick = handleSend;
  userInput.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
}

async function createManualRoom(name, agentIds = null) {
  const newRoom = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name: name, topic: '',
    agentIds: agentIds || getActiveAgents().map(a => a.id),
    mode: 'autonomous', maxRounds: 3, history: [], status: 'En espera',
    createdAt: new Date().toISOString(),
  };
  try { await saveRoom(newRoom); } catch(e) {}
  state.rooms.unshift(newRoom);
  await loadRooms();
  selectRoom(newRoom.id);
}

function renderAgentCheckboxes() {
  const container = $('#agent-checkboxes');
  container.innerHTML = '';
  AGENTS.forEach(a => {
    if (!a.active) return;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${a.id}" checked> ${a.avatar} ${a.name}`;
    container.appendChild(label);
  });
}

function setRunning(running) {
  state.isRunning = running;
  btnSend.disabled = false; 
  btnStop.disabled = !running;
  if (running) {
    roomStatusEl.textContent = 'Activa';
    roomStatusEl.classList.add('active');
  } else {
    roomStatusEl.textContent = 'En espera';
    roomStatusEl.classList.remove('active');
  }
}

async function handleSend() {
  const text = userInput.value.trim();
  if (!text) return;

  if (state.isRunning && state.abortController) {
    state.abortController.abort();
    state.abortController = null;
    setRunning(false);
    if (activeStreamingEl) activeStreamingEl.classList.remove('thinking');
  }

  if (!state.currentRoomId) {
    const autoName = text.length > 30 ? text.substring(0, 30) + '...' : text;
    const newRoom = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
      name: autoName, topic: '', agentIds: getActiveAgents().map(a => a.id),
      mode: 'autonomous', maxRounds: 3, history: [], status: 'En espera',
      createdAt: new Date().toISOString(),
    };
    try { await saveRoom(newRoom); } catch(e) {}
    state.rooms.unshift(newRoom);
    state.currentRoomId = newRoom.id;
    state.history = [];
    roomNameEl.textContent = newRoom.name;
    roomTopicEl.textContent = 'Contexto inferido';
    updateAgentSelect(newRoom.agentIds);
    renderMessages();
    renderRoomList();
    renderAgentList();
  }

  const room = state.rooms.find(r => r.id === state.currentRoomId);
  if (!room) return;

  const userMsg = { role: 'user', agentName: 'Usuario', text };
  state.history.push(userMsg);
  appendMessage({ agentName: 'Usuario', text, role: 'user' });
  userInput.value = '';

  setRunning(true);
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  const onChunk = (chunk, agentName, avatar) => {
    if (!activeStreamingEl || activeStreamingAgent !== agentName) {
      if (activeStreamingEl) activeStreamingEl.classList.remove('thinking');
      activeStreamingEl = createStreamingBubble(agentName, avatar);
      activeStreamingAgent = agentName;
    }
    const textEl = activeStreamingEl.querySelector('.msg-text');
    textEl.textContent += chunk;
    if (isUserAtBottom()) messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const onMessage = (m) => {
    if (activeStreamingEl) {
      const textEl = activeStreamingEl.querySelector('.msg-text');
      textEl.innerHTML = window.marked ? window.marked.parse(m.text) : m.text;
      activeStreamingEl.classList.remove('thinking');
      activeStreamingEl = null;
      activeStreamingAgent = null;
    } else {
      appendMessage(m);
    }
    state.history.push({ role: 'assistant', ...m });
  };

  try {
    if (modeSelect.value === 'directed') {
      const agentId = agentSelect.value;
      if (!agentId) { alert('Selecciona un agente.'); setRunning(false); return; }
      
      await runDirected({
        agentId, userText: text, history: state.history.slice(0, -1),
        onMessage, onChunk,
        selectedAgentIds: room.agentIds // 🚨 Pasamos los agentes presentes en la sala
      });
    } else {
      await runAutonomous({
        history: state.history,
        selectedAgentIds: room.agentIds, // 🚨 Pasamos los agentes presentes en la sala
        maxRounds: Number(maxRoundsInput.value) || 3,
        onMessage, onChunk,
        onStatus: (s) => { roomStatusEl.textContent = s; },
        signal,
      });
    }
    await persistCurrentRoom();
  } catch (err) {
    if (err.name !== 'AbortError' && !err.message.includes('interrumpida')) {
      appendMessage({ agentName: 'Sistema', avatar: '⚠️', text: `Error: ${err.message}` });
    }
  } finally {
    if (!signal.aborted) setRunning(false);
    state.abortController = null;
    if (activeStreamingEl) activeStreamingEl.classList.remove('thinking');
  }
}

init();
