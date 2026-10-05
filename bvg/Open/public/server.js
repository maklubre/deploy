const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PUBLIC_DIR = __dirname;
console.log("✅ Public dir:", PUBLIC_DIR);

function findSettings() {
  const candidates = [
    path.join(__dirname, "..", "settings.js"),
    path.join(__dirname, "settings.js"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return require(p);
  throw new Error("settings.js tidak ditemukan!");
}
const settings = findSettings();

function findConnectsDir() {
  const candidates = [
    path.join(__dirname, "..", "connects"),
    path.join(__dirname, "connects"),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return candidates[0];
}
const CONNECTS_DIR = findConnectsDir();
const FileNumber = path.join(CONNECTS_DIR, "wa_numbers.json");
const FilePaired = path.join(CONNECTS_DIR, "paired_users.json");

const accounts = require(path.join(__dirname, "..", "lib", "accounts.js"));

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach(c => {
    const [k, ...v] = c.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  });
  return out;
}
function setCookie(res, name, value, maxAgeSec = 604800) {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
}
function clearCookie(res, name) {
  res.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readJSON(file, def = []) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : def; }
  catch { return def; }
}
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function getNumbers() {
  const raw = readJSON(FileNumber);
  return raw.map(x => typeof x === "string"
    ? { number: x, owner: "legacy" }
    : { number: x.number, owner: x.owner || "legacy" });
}
function saveNumbers(list) { writeJSON(FileNumber, list); }

const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;
let sessions = new Map();

function createSession(user, role) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { user, role, exp: Date.now() + SESSION_TTL });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) { sessions.delete(token); return null; }
  return s;
}
function destroySession(token) { if (token) sessions.delete(token); }
console.log("🔑 Sessions: auto chek database");

function auth(req, res, next) {
  const cookies = parseCookies(req);
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const token = bearer || cookies.nted_token || req.headers["x-auth-token"] || req.query.token;
  const s = getSession(token);
  if (!s) return res.status(401).json({ ok: false, msg: "Unauthorized" });
  req.user = s.user;
  req.role = s.role;
  req.token = token;
  next();
}
function ownerOnly(req, res, next) {
  if (req.role !== "owner")
    return res.status(403).json({ ok: false, msg: "Hanya owner!" });
  next();
}

app.use(express.static(PUBLIC_DIR));

app.get("/", (req, res) => res.redirect("/login"));
["login", "dashboard", "bvg", "sender", "users"].forEach(p => {
  app.get("/" + p, (req, res) => {
    const file = path.join(PUBLIC_DIR, p + ".html");
    if (!fs.existsSync(file)) return res.status(404).send("Page not found: " + p);
    res.sendFile(file);
  });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ ok: false, msg: "Isi username & password" });

  const user = accounts.verify(username, password);
  if (!user)
    return res.status(401).json({ ok: false, msg: "Username atau password salah!" });

  const token = createSession(user.username, user.role);
  setCookie(res, "nted_token", token, 604800);
  res.json({ ok: true, token, user: user.username, role: user.role });
});

app.post("/api/logout", (req, res) => {
  const cookies = parseCookies(req);
  const bearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const token = bearer || cookies.nted_token || req.headers["x-auth-token"];
  destroySession(token);
  clearCookie(res, "nted_token");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) =>
  res.json({ ok: true, user: req.user, role: req.role })
);

app.get("/api/status", auth, (req, res) => {
  const bot = global.__NTED__ || {};
  const nums = getNumbers();
  const paired = readJSON(FilePaired);
  res.json({
    whatsappStatus: bot.whatsappStatus || false,
    uptime: process.uptime(),
    memory: process.memoryUsage().rss,
    node: process.version,
    platform: process.platform,
    role: req.role,
    user: req.user,
    totalNumbers: nums.length,
    myNumbers: nums.filter(n => n.owner === req.user).length,
    totalPaired: paired.length
  });
});

