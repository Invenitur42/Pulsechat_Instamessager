const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { v4: uuid } = require("uuid");
const { Server } = require("socket.io");

const db = require("./db/init");

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
  secret: "pulsechat-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
});
app.use(sessionMiddleware);

// Share express-session with socket.io so sockets know who is connected.
io.engine.use(sessionMiddleware);

// ---------- helpers ----------

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  next();
}

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, username: row.username, avatar_url: row.avatar_url, status: row.status };
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
// Password rule per spec: alphanumeric, 10-20 characters.
const PASSWORD_RE = /^[a-zA-Z0-9]{10,20}$/;

// ---------- uploads ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${uuid()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

function kindFromMime(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "text";
}

app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const kind = kindFromMime(req.file.mimetype);
  res.json({
    kind,
    file_path: `/uploads/${req.file.filename}`,
    file_name: req.file.originalname,
    mime_type: req.file.mimetype,
  });
});

app.post("/api/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file received" });
  const url = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(url, req.session.userId);
  res.json({ avatar_url: url });
});

// ---------- auth ----------

app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!USERNAME_RE.test(username || "")) {
    return res.status(400).json({ error: "Username must be 3-20 letters, numbers or underscores." });
  }
  if (!PASSWORD_RE.test(password || "")) {
    return res.status(400).json({ error: "Password must be 10-20 alphanumeric characters." });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "That username is taken." });

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash, status) VALUES (?, ?, 'online')")
    .run(username, hash);
  req.session.userId = info.lastInsertRowid;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  res.json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  req.session.userId = user.id;
  db.prepare("UPDATE users SET status = 'online' WHERE id = ?").run(user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  if (req.session.userId) {
    db.prepare("UPDATE users SET status = 'offline' WHERE id = ?").run(req.session.userId);
  }
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
  res.json({ user: publicUser(user) });
});

app.get("/api/users", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM users WHERE id != ? ORDER BY username COLLATE NOCASE")
    .all(req.session.userId);
  res.json({ users: rows.map(publicUser) });
});

// ---------- conversations ----------

app.get("/api/conversations", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const convos = db
    .prepare(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m ON m.conversation_id = c.id
       WHERE m.user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(uid);

  const result = convos.map((c) => {
    const members = db
      .prepare(
        `SELECT u.id, u.username, u.avatar_url, u.status FROM conversation_members m
         JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?`
      )
      .all(c.id);
    const lastMsg = db
      .prepare(
        `SELECT m.*, u.username as sender_name FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 1`
      )
      .get(c.id);
    const other = members.find((m) => m.id !== uid);
    return {
      id: c.id,
      is_group: !!c.is_group,
      name: c.is_group ? c.name : other ? other.username : "Unknown",
      avatar_url: c.is_group ? null : other ? other.avatar_url : null,
      members,
      last_message: lastMsg || null,
    };
  });
  res.json({ conversations: result });
});

app.post("/api/conversations", requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { memberIds, isGroup, name } = req.body || {};
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return res.status(400).json({ error: "Pick at least one other user." });
  }

  if (!isGroup && memberIds.length === 1) {
    // Reuse an existing DM if one already exists between these two users.
    const existing = db
      .prepare(
        `SELECT c.id FROM conversations c
         JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
         JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
         WHERE c.is_group = 0`
      )
      .get(uid, memberIds[0]);
    if (existing) return res.json({ id: existing.id });
  }

  const info = db
    .prepare("INSERT INTO conversations (is_group, name, created_by) VALUES (?, ?, ?)")
    .run(isGroup ? 1 : 0, isGroup ? name || "New group" : null, uid);
  const convoId = info.lastInsertRowid;

  const insertMember = db.prepare(
    "INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)"
  );
  insertMember.run(convoId, uid);
  for (const id of memberIds) {
    if (id !== uid) insertMember.run(convoId, id);
  }
  res.json({ id: convoId });
});

app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
  const convoId = Number(req.params.id);
  const isMember = db
    .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
    .get(convoId, req.session.userId);
  if (!isMember) return res.status(403).json({ error: "Not a member of this conversation." });

  const messages = db
    .prepare(
      `SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.conversation_id = ? ORDER BY m.created_at ASC`
    )
    .all(convoId);
  res.json({ messages });
});

// ---------- socket.io realtime ----------

const onlineSockets = new Map(); // userId -> Set(socketId)

io.on("connection", (socket) => {
  const session = socket.request.session;
  const userId = session && session.userId;
  if (!userId) {
    socket.emit("auth_error", "No session found. Please log in again.");
    socket.disconnect(true);
    return;
  }

  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socket.id);
  db.prepare("UPDATE users SET status = 'online' WHERE id = ?").run(userId);
  io.emit("presence", { userId, status: "online" });

  socket.on("join_conversation", (conversationId) => {
    const isMember = db
      .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
      .get(conversationId, userId);
    if (isMember) socket.join(`convo:${conversationId}`);
  });

  socket.on("typing", ({ conversationId, isTyping }) => {
    socket.to(`convo:${conversationId}`).emit("typing", { conversationId, userId, isTyping });
  });

  socket.on("send_message", (payload, ack) => {
    try {
      const { conversationId, kind, body, file_path, file_name, mime_type, duration_sec } = payload;
      const isMember = db
        .prepare("SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?")
        .get(conversationId, userId);
      if (!isMember) return ack && ack({ error: "Not a member of this conversation." });

      const info = db
        .prepare(
          `INSERT INTO messages (conversation_id, sender_id, kind, body, file_path, file_name, mime_type, duration_sec)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversationId,
          userId,
          kind || "text",
          body || null,
          file_path || null,
          file_name || null,
          mime_type || null,
          duration_sec || null
        );

      const full = db
        .prepare(
          `SELECT m.*, u.username as sender_name, u.avatar_url as sender_avatar
           FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
        )
        .get(info.lastInsertRowid);

      io.to(`convo:${conversationId}`).emit("new_message", full);
      ack && ack({ message: full });
    } catch (err) {
      console.error(err);
      ack && ack({ error: "Could not send message." });
    }
  });

  socket.on("disconnect", () => {
    const set = onlineSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        onlineSockets.delete(userId);
        db.prepare("UPDATE users SET status = 'offline' WHERE id = ?").run(userId);
        io.emit("presence", { userId, status: "offline" });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`PulseChat running at http://localhost:${PORT}`);
});
