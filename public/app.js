// ConvoScale Frontend Application Logic

let authToken = localStorage.getItem('convoscale_token') || null;
let currentUser = null;
let currentConvoId = null;
let conversations = [];
let lastUsedIdempotencyKey = null;

// DOM Elements
const authModal = document.getElementById('authModal');
const statsModal = document.getElementById('statsModal');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const convoList = document.getElementById('convoList');
const newConvoBtn = document.getElementById('newConvoBtn');
const currentConvoTitle = document.getElementById('currentConvoTitle');
const currentConvoMeta = document.getElementById('currentConvoMeta');
const messagesContainer = document.getElementById('messagesContainer');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusBanner = document.getElementById('statusBanner');
const lastLatencyTag = document.getElementById('lastLatencyTag');
const rateLimitTag = document.getElementById('rateLimitTag');
const testIdempotencyToggle = document.getElementById('testIdempotencyToggle');
const simulateFailureToggle = document.getElementById('simulateFailureToggle');

// Modals
document.getElementById('authModalBtn').onclick = () => authModal.classList.add('active');
document.getElementById('closeModalBtn').onclick = () => authModal.classList.remove('active');
document.getElementById('toggleStatsBtn').onclick = () => openStatsModal();
document.getElementById('closeStatsBtn').onclick = () => statsModal.classList.remove('active');

// Quick Demo Login
document.getElementById('quickAliceBtn').onclick = () => handleLogin('alice@convoscale.io', 'Password123!');
document.getElementById('quickBobBtn').onclick = () => handleLogin('bob@convoscale.io', 'Password123!');

let isRegisterMode = false;
document.getElementById('authToggleModeBtn').onclick = () => {
  isRegisterMode = !isRegisterMode;
  document.getElementById('nameGroup').style.display = isRegisterMode ? 'block' : 'none';
  document.getElementById('authSubmitBtn').innerText = isRegisterMode ? 'Register' : 'Login';
  document.getElementById('authToggleModeBtn').innerText = isRegisterMode ? 'Already have an account? Login' : 'Need an account? Register';
};

document.getElementById('authSubmitBtn').onclick = async () => {
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value;

  if (isRegisterMode) {
    await handleRegister(email, password, name);
  } else {
    await handleLogin(email, password);
  }
};

async function apiRequest(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const start = performance.now();
  try {
    const res = await fetch(endpoint, { ...options, headers });
    const duration = Math.round(performance.now() - start);

    // Update Header Tags
    lastLatencyTag.innerText = `Latency: ${duration}ms`;
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining !== null) {
      rateLimitTag.innerText = `Rate Limit: ${remaining} left`;
    }

    const isReplay = res.headers.get('X-Idempotent-Replay');
    if (isReplay === 'true') {
      showBanner(`⚡ Idempotent Replay: Request was deduplicated by backend cache!`, 'success');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Request failed');
    }

    return data;
  } catch (err) {
    showBanner(`Error: ${err.message}`, 'error');
    throw err;
  }
}

