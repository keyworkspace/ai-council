import { AGENTS, getActiveAgents, getAgentById } from './agents.js';
import { runAutonomous, runDirected } from './orchestrator.js';
import { getAllRooms, saveRoom, deleteRoom } from './db.js';
import { checkHealth } from './api.js';

// ── Estado global ──
const state = {
  rooms: [],
  currentRoomId: null,
  history: [],            
  abortController: null,
  isRunning: false,
};

// ── Referencias DOM ──
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

// ── Inicialización ──
async function init() {
  renderAgentList();
  await loadRooms();
  bindEvents();
  const ok = await checkHealth();
  if (!ok) {
    roomStatusEl.textContent = '⚠️ Worker no disponible';
    roomStatusEl.classList.remove('active');
  }
}

// ── Render de agentes ──
function renderAgentList() {
  agentListEl.innerHTML = '';
  AGENTS.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span style="display:flex;align-items:center;gap:0.4rem">
        <span class="agent-dot ${a.active ? '' : 'off'}"></span>
        <span>${a.avatar} ${a.name}</span>
      </span>
      <small style="color:var(--text-dim);font-size:0.65rem">${a.provider}</small>
    `;
    agentListEl.appendChild(li);
  });
}

// ── Salas ──
async function loadRooms() {
  state.rooms = await getAllRooms();
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
  roomTopicEl.textContent = room.topic;
  roomStatusEl.textContent = room.status || 'Inactiva';
  roomStatusEl.classList.toggle('active', room.status === 'Activa');
  maxRoundsInput.value = room.maxRounds || 3;
  modeSelect.value = room.mode || 'autonomous';
  updateAgentSelect(room.agentIds || AGENTS.map(a => a.id));
  renderMessages();
  renderRoomList();
}

function updateAgentSelect(agentIds) {
  agentSelect.innerHTML = '<option value="">— Agente —</option>';
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

// ── Mensajes ──
function renderMessages() {
  messagesEl.innerHTML = '';
  if (!state.history.length) {
    messagesEl.innerHTML = `<div class="empty-state"><p>🏛️ El consejo está en receso.</p><p>Plantea un tema para comenzar.</p></div>`;
    return;
  }
  state.history.forEach(m => appendMessage(m, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage({ agentId, agentName, avatar, text, role = 'assistant' }, scroll = true) {
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'agent'}`;
  
  // Convertimos el texto de Markdown a HTML usando marked
  const htmlContent = window.marked ? window.marked.parse(text) : escapeHtml(text);
  
  div.innerHTML = `
    <div class="msg-avatar">${avatar || (role === 'user' ? '👤' : '🤖')}</div>
    <div class="msg-body">
      <div class="msg-header">${agentName || 'Usuario'}</div>
      <div class="msg-text">${htmlContent}</div>
    </div>
  `;
  messagesEl.appendChild(div);
  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Persistencia ──
async function persistCurrentRoom() {
  const room = state.rooms.find(r => r.id === state.currentRoomId);
  if (!room) return;
  room.history = state.history;
  room.status = state.isRunning ? 'Activa' : 'Inactiva';
  room.mode = modeSelect.value;
  room.maxRounds = Number(maxRoundsInput.value);
  await saveRoom(room);
}

// ── Eventos ──
function bindEvents() {
  $('#btn-new-room').onclick = () => {
    renderAgentCheckboxes();
    dialogRoom.showModal();
  };

  $('#btn-cancel-room').onclick = () => dialogRoom.close();

  $('#form-room').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#input-room-name').value.trim();
    const topic = $('#input-room-topic').value.trim();
    const checked = [...document.querySelectorAll('#agent-checkboxes input:checked')].map(c => c.value);
    if (!name || !topic || !checked.length) return;
    const room = {
      id: crypto.randomUUID(),
      name, topic,
      agentIds: checked,
      mode: 'autonomous',
      maxRounds: 3,
      history: [],
      status: 'Inactiva',
      createdAt: new Date().toISOString(),
    };
    await saveRoom(room);
    state.rooms.push(room);
    dialogRoom.close();
    $('#form-room').reset();
    await loadRooms();
    selectRoom(room.id);
  };

  $('#btn-delete-room').onclick = async () => {
    if (!state.currentRoomId || state.isRunning) return;
    if (!confirm('¿Eliminar esta sala y su historial?')) return;
    await deleteRoom(state.currentRoomId);
    state.currentRoomId = null;
    state.history = [];
    await loadRooms();
    renderMessages();
    roomNameEl.textContent = 'Selecciona o crea una sala';
    roomTopicEl.textContent = '—';
  };

  $('#btn-export').onclick = () => {
    if (!state.currentRoomId) return;
    const blob = new Blob([JSON.stringify({ room: state.rooms.find(r => r.id === state.currentRoomId), history: state.history }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-council-${state.currentRoomId}.json`;
    a.click();
  };

  modeSelect.onchange = () => {
    agentSelect.disabled = modeSelect.value !== 'directed';
  };

  btnStop.onclick = () => {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    setRunning(false);
  };

  btnSend.onclick = handleSend;
  userInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };
}

function renderAgentCheckboxes() {
  const container = $('#agent-checkboxes');
  container.innerHTML = '';
  AGENTS.forEach(a => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${a.id}" ${a.active ? 'checked' : ''}> ${a.avatar} ${a.name}`;
    container.appendChild(label);
  });
}

function setRunning(running) {
  state.isRunning = running;
  btnSend.disabled = running;
  btnStop.disabled = !running;
  roomStatusEl.textContent = running ? 'Activa' : 'Inactiva';
  roomStatusEl.classList.toggle('active', running);
}

async function handleSend() {
  if (state.isRunning) return;
  const text = userInput.value.trim();
  if (!text) return;

  if (!state.currentRoomId) {
    alert('Crea o selecciona una sala primero.');
    return;
  }

  const room = state.rooms.find(r => r.id === state.currentRoomId);
  if (!room) return;

  // Añadir mensaje del usuario al historial
  const userMsg = { role: 'user', agentName: 'Usuario', text };
  state.history.push(userMsg);
  appendMessage({ agentName: 'Usuario', text, role: 'user' });
  userInput.value = '';

  setRunning(true);
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  try {
    if (modeSelect.value === 'directed') {
      const agentId = agentSelect.value;
      if (!agentId) { alert('Selecciona un agente para el modo dirigido.'); setRunning(false); return; }
      
      const responseText = await runDirected({
        agentId, userText: text, history: state.history.slice(0, -1),
        onMessage: (m) => {
          appendMessage(m);
          state.history.push({ role: 'assistant', ...m });
        },
      });
    } else {
      // MODO AUTÓNOMO: Pasamos TODO el historial, no solo el tema
      await runAutonomous({
        history: state.history, // <--- Aquí pasamos el hilo completo
        selectedAgentIds: room.agentIds,
        maxRounds: Number(maxRoundsInput.value) || 3,
        onMessage: (m) => {
          appendMessage(m);
          state.history.push({ role: 'assistant', ...m });
        },
        onStatus: (s) => { roomStatusEl.textContent = s; },
        signal,
      });
    }
    await persistCurrentRoom();
  } catch (err) {
    appendMessage({ agentName: 'Sistema', avatar: '⚠️', text: `Error: ${err.message}` });
  } finally {
    setRunning(false);
    state.abortController = null;
  }
}

init();