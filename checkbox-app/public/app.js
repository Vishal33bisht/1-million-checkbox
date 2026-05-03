const state = {
  token: localStorage.getItem('checkbox_access_token'),
  user: JSON.parse(localStorage.getItem('checkbox_user') || 'null'),
  socket: null,
  socketId: null,
  checkboxCount: 0,
  writable: false,
  reconnectTimer: null,
};

const container = document.getElementById('container');
const statusText = document.getElementById('statusText');
const userText = document.getElementById('userText');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const logoutButton = document.getElementById('logoutButton');
const counterText = document.getElementById('counterText');

function setStatus(text) {
  statusText.textContent = text;
}

function setUser(user) {
  state.user = user;
  if (user) {
    userText.textContent = `Logged in as ${user.name}`;
    logoutButton.hidden = false;
  } else {
    userText.textContent = 'Anonymous read-only mode';
    logoutButton.hidden = true;
  }
}

function renderGrid(count) {
  container.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < count; index += 1) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.index = String(index);
    checkbox.disabled = !state.writable;
    checkbox.setAttribute('aria-label', `Checkbox ${index + 1}`);

    checkbox.addEventListener('change', () => {
      if (!state.writable || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
        checkbox.checked = !checkbox.checked;
        return;
      }

      state.socket.send(JSON.stringify({
        type: 'toggle',
        index,
        checked: checkbox.checked,
      }));
    });

    fragment.append(checkbox);
  }

  container.append(fragment);
}

function applyInitialState({ count, checkedIndexes }) {
  if (state.checkboxCount !== count || container.children.length !== count) {
    state.checkboxCount = count;
    renderGrid(count);
  }

  const checked = new Set(checkedIndexes);
  container.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = checked.has(Number(checkbox.dataset.index));
    checkbox.disabled = !state.writable;
  });

  counterText.textContent = `${checked.size} checked / ${count} total`;
}

function updateCheckedCounter() {
  const checkedCount = container.querySelectorAll('input[type="checkbox"]:checked').length;
  counterText.textContent = `${checkedCount} checked / ${state.checkboxCount} total`;
}

function applyCheckboxUpdate(update) {
  const checkbox = container.querySelector(`input[data-index="${update.index}"]`);
  if (checkbox) checkbox.checked = update.checked;
  updateCheckedCounter();
}

function connectSocket() {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenQuery = state.token ? `?token=${encodeURIComponent(state.token)}` : '';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws${tokenQuery}`);
  state.socket = socket;

  socket.addEventListener('open', () => setStatus('Connected'));
  socket.addEventListener('close', () => {
    setStatus('Disconnected, retrying...');
    state.reconnectTimer = setTimeout(connectSocket, 1500);
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'connected') {
      state.socketId = message.socketId;
      state.writable = message.mode === 'interactive';
      setUser(message.user);
      setStatus(`${message.mode} socket ${message.socketId.slice(0, 8)}`);
      container.querySelectorAll('input').forEach((checkbox) => {
        checkbox.disabled = !state.writable;
      });
    }

    if (message.type === 'initial-state') applyInitialState(message);
    if (message.type === 'checkbox-update') applyCheckboxUpdate(message);
    if (message.type === 'presence') {
      const label = message.count === 1 ? 'user' : 'users';
      document.getElementById('presenceText').textContent = `${message.count} connected ${label}`;
    }
    if (message.type === 'rate-limited') setStatus(`Slow down. Try again in ${message.retryAfterSeconds}s`);
    if (message.type === 'error') setStatus(message.message || message.error);
  });
}

async function login(username) {
  const response = await fetch('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || error.error || 'Login failed');
  }

  const tokens = await response.json();
  state.token = tokens.access_token;
  localStorage.setItem('checkbox_access_token', state.token);

  const userinfo = await fetch('/oauth/userinfo', {
    headers: { Authorization: `Bearer ${state.token}` },
  }).then((res) => res.json());

  localStorage.setItem('checkbox_user', JSON.stringify({ id: userinfo.sub, name: userinfo.name }));
  setUser({ id: userinfo.sub, name: userinfo.name });
  connectSocket();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) return;

  try {
    setStatus('Signing in...');
    await login(username);
    usernameInput.value = '';
  } catch (error) {
    setStatus(error.message);
  }
});

logoutButton.addEventListener('click', async () => {
  if (state.token) {
    await fetch('/oauth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
    }).catch(() => {});
  }

  state.token = null;
  state.writable = false;
  localStorage.removeItem('checkbox_access_token');
  localStorage.removeItem('checkbox_user');
  setUser(null);
  connectSocket();
});

setUser(state.user);
fetch('/api/config')
  .then((response) => response.json())
  .then((config) => {
    state.checkboxCount = config.checkboxCount;
    renderGrid(config.checkboxCount);
    connectSocket();
  })
  .catch(() => setStatus('Could not load app config'));

