/* PulseChat client — vanilla JS, no build step. */

const state = {
  me: null,
  socket: null,
  conversations: [],
  activeConvoId: null,
  users: [],
  typingTimeout: null,
  recorder: null,
  recordedChunks: [],
  recordKind: null, // 'audio' | 'video'
  cameraStream: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ---------------- Auth screen ----------------

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isLogin = tab.dataset.tab === "login";
    $("#loginForm").hidden = !isLogin;
    $("#registerForm").hidden = isLogin;
  });
});

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  $("#loginError").textContent = "";
  try {
    const { user } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value }),
    });
    onLoggedIn(user);
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  $("#registerError").textContent = "";
  try {
    const { user } = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value }),
    });
    onLoggedIn(user);
  } catch (err) {
    $("#registerError").textContent = err.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  if (state.socket) state.socket.disconnect();
  location.reload();
});

// ---------------- Bootstrapping ----------------

async function boot() {
  try {
    const { user } = await api("/api/me");
    if (user) onLoggedIn(user);
  } catch (_) {
    /* not logged in — stay on auth screen */
  }
}

function onLoggedIn(user) {
  state.me = user;
  $("#authScreen").hidden = true;
  $("#appScreen").hidden = false;
  $("#myUsername").textContent = user.username;
  if (user.avatar_url) $("#myAvatar").src = user.avatar_url;

  connectSocket();
  loadConversations();
  loadUsers();
}

function connectSocket() {
  state.socket = io();

  state.socket.on("new_message", (msg) => {
    if (msg.conversation_id === state.activeConvoId) {
      appendMessage(msg);
      scrollMessagesToBottom();
    }
    loadConversations(); // refresh previews/order
  });

  state.socket.on("typing", ({ conversationId, userId, isTyping }) => {
    if (conversationId !== state.activeConvoId || userId === state.me.id) return;
    $("#chatTyping").textContent = isTyping ? "typing…" : "";
  });

  state.socket.on("presence", () => loadConversations());
}

// ---------------- Conversations ----------------

async function loadConversations() {
  const { conversations } = await api("/api/conversations");
  state.conversations = conversations;
  renderConversationList();
}

function renderConversationList() {
  const list = $("#conversationList");
  list.innerHTML = "";
  state.conversations.forEach((c) => {
    const div = document.createElement("div");
    div.className = "convo-item" + (c.id === state.activeConvoId ? " active" : "");
    const previewText = previewFor(c.last_message);
    div.innerHTML = `
      <img class="avatar-sm" src="${c.avatar_url || "/img/default-avatar.svg"}" alt="" />
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="preview">${previewText}</div>
      </div>`;
    div.addEventListener("click", () => openConversation(c.id));
    list.appendChild(div);
  });
}

function previewFor(msg) {
  if (!msg) return "No messages yet";
  const who = msg.sender_id === state.me.id ? "You: " : "";
  if (msg.kind === "text") return escapeHtml(who + msg.body);
  if (msg.kind === "image") return who + "📷 Photo";
  if (msg.kind === "audio") return who + "🎙️ Voice note";
  if (msg.kind === "video") return who + "🎥 Video clip";
  return who + "Attachment";
}

async function openConversation(id) {
  state.activeConvoId = id;
  $("#emptyState").hidden = true;
  $("#chatArea").hidden = false;
  $("#chatTyping").textContent = "";
  renderConversationList();

  const convo = state.conversations.find((c) => c.id === id);
  $("#chatTitle").textContent = convo ? convo.name : "";
  $("#chatAvatar").src = (convo && convo.avatar_url) || "/img/default-avatar.svg";

  state.socket.emit("join_conversation", id);

  const { messages } = await api(`/api/conversations/${id}/messages`);
  const box = $("#messages");
  box.innerHTML = "";
  messages.forEach(appendMessage);
  scrollMessagesToBottom();
}

function appendMessage(msg) {
  const box = $("#messages");
  const mine = msg.sender_id === state.me.id;
  const div = document.createElement("div");
  div.className = "msg" + (mine ? " mine" : "");

  let body = "";
  if (msg.kind === "text") {
    body = `<div>${escapeHtml(msg.body)}</div>`;
  } else if (msg.kind === "image") {
    body = `<img class="attachment" src="${msg.file_path}" alt="${escapeHtml(msg.file_name || "image")}" />`;
  } else if (msg.kind === "audio") {
    body = `<audio class="attachment" controls src="${msg.file_path}"></audio>`;
  } else if (msg.kind === "video") {
    body = `<video class="attachment" controls src="${msg.file_path}"></video>`;
  }

  div.innerHTML = `
    <div class="sender">${mine ? "You" : escapeHtml(msg.sender_name)}</div>
    ${body}
    <div class="time">${formatTime(msg.created_at)}</div>`;
  box.appendChild(div);
}

function scrollMessagesToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function formatTime(iso) {
  const d = new Date(iso + "Z"); // SQLite datetime('now') is UTC
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------- Composer: text ----------------

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#textInput");
  const body = input.value.trim();
  if (!body || !state.activeConvoId) return;
  sendMessage({ kind: "text", body });
  input.value = "";
  state.socket.emit("typing", { conversationId: state.activeConvoId, isTyping: false });
});

