<p align="center">
  <img src="https://files.catbox.moe/2ryxq0.jpg" width="250"/>
</p>

<h1 align="center">WhatsApp Baileys</h1>

<p align="center">
  A WebSocket-based library for interacting with WhatsApp Web — a fork of Baileys with additional socket layers (Communities, Interop, Privacy, GraphQL) and helpers for special message types such as payments, products, albums, events, poll results, and order messages.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" />
  <img src="https://img.shields.io/badge/license-MIT-blue" />
  <img src="https://img.shields.io/badge/multi--device-supported-success" />
</p>

---

## Table of Contents

- [About](#about)
- [Requirements](#requirements)
- [Installation](#installation)
- [Import](#import)
- [Quick Start](#quick-start)
  - [With QR Code](#with-qr-code)
  - [Connect With Pairing Code](#connect-with-pairing-code)
- [Usage Examples](#usage-examples)
  - [Sending a Message with Participant](#sending-a-message-with-participant)
- [Why Choose WhatsApp Baileys?](#why-choose-whatsapp-baileys)
- [Technical Notes](#technical-notes)
- [Contact Developer](#contact-developer)

---

## About

WhatsApp Baileys is an open-source library designed to help developers build automation solutions and integrations with WhatsApp efficiently and directly. Using WebSocket technology without the need for a browser, this library supports a wide range of features such as message management, chat handling, group administration, as well as interactive messages and action buttons for a more dynamic user experience.

Actively developed and maintained, Baileys continuously receives updates to enhance stability and performance. One of the main focuses is improving the pairing and authentication processes to be more stable and secure. Pairing features can be customized with your own codes, making the process more reliable and less prone to interruptions.

This library is highly suitable for building business bots, chat automation systems, customer service solutions, and various other communication automation applications that require high stability and comprehensive features. With a lightweight and modular design, Baileys is easy to integrate into different systems and platforms.

---

## Requirements

- Node.js **>= 20**
- Optional peer dependencies depending on the features you use:
  - `sharp` or `jimp` for image processing
  - `link-preview-js` for link previews
  - `audio-decode` for audio waveform handling

---

## Installation

```bash
npm install @whiskeysockets/baileys
```

Add it to your `package.json`:

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "github:NtedBitch/bail"
  }
}
```

---

## Import

```javascript
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore
} = require('@whiskeysockets/baileys')
```

---

## Quick Start

### With QR Code

```javascript
const {
  default: makeWASocket,
  Browsers
  // Other Options
} = require('@whiskeysockets/baileys');

const client = makeWASocket({
  browser: Browsers.ubuntu('Chrome'),
  printQRInTerminal: true
});
```

### Connect With Pairing Code

```javascript
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore
  Browsers,
} = require('@whiskeysockets/baileys');

const client = makeWASocket({
  browser: Browsers.ubuntu('Chrome'),
  printQRInTerminal: false,
  version: fetchLatestWAWebVersion(),
  auth: state
});

const nomor = "628XXXXX";
const code = await client.requestPairingCode(nomor.trim()); // Use (nomor, "XXXXXXXX") for custom pairing

console.log("Ur pairing code : " + code);
```

---

## Usage Examples

### Sending a Message with sendRich

```javascript
await sock.sendRich(from, {
  header: {
    disclaimer: true 
    disclaimerText: "Tr4ash Null",
    title: "NtedExec"
  },
  body: {
     title: "",
     buttons: ["bot 1", "Bot 2"]
   },
   footer: {
     text: "Telegram Channel",
     url: "https://t.me/NtedAja"
    }
 });
```

### send simple function interactiveMessage

```javascript
await sock.relayMessage(target, {
 header: {
   title: "Menu Utama 🔥",
   hasMediaAttachment: false
  },
  body: {
    text: "Silakan pilih salah satu opsi:"
   },
   footer: {
     text: "Powered by Baileys"
    },
    nativeFlowMessage: {
      buttons: [
        {
          name: "inapp_signup",
          buttonParamsJson: JSON.stringify({ text: "Daftar" })
        },
        {
          name: "inapp_support",
          buttonParamsJson: JSON.stringify({ text: "Bantuan" })
        },
        {
           name: "inapp_settings",
           buttonParamsJson: JSON.stringify({ text: "Pengaturan" })
        }
    ]
 }
}, {
  ptcp: true
});
```

### Sending a Message with ListMessage

```javascript
async function sendListMessage(number) {
const jid = number + '@s.whatsapp.net';

 const listMessage = {
   text: 'Silakan pilih opsi di bawah:',
   footer: 'Bot WhatsApp',
   title: 'Menu Utama',
   buttonText: '📋 Lihat Menu',
      sections: [
        {
          title: 'Downloader',
          rows: [
            { title: 'TikTok', rowId: 'download_tiktok' },
            { title: 'Instagram', rowId: 'download_instagram' },
            { title: 'CapCut', rowId: 'download_capcut' },
          ],
        },
        {
          title: 'Tools',
          rows: [
            { title: 'Cek IMEI', rowId: 'cek_imei' },
            { title: 'Cek Operator', rowId: 'cek_operator' },
            { title: 'Screenshot Web', rowId: 'ssweb' },
          ],
        },
      ],
    };

    await sock.sendMessage(jid, listMessage);
    console.log(`List message terkirim ke ${targetNumber}`);
  }

  await sendListMessage('6281234567890');
```

### Sending a Message with Participant

```javascript
await sock.sendMessage(m.chat, {
  text: "XxXTr4sah"
}, {
  ptcp: true
});
```

---

## Why Choose WhatsApp Baileys?

Because this library offers high stability, full features, and an actively improved pairing process. It is ideal for developers aiming to create professional and secure WhatsApp automation solutions. Support for the latest WhatsApp features ensures compatibility with platform updates.

---

## Technical Notes

- Supports custom pairing codes that are stable and secure
- Fixes previous issues related to pairing and authentication
- Features interactive messages and action buttons for dynamic menu creation
- Automatic and efficient session management for long-term stability
- Compatible with the latest multi-device features from WhatsApp
- Easy to integrate and customize based on your needs
- Perfect for developing bots, customer service automation, and other communication applications
- Has 1 newsletter follow, only the owner WhatsApp channel: [WhatsApp Channel](https://whatsapp.com/channel/0029Vb6rhzWDeON0EkFJ4G2H)

---

For complete documentation, installation guides, and implementation examples, please visit the official repository and community forums. We continually update and improve this library to meet the needs of developers and users of modern WhatsApp automation solutions.

**Thank you for choosing WhatsApp Baileys as your WhatsApp automation solution!**

---

## Contact Owner

For questions, support, or collaboration, feel free to contact the owner:

- **Telegram**: [Telegram Contact](https://t.me/NtedPakeE)
- **Channel WhatsApp**: [Channel WhatsApp](https://whatsapp.com/channel/0029Vb6rhzWDeON0EkFJ4G2H)
- **Channel Telegram**: [Channel Telegram](https://t.me/NtedCrasherExec)
