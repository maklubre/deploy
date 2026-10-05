const fs = require("fs");
const path = require("path");

const DATABASE_DIR = path.join(__dirname, "..", "database");
const FILE = path.join(DATABASE_DIR, "users.json");

if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  addUser(user) {
    const db = load();
    if (!db[user.id]) {
      db[user.id] = {
        id: user.id,
        name: user.first_name || "-",
        username: user.username || "-",
        joined: Date.now()
      };
    }
    save(db);
  },
  total() { return Object.keys(load()).length; },
  all() { return load(); }
};