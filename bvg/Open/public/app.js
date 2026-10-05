// =========================================================
//  APP.JS — Dual Auth + Drawer + Icons
// =========================================================

const TOKEN_KEY = "nted_token";
const USER_KEY  = "nted_user";
const ROLE_KEY  = "nted_role";

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser()  { return localStorage.getItem(USER_KEY); }
function getRole()  { return localStorage.getItem(ROLE_KEY); }
function isOwner()  { return getRole() === "owner"; }

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
}

async function logout() {
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      headers: getToken() ? { "Authorization": "Bearer " + getToken() } : {}
    });
  } catch {}
  clearAuth();
  location.href = "/login";
}

async function checkAuth() {
  try {
    const headers = {};
    const tok = getToken();
    if (tok) headers["Authorization"] = "Bearer " + tok;
    const r = await fetch("/api/me", { credentials: "include", headers, cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.ok) {
      localStorage.setItem(USER_KEY, d.user);
      localStorage.setItem(ROLE_KEY, d.role);
      return d;
    }
  } catch {}
  return null;
}

async function requireAuth() {
  const me = await checkAuth();
  if (!me) {
    if (!location.pathname.includes("login")) location.href = "/login";
    return false;
  }
  return true;
}

async function api(url, opts = {}) {
  opts.credentials = "include";
  opts.headers = opts.headers || {};
  opts.cache = "no-store";
  const tok = getToken();
  if (tok) opts.headers["Authorization"] = "Bearer " + tok;
  const r = await fetch(url, opts);
  if (r.status === 401) {
    clearAuth();
    if (!location.pathname.includes("login")) location.href = "/login";
    throw new Error("Unauthorized");
  }
  return r.json();
}
async function apiJSON(url, method, body) {
  return api(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function fmtSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 ** 2) return (b / 1024).toFixed(2) + " KB";
  if (b < 1024 ** 3) return (b / 1024 ** 2).toFixed(2) + " MB";
  return (b / 1024 ** 3).toFixed(2) + " GB";
}
function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function ensureToastWrap() {
  let w = document.querySelector(".toast-wrap");
  if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.appendChild(w); }
  return w;
}
function toast(msg, type = "info", dur = 3000) {
  const w = ensureToastWrap();
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, dur);
}

// =========================================================
//  ICONS
// =========================================================
const Icon = {
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor"/></svg>`,
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  bvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  sender: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  wa: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  ram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><line x1="7" y1="10" x2="7" y2="14"/><line x1="11" y1="10" x2="11" y2="14"/><line x1="15" y1="10" x2="15" y2="14"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  node: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  restart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  car: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1l2-3h8l2 3h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>`,
  bolt2: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  freeze: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/></svg>`,
  apple: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v1H8a4 4 0 0 0-4 4 4 4 0 0 0 4 4h1v4a3 3 0 0 0 6 0v-4h1a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-1V5a3 3 0 0 0-3-3z"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`,
  ban: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l4 4 6-8 6 8 4-4-2 12H4L2 8z"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
};

// =========================================================
//  SIDEBAR — BRAND + 3 NAV (kotak dengan tulisan)
// =========================================================
function renderSidebar(active) {
  const items = [
    { key: "dashboard", href: "/dashboard", icon: Icon.dashboard, label: "Dashboard" },
    { key: "bvg",       href: "/bvg",       icon: Icon.bvg,       label: "BVG" },
    { key: "sender",    href: "/sender",    icon: Icon.sender,    label: "Sender" }
  ];

  return `
    <aside class="sidebar">
      <div class="sidebar-row">
        <a href="/dashboard" class="nav-box nav-brand" title="Null Tr4sher">
          <span class="nav-icon">${Icon.bolt}</span>
          <span class="nav-text">NULL TR4SHER</span>
        </a>

        ${items.map(i => `
          <a href="${i.href}" class="nav-box ${i.key === active ? "active" : ""}" title="${i.label}">
            <span class="nav-icon">${i.icon}</span>
            <span class="nav-text">${i.label}</span>
          </a>
        `).join("")}
      </div>
    </aside>
  `;
}
function bindLogout() { /* tidak dipakai lagi */ }