/* ---------- NUMBERS ---------- */
app.get("/api/numbers", auth, (req, res) => {
  const nums = getNumbers();
  if (req.role === "owner") return res.json(nums);
  // Member: hanya nomor miliknya
  res.json(nums.filter(n => n.owner === req.user));
});

/* ---------- PAIRWA (Tambah Nomor) ---------- */
app.post("/api/pairwa", auth, async (req, res) => {
  const { number } = req.body || {};
  if (!number || !/^\+?\d{7,15}$/.test(String(number).replace(/\D/g, "")))
    return res.status(400).json({ ok: false, msg: "Nomor tidak valid" });

  const clean = String(number).replace(/\D/g, "");
  const nums = getNumbers();
  const existing = nums.find(n => n.number === clean);

  if (existing) {
    // Owner bisa pindahkan owner nomor ke dirinya, member hanya ke dirinya
    if (existing.owner !== req.user) {
      if (req.role !== "owner") {
        return res.status(403).json({ ok: false, msg: "Nomor sudah dipakai user lain" });
      }
      existing.owner = req.user;
      saveNumbers(nums);
    }
  } else {
    nums.push({ number: clean, owner: req.user });
    saveNumbers(nums);
  }

  // ===== REQUEST PAIRING CODE =====
  const bot = global.__NTED__ || {};
  if (typeof bot.requestPairing === "function") {
    try {
      const result = await bot.requestPairing(clean, req.user);
      return res.json({
        ok: true,
        number: clean,
        owner: req.user,
        connected: result.connected || false,
        code: result.code || null,
        msg: result.msg
      });
    } catch (e) {
      return res.json({
        ok: true,
        number: clean,
        owner: req.user,
        code: null,
        msg: `Nomor tersimpan, tapi gagal request pairing: ${e.message}`
      });
    }
  }

  res.json({ ok: true, number: clean, owner: req.user, msg: `Nomor ${clean} ditambahkan` });
});

/* ---------- DELETE ---------- */
app.delete("/api/numbers/:number", auth, (req, res) => {
  const num = req.params.number;
  const list = getNumbers();
  const idx = list.findIndex(n => n.number === num);

  if (idx === -1) return res.status(404).json({ ok: false, msg: "Nomor tidak ditemukan" });
  if (req.role !== "owner" && list[idx].owner !== req.user)
    return res.status(403).json({ ok: false, msg: "Kamu hanya bisa hapus nomor sendiri" });

  list.splice(idx, 1);
  saveNumbers(list);
  res.json({ ok: true, msg: `Nomor ${num} dihapus` });
});

/* ---------- PAIRED (owner only) ---------- */
app.get("/api/paired", auth, (req, res) => {
  if (req.role !== "owner") return res.json([]);
  res.json(readJSON(FilePaired));
});

/* ---------- USERS (owner only) ---------- */
app.get("/api/users", auth, ownerOnly, (req, res) => res.json(accounts.list()));
app.post("/api/users", auth, ownerOnly, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, msg: "Username & password wajib" });
  if (!["owner", "member"].includes(role)) return res.status(400).json({ ok: false, msg: "Role harus owner/member" });
  try {
    const u = accounts.create(username, password, role);
    res.json({ ok: true, user: u });
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});
app.put("/api/users/:username", auth, ownerOnly, (req, res) => {
  const { password, role } = req.body || {};
  try {
    const u = accounts.update(req.params.username, { password, role });
    res.json({ ok: true, user: u });
  } catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});
app.delete("/api/users/:username", auth, ownerOnly, (req, res) => {
  try { accounts.remove(req.params.username); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, msg: e.message }); }
});

