require("dotenv").config();

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const qrcode = require("qrcode-terminal");

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = "openrouter/free";
const SESSION_FOLDER = "./session";
const BOT_PREFIX = process.env.BOT_PREFIX || "";
const BOT_NAME = process.env.BOT_NAME || "Asisten AI";

if (!OPENROUTER_API_KEY) {
    console.log("");
    console.log("OPENROUTER_API_KEY belum dipasang.");
    console.log('Gunakan: export OPENROUTER_API_KEY="sk-or-v1-XXXX"');
    console.log("");
    process.exit(1);
}

const SYSTEM_PROMPT = `
Kamu adalah ${BOT_NAME}, asisten AI yang ramah.
- Gunakan bahasa Indonesia secara natural.
- Jawab pertanyaan dengan jelas.
- Jangan terlalu panjang kecuali diminta.
- Jika pengguna menggunakan bahasa santai, balas dengan bahasa santai.
- Jangan mengaku sebagai manusia.
- Jika tidak mengetahui sesuatu, katakan dengan jujur.
- selalu tambah kan emot
- 🗿😭🥰😂😜😇😋🥲🤏🏿🥵💕❤🙏
`;

const chatHistory = new Map();

function getHistory(jid) {
    if (!chatHistory.has(jid)) chatHistory.set(jid, []);
    return chatHistory.get(jid);
}

function addHistory(jid, role, content) {
    const history = getHistory(jid);
    history.push({ role, content });
    while (history.length > 10) history.shift();
}

function getMessageText(message) {
    if (!message) return "";
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    return "";
}

async function askAI(jid, userText) {
    try {
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...getHistory(jid),
            { role: "user", content: userText }
        ];

        const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/",
                "X-Title": "WhatsApp AI Bot"
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages,
                max_tokens: 700,
                temperature: 0.7
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.log("OpenRouter Error:", response.status);
            console.log(JSON.stringify(data, null, 2));

            if (response.status === 401)
                return "❌ API key OpenRouter tidak valid.";

            if (response.status === 429)
                return "⏳ AI sedang terkena batas penggunaan gratis. Coba lagi beberapa saat.";

            return "❌ AI sedang mengalami masalah. Silakan coba lagi.";
        }

        const answer = data?.choices?.[0]?.message?.content?.trim();

        if (!answer) {
            console.log("Response OpenRouter kosong:");
            console.log(JSON.stringify(data, null, 2));
            return "❌ AI tidak memberikan jawaban.";
        }

        addHistory(jid, "user", userText);
        addHistory(jid, "assistant", answer);

        return answer;
    } catch (error) {
        console.error("AI ERROR:", error);
        return "❌ Terjadi kesalahan saat menghubungi AI.";
    }
}

async function startBot() {
    console.log("");
    console.log("====================================");
    console.log("          WHATSAPP AI BOT");
    console.log("====================================");
    console.log("");
    console.log("Asisten AI sedang dijalankan...");
    console.log("AI: ON");
    console.log("Provider: OpenRouter");
    console.log("Model:", AI_MODEL);
    console.log("Prefix:", BOT_PREFIX || "(semua pesan)");
    console.log("");

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

    let version;
    try {
        const result = await fetchLatestBaileysVersion();
        version = result.version;
    } catch {
        console.log("Gagal mengambil versi WhatsApp Web.");
    }

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        browser: ["WhatsApp AI Bot", "Chrome", "1.0.0"],
        ...(version ? { version } : {})
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("");
            console.log("====================================");
            console.log("          SCAN QR WHATSAPP");
            console.log("====================================");
            console.log("");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("");
            console.log("====================================");
            console.log(" WhatsApp berhasil terhubung.");
            console.log(" Bot aktif.");
            console.log("====================================");
            console.log("");
        }

        if (connection === "close") {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log("");
            console.log("Koneksi terputus.");
            console.log("Status:", statusCode);
            console.log("Reconnect:", shouldReconnect);

            if (shouldReconnect) {
                console.log("Mencoba menghubungkan kembali...");
                setTimeout(() => startBot(), 5000);
            } else {
                console.log("Session WhatsApp sudah logout.");
                console.log("Hapus folder session lalu jalankan bot kembali.");
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
            try {
                if (!msg.message || msg.key.fromMe) continue;

                const jid = msg.key.remoteJid;
                if (!jid || jid === "status@broadcast") continue;

                const text = getMessageText(msg.message).trim();
                if (!text) continue;

                console.log("");
                console.log("Pesan dari:", jid);
                console.log("Pesan:", text);

                let userText = text;

                if (BOT_PREFIX) {
                    if (!text.toLowerCase().startsWith(BOT_PREFIX.toLowerCase())) continue;

                    userText = text.slice(BOT_PREFIX.length).trim();

                    if (!userText) {
                        await sock.sendMessage(jid, {
                            text: `Ketik pesan setelah ${BOT_PREFIX}`
                        });
                        continue;
                    }
                }

                const command = userText.toLowerCase();

                if (command === "menu") {
                    await sock.sendMessage(jid, {
                        text:
`🤖 *${BOT_NAME}*

Perintah:
• menu
• reset
• ping

Kirim pertanyaan biasa untuk berbicara dengan AI.`
                    });
                    continue;
                }

                if (command === "reset") {
                    chatHistory.delete(jid);
                    await sock.sendMessage(jid, {
                        text: "✅ Riwayat percakapan kamu sudah dihapus."
                    });
                    continue;
                }

                if (command === "ping") {
                    await sock.sendMessage(jid, {
                        text: "🏓 Pong!\nAI Bot aktif."
                    });
                    continue;
                }

                try {
                    await sock.sendPresenceUpdate("composing", jid);
                } catch {}

                console.log("Mengirim ke OpenRouter...");

                const answer = await askAI(jid, userText);

                console.log("Jawaban AI:", answer);

                await sock.sendMessage(jid, { text: answer });

                try {
                    await sock.sendPresenceUpdate("paused", jid);
                } catch {}
            } catch (error) {
                console.error("MESSAGE ERROR:", error);
            }
        }
    });
}

process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (error) => {
    console.error("UNHANDLED REJECTION:", error);
});

startBot();