function roleBadge() {
  return isOwner()
    ? `<span class="role-badge owner"><span class="badge-icon">${Icon.crown}</span>OWNER</span>`
    : `<span class="role-badge member"><span class="badge-icon">${Icon.user}</span>MEMBER</span>`;
}

// =========================================================
//  HAMBURGER DRAWER
// =========================================================
function openDrawer() {
  let drawer = document.getElementById("ntedDrawer");
  let overlay = document.getElementById("ntedOverlay");

  if (!drawer) {
    overlay = document.createElement("div");
    overlay.id = "ntedOverlay";
    overlay.className = "nted-overlay";
    overlay.onclick = closeDrawer;
    document.body.appendChild(overlay);

    drawer = document.createElement("div");
    drawer.id = "ntedDrawer";
    drawer.className = "nted-drawer";
    document.body.appendChild(drawer);
  }

  drawer.innerHTML = `
    <div class="drawer-header">
      <div class="drawer-title">
        <span class="drawer-icon">${Icon.bolt}</span>
        <span>MENU</span>
      </div>
      <button class="drawer-close" id="drawerClose">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="drawer-body">
      ${isOwner() ? `
        <div class="drawer-section-title">OWNER PANEL</div>

        <a class="drawer-item" href="/users">
          <span class="drawer-item-icon drawer-icon-pink">${Icon.plus}</span>
          <span class="drawer-item-text"><b>Create User</b><small>Buat akun baru</small></span>
          <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>

        <a class="drawer-item" href="/users">
          <span class="drawer-item-icon drawer-icon-cyan">${Icon.users}</span>
          <span class="drawer-item-text"><b>Users List</b><small>Lihat semua akun</small></span>
          <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>
      ` : `
        <div class="drawer-section-title">PROFIL</div>

        <div class="drawer-item drawer-item-disabled">
          <span class="drawer-item-icon drawer-icon-gray">${Icon.user}</span>
          <span class="drawer-item-text"><b>${getUser()}</b><small>${getRole()}</small></span>
        </div>
      `}

      <div class="drawer-section-title">NAVIGASI</div>

      <a class="drawer-item" href="/dashboard">
        <span class="drawer-item-icon drawer-icon-yellow">${Icon.dashboard}</span>
        <span class="drawer-item-text"><b>Dashboard</b><small>Status & statistik</small></span>
        <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
      </a>

      <a class="drawer-item" href="/bvg">
        <span class="drawer-item-icon drawer-icon-pink">${Icon.bvg}</span>
        <span class="drawer-item-text"><b>BVG Attack</b><small>Bug & crash panel</small></span>
        <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
      </a>

      <a class="drawer-item" href="/sender">
        <span class="drawer-item-icon drawer-icon-lime">${Icon.sender}</span>
        <span class="drawer-item-text"><b>Sender Manager</b><small>Kelola nomor WA</small></span>
        <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
      </a>

      <div class="drawer-section-title">AKUN</div>

      <a class="drawer-item drawer-item-danger" href="#" id="drawerLogout">
        <span class="drawer-item-icon drawer-icon-red">${Icon.logout}</span>
        <span class="drawer-item-text"><b>Logout</b><small>Keluar dari akun</small></span>
        <span class="drawer-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>
      </a>
    </div>

    <div class="drawer-footer"><span>NTED © SINCE 2##9</span></div>
  `;

  const dLogout = document.getElementById("drawerLogout");
  if (dLogout) dLogout.onclick = (e) => { e.preventDefault(); logout(); };
  const dClose = document.getElementById("drawerClose");
  if (dClose) dClose.onclick = closeDrawer;

  requestAnimationFrame(() => {
    overlay.classList.add("show");
    drawer.classList.add("show");
  });
}

function closeDrawer() {
  const drawer = document.getElementById("ntedDrawer");
  const overlay = document.getElementById("ntedOverlay");
  if (drawer) drawer.classList.remove("show");
  if (overlay) overlay.classList.remove("show");
  setTimeout(() => {
    if (drawer && !drawer.classList.contains("show")) drawer.remove();
    if (overlay && !overlay.classList.contains("show")) overlay.remove();
  }, 300);
}

function hamburgerBtn() {
  return `
    <button class="hamburger-btn" onclick="openDrawer()" title="Menu">
      ${Icon.menu}
    </button>
  `;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});