$("#textInput").addEventListener("input", () => {
  if (!state.activeConvoId) return;
  state.socket.emit("typing", { conversationId: state.activeConvoId, isTyping: true });
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.socket.emit("typing", { conversationId: state.activeConvoId, isTyping: false });
  }, 1200);
});

function sendMessage(extra) {
  state.socket.emit(
    "send_message",
    { conversationId: state.activeConvoId, ...extra },
    (res) => {
      if (res && res.error) alert(res.error);
    }
  );
}

// ---------------- Composer: image ----------------

$("#imageInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !state.activeConvoId) return;
  const uploaded = await uploadFile(file);
  sendMessage({ kind: "image", ...uploaded });
});

async function uploadFile(fileOrBlob, filename) {
  const fd = new FormData();
  fd.append("file", fileOrBlob, filename || fileOrBlob.name || "upload");
  const res = await fetch("/api/upload", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

// ---------------- Composer: audio / video recording ----------------

$("#audioBtn").addEventListener("click", () => startRecording("audio"));
$("#videoBtn").addEventListener("click", () => startRecording("video"));
$("#cancelRecordBtn").addEventListener("click", stopRecording.bind(null, false));
$("#stopRecordBtn").addEventListener("click", stopRecording.bind(null, true));

async function startRecording(kind) {
  if (!state.activeConvoId) return alert("Open a conversation first.");
  try {
    const constraints = kind === "audio" ? { audio: true } : { audio: true, video: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.cameraStream = stream;
    state.recordKind = kind;
    state.recordedChunks = [];

    if (kind === "video") {
      const preview = $("#videoPreview");
      preview.srcObject = stream;
      preview.hidden = false;
    }

    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    };
    recorder.start();
    state.recorder = recorder;

    $("#recordLabel").textContent = kind === "audio" ? "Recording voice note…" : "Recording video…";
    $("#recordBar").hidden = false;
    $("#composer").hidden = true;
  } catch (err) {
    alert("Could not access " + (kind === "audio" ? "microphone" : "camera/microphone") + ": " + err.message);
  }
}

async function stopRecording(shouldSend) {
  const recorder = state.recorder;
  const kind = state.recordKind;
  if (!recorder) return resetRecordUI();

  recorder.stop();
  await new Promise((resolve) => (recorder.onstop = resolve));

  if (state.cameraStream) state.cameraStream.getTracks().forEach((t) => t.stop());

  if (shouldSend && state.recordedChunks.length) {
    const mime = state.recordedChunks[0].type || (kind === "audio" ? "audio/webm" : "video/webm");
    const blob = new Blob(state.recordedChunks, { type: mime });
    const ext = kind === "audio" ? "webm" : "webm";
    try {
      const uploaded = await uploadFile(blob, `${kind}-${Date.now()}.${ext}`);
      sendMessage({ kind, ...uploaded });
    } catch (err) {
      alert("Could not send recording: " + err.message);
    }
  }
  resetRecordUI();
}

function resetRecordUI() {
  state.recorder = null;
  state.recordedChunks = [];
  state.recordKind = null;
  state.cameraStream = null;
  $("#videoPreview").hidden = true;
  $("#videoPreview").srcObject = null;
  $("#recordBar").hidden = true;
  $("#composer").hidden = false;
}

// ---------------- Avatar ----------------

$("#myAvatar").parentElement.addEventListener("click", () => $("#avatarInput").click());
$("#avatarInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const fd = new FormData();
  fd.append("avatar", file);
  const res = await fetch("/api/avatar", { method: "POST", body: fd, credentials: "same-origin" });
  const data = await res.json();
  if (res.ok) $("#myAvatar").src = data.avatar_url;
});

// ---------------- New chat dialog ----------------

async function loadUsers() {
  const { users } = await api("/api/users");
  state.users = users;
}

$("#newChatBtn").addEventListener("click", async () => {
  await loadUsers();
  const picker = $("#userPicker");
  picker.innerHTML = state.users
    .map(
      (u) => `<label><input type="checkbox" value="${u.id}" /> ${escapeHtml(u.username)}
        <span style="color:var(--muted); font-size:0.75rem;">(${u.status})</span></label>`
    )
    .join("") || `<p style="color:var(--muted)">No other users yet — invite a friend to sign up.</p>`;
  $("#newChatDialog").showModal();
});

$("#cancelNewChat").addEventListener("click", () => $("#newChatDialog").close());

$("#isGroupCheck").addEventListener("change", (e) => {
  $("#groupNameInput").hidden = !e.target.checked;
});

$("#newChatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const isGroup = $("#isGroupCheck").checked;
  const memberIds = [...$$("#userPicker input:checked")].map((i) => Number(i.value));
  if (!memberIds.length) return alert("Pick at least one person.");
  try {
    const { id } = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ memberIds, isGroup, name: $("#groupNameInput").value.trim() }),
    });
    $("#newChatDialog").close();
    $("#isGroupCheck").checked = false;
    $("#groupNameInput").hidden = true;
    $("#groupNameInput").value = "";
    await loadConversations();
    openConversation(id);
  } catch (err) {
    alert(err.message);
  }
});

boot();
