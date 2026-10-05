const fs = require("fs");
const path = require("path");

// ===== FOLDER DATABASE =====
const DATABASE_DIR = path.join(__dirname, "..", "database");
const FILE = path.join(DATABASE_DIR, "accounts.json");

if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });

// ===== DEFAULT OWNER =====
function ensureDefault() {
  if (!fs.existsSync(FILE)) {
    const def = {
      admin: { password: "nted123", role: "owner", created: Date.now() }
    };
    fs.writeFileSync(FILE, JSON.stringify(def, null, 2));
    console.log("📝 database/accounts.json dibuat → admin / nted123");
  }
}
ensureDefault();

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  FILE,
  DATABASE_DIR,

  get(username) { return load()[username] || null; },

  verify(username, password) {
    const u = this.get(username);
    if (!u) return null;
    if (u.password !== password) return null;
    return { username, role: u.role || "member" };
  },

  list() {
    const db = load();
    return Object.entries(db).map(([username, u]) => ({
      username,
      role: u.role || "member",
      created: u.created || 0
    }));
  },

  create(username, password, role = "member") {
    const db = load();
    if (db[username]) throw new Error("Username sudah dipakai");
    if (!["owner", "member"].includes(role)) throw new Error("Role tidak valid");
    if (username.length < 3) throw new Error("Username minimal 3 karakter");
    if (password.length < 4) throw new Error("Password minimal 4 karakter");
    db[username] = { password, role, created: Date.now() };
    save(db);
    return { username, role };
  },

  update(username, { password, role } = {}) {
    const db = load();
    if (!db[username]) throw new Error("User tidak ditemukan");
    if (password) db[username].password = password;
    if (role && ["owner", "member"].includes(role)) db[username].role = role;
    save(db);
    return { username, role: db[username].role };
  },

  remove(username) {
    const db = load();
    if (!db[username]) throw new Error("User tidak ditemukan");
    const owners = Object.values(db).filter(u => u.role === "owner").length;
    if (db[username].role === "owner" && owners <= 1) {
      throw new Error("Tidak bisa hapus owner terakhir");
    }
    delete db[username];
    save(db);
    return true;
  }
};