async function handleLogin(email, password) {
  try {
    const res = await apiRequest('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    authToken = res.data.token;
    currentUser = res.data.user;
    localStorage.setItem('convoscale_token', authToken);
    authModal.classList.remove('active');
    updateUserUi();
    await loadConversations();
    showBanner(`Authenticated as ${currentUser.name}`, 'success');
  } catch (err) {
    // handled in apiRequest
  }
}

async function handleRegister(email, password, name) {
  try {
    const res = await apiRequest('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });

    authToken = res.data.token;
    currentUser = res.data.user;
    localStorage.setItem('convoscale_token', authToken);
    authModal.classList.remove('active');
    updateUserUi();
    await loadConversations();
    showBanner(`Account created! Welcome, ${currentUser.name}`, 'success');
  } catch (err) {
    // handled in apiRequest
  }
}

function updateUserUi() {
  if (currentUser) {
    userName.innerText = currentUser.name;
    userEmail.innerText = currentUser.email;
    userAvatar.innerText = currentUser.name.charAt(0).toUpperCase();
    newConvoBtn.disabled = false;
    messageInput.disabled = false;
    sendBtn.disabled = false;
  }
}

async function loadConversations() {
  try {
    const res = await apiRequest('/api/v1/conversations');
    conversations = res.data || [];
    renderConversations();

    if (conversations.length > 0 && !currentConvoId) {
      selectConversation(conversations[0].id);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderConversations() {
  convoList.innerHTML = '';
  if (conversations.length === 0) {
    convoList.innerHTML = '<div class="empty-state">No conversations yet. Create one!</div>';
    return;
  }

  conversations.forEach((convo) => {
    const div = document.createElement('div');
    div.className = `convo-item ${convo.id === currentConvoId ? 'active' : ''}`;
    div.innerHTML = `
      <span class="convo-item-title">${escapeHtml(convo.title)}</span>
      <span class="convo-item-meta">${convo.message_count} messages • v${convo.version}</span>
    `;
    div.onclick = () => selectConversation(convo.id);
    convoList.appendChild(div);
  });
}

newConvoBtn.onclick = async () => {
  const title = prompt('Enter conversation title:', 'General Scalability Chat');
  if (!title) return;

  try {
    const res = await apiRequest('/api/v1/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });

    await loadConversations();
    selectConversation(res.data.id);
  } catch (err) {
    console.error(err);
  }
};

async function selectConversation(id) {
  currentConvoId = id;
  const convo = conversations.find((c) => c.id === id);
  if (convo) {
    currentConvoTitle.innerText = convo.title;
    currentConvoMeta.innerText = `ID: ${convo.id.slice(0, 8)}... | Messages: ${convo.message_count} | Version: ${convo.version}`;
  }

  renderConversations();
  await loadMessages(id);
}

async function loadMessages(convoId) {
  try {
    const res = await apiRequest(`/api/v1/conversations/${convoId}/messages?limit=50`);
    messagesContainer.innerHTML = '';
    const messages = res.data || [];

    if (messages.length === 0) {
      messagesContainer.innerHTML = '<div class="welcome-box"><p>No messages yet. Send a message below!</p></div>';
      return;
    }

    messages.forEach((msg) => renderMessage(msg));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  } catch (err) {
    console.error(err);
  }
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.sender_type}`;
  const time = new Date(msg.created_at).toLocaleTimeString();

  div.innerHTML = `
    <div class="message-bubble">${escapeHtml(msg.content)}</div>
    <div class="message-meta">
      <span>#${msg.sequence_number || 0}</span>
      <span>${time}</span>
      ${msg.idempotency_key ? `<span title="Idempotency Key">🔑</span>` : ''}
    </div>
  `;

  messagesContainer.appendChild(div);
}

messageForm.onsubmit = async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !currentConvoId) return;

  let idempotencyKey;
  if (testIdempotencyToggle.checked && lastUsedIdempotencyKey) {
    // Replay previous key
    idempotencyKey = lastUsedIdempotencyKey;
    showBanner(`Sending request with duplicate Idempotency Key: ${idempotencyKey.slice(0, 8)}...`, 'success');
  } else {
    idempotencyKey = 'req_' + Math.random().toString(36).substring(2) + Date.now();
    lastUsedIdempotencyKey = idempotencyKey;
  }

  const simulateFailure = simulateFailureToggle.checked;
  const queryParam = simulateFailure ? '?simulateFailure=true' : '';

  messageInput.value = '';

  try {
    const res = await apiRequest(`/api/v1/conversations/${currentConvoId}/messages${queryParam}`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ content: text }),
    });

    if (res.data && res.data.userMessage) {
      renderMessage(res.data.userMessage);
      renderMessage(res.data.botMessage);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Refresh conversation meta
    await loadConversations();
  } catch (err) {
    if (simulateFailure) {
      showBanner(`Simulated failure triggered! Database transaction successfully ROLLED BACK. Zero records written.`, 'error');
    }
  }
};

async function openStatsModal() {
  statsModal.classList.add('active');
  try {
    const res = await apiRequest('/api/v1/system/stats');
    document.getElementById('statMsgs').innerText = res.counts.messages;
    document.getElementById('statConvos').innerText = res.counts.conversations;
    document.getElementById('statDb').innerText = res.database.status;
    document.getElementById('statRedis').innerText = res.redis.status;
    document.getElementById('statPool').innerText = `${res.database.poolSize || 30} max`;
    document.getElementById('statUptime').innerText = `${Math.floor(res.process.uptime)}s`;
    document.getElementById('rawStatsJson').innerText = JSON.stringify(res, null, 2);
  } catch (err) {
    document.getElementById('rawStatsJson').innerText = 'Failed to load stats: ' + err.message;
  }
}

function showBanner(msg, type = 'success') {
  statusBanner.className = `status-banner ${type}`;
  statusBanner.innerText = msg;
  statusBanner.classList.remove('hidden');
  setTimeout(() => {
    statusBanner.classList.add('hidden');
  }, 4500);
}

function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[m]);
}

// Auto-check existing session or auto-login demo
window.addEventListener('DOMContentLoaded', async () => {
  if (authToken) {
    try {
      const res = await apiRequest('/api/v1/auth/me');
      currentUser = res.data;
      updateUserUi();
      await loadConversations();
    } catch (err) {
      localStorage.removeItem('convoscale_token');
      authToken = null;
    }
  }
  if (!currentUser) {
    // Automatically login as Demo Alice for quick testability
    await handleLogin('alice@convoscale.io', 'Password123!');
  }
});