/* ---------- RESTART / CLEAR ---------- */
app.post("/api/restart-wa", auth, ownerOnly, async (req, res) => {
  const bot = global.__NTED__ || {};
  if (typeof bot.restartSession === "function") {
    try { await bot.restartSession(); return res.json({ ok: true }); }
    catch (e) { return res.status(500).json({ ok: false, msg: e.message }); }
  }
  res.status(500).json({ ok: false, msg: "restartSession tidak tersedia" });
});
app.post("/api/clear-session", auth, ownerOnly, (req, res) => {
  const bot = global.__NTED__ || {};
  if (typeof bot.clearSession === "function") {
    bot.clearSession();
    return res.json({ ok: true });
  }
  res.status(500).json({ ok: false, msg: "clearSession tidak tersedia" });
});

/* ---------- ATTACK DM ---------- */
app.post("/api/attack", auth, async (req, res) => {
  const { type, target } = req.body || {};
  if (!target || !/^\+?\d{7,15}$/.test(String(target)))
    return res.status(400).json({ ok: false, msg: "Nomor tidak valid" });

  const allowed = ["car", "dbut", "pom", "ios"];
  if (!allowed.includes(type))
    return res.status(400).json({ ok: false, msg: "Tipe DM: car, dbut, pom, ios" });

  const bot = global.__NTED__ || {};
  if (!bot.whatsappStatus) return res.status(400).json({ ok: false, msg: "WhatsApp belum terkoneksi" });
  if (typeof bot.runAttack !== "function") return res.status(500).json({ ok: false, msg: "Attack runner tidak tersedia" });

  // Owner: bebas walau tidak punya nomor sendiri
  // Member: wajib punya nomor minimal 1
  if (req.role !== "owner") {
    const nums = getNumbers();
    const mine = nums.filter(n => n.owner === req.user);
    if (mine.length === 0)
      return res.status(403).json({ ok: false, msg: "Kamu belum punya nomor WA" });
  }

  try {
    bot.runAttack(type, target, req.user).catch(e => console.log("attack err:", e.message));
    res.json({ ok: true, msg: `Attack ${type.toUpperCase()} → ${target}` });
  } catch (e) { res.status(500).json({ ok: false, msg: e.message }); }
});

/* ---------- ATTACK GROUP ---------- */
app.post("/api/bvg-group", auth, async (req, res) => {
  const { type, groupLink } = req.body || {};
  const allowed = ["doct", "dban"];
  if (!allowed.includes(type))
    return res.status(400).json({ ok: false, msg: "Tipe grup: doct, dban" });

  if (!groupLink || !/chat\.whatsapp\.com\//i.test(groupLink))
    return res.status(400).json({ ok: false, msg: "Link grup tidak valid" });

  const code = (groupLink.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/) || [])[1];
  if (!code) return res.status(400).json({ ok: false, msg: "Tidak bisa ambil kode invite" });

  const bot = global.__NTED__ || {};
  if (!bot.whatsappStatus) return res.status(400).json({ ok: false, msg: "WhatsApp belum terkoneksi" });
  if (typeof bot.joinGroupAndAttack !== "function")
    return res.status(500).json({ ok: false, msg: "Fitur grup tidak tersedia" });

  try {
    bot.joinGroupAndAttack(type, code, req.user).catch(e => console.log("bvg-group err:", e.message));
    res.json({ ok: true, msg: `Bot join & ${type.toUpperCase()} grup` });
  } catch (e) { res.status(500).json({ ok: false, msg: e.message }); }
});

/* ---------- START ---------- */
function startWeb() {
  const port = settings.web?.port || 2004;
  app.listen(port, () => {
    console.log("═══════════════════════════════════════");
    console.log(`🌐 Web panel : http://localhost:${port}`);
    console.log(`📂 Public    : ${PUBLIC_DIR}`);
    console.log(`📂 Connects  : ${CONNECTS_DIR}`);
    console.log(`👥 Accounts  : ${accounts.FILE}`);
    console.log(`🔑 Sessions  : in-memory (restart = logout all)`);
    console.log("═══════════════════════════════════════");
  });
}

module.exports = { startWeb };