import "dotenv/config";
import express from "express";

const app = express();

/** CORS */
const ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-api-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/** Simple auth */
function checkAuth(req, res) {
  if (
    !process.env.SHARED_SECRET ||
    req.headers["x-api-key"] !== process.env.SHARED_SECRET
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/** Manual JSON reader (avoids Content-Length mismatch issues) */
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("Invalid JSON: " + e.message);
  }
}

/** Health check */
app.get("/ping", (_req, res) => res.json({ ok: true }));

/** tiny HTML helpers for /relay responses */
function html(res, status, message, autoclose = false) {
  res.status(status).type("text/html; charset=utf-8").send(
    `<!doctype html><meta charset="utf-8"><title>relay</title>
     <body style="font-family:system-ui;padding:16px">
       <div>${message}</div>
       ${autoclose ? `<script>setTimeout(()=>window.close(),1200)</script>` : ""}
     </body>`
  );
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function buildDiscordContent({ msg = "", code = "", lang = "" }) {
  // prefer message if present
  if (msg && msg.length <= 2000) return msg;

  // normalize code + language
  const safeLang = String(lang || "")
    .replace(/[^\w.+\-#]/g, "")
    .slice(0, 20);
  let safeCode = String(code || "").replace(/\r\n/g, "\n");

  const open = "```" + safeLang + "\n";
  const close = "\n```";
  const max = 2000;
  const room = Math.max(0, max - open.length - close.length);

  if (safeCode.length > room) {
    // keep a small suffix to indicate truncation (fits within 2000)
    const suffix = "\n…[truncated]";
    const keep = Math.max(0, room - suffix.length);
    safeCode = safeCode.slice(0, keep) + suffix;
  }
  return open + safeCode + close;
}

app.get("/relay", async (req, res) => {
  try {
    // Optional referer allowlist
    const referer = req.headers.referer || "";
    const allowedReferers = (
      process.env.ALLOWED_REFERERS ||
      "https://www.roblox.com,https://web.roblox.com"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      referer &&
      allowedReferers.length &&
      !allowedReferers.some((r) => referer.startsWith(r))
    ) {
      return html(res, 403, "Forbidden (bad referer)");
    }

    const msg = (req.query.m || "").toString();
    const lang = (req.query.lang || "").toString();

    // Accept either ?code=... or Base64 via ?code_b64=...
    let code = req.query.code != null ? String(req.query.code) : "";
    if (!code && req.query.code_b64 != null) {
      try {
        code = Buffer.from(String(req.query.code_b64), "base64").toString(
          "utf8"
        );
      } catch {
        return html(res, 400, "Invalid code_b64");
      }
    }

    if (!msg && !code) return html(res, 400, "Missing message or code");

    // Build a safe Discord message (<= 2000 chars), with fencing when using code
    const content = msg || buildDiscordContent({ code, lang });

    if (!process.env.DISCORD_WEBHOOK_URL) {
      return html(res, 500, "Webhook not configured");
    }

    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    if (!r.ok && r.status !== 204) {
      const t = await r.text();
      return html(
        res,
        502,
        `Discord error: ${r.status}<br>${escapeHtml(t).slice(0, 500)}`
      );
    }
    return html(res, 200, "Sent ✅", true);
  } catch (e) {
    return html(res, 400, "Error: " + escapeHtml(e?.message || e));
  }
});


app.post("/discord", async (req, res) => {
  try {
    // if (!checkAuth(req, res)) return; // keep/restore auth as you prefer
    const body = await readJson(req);
    const { content, code, lang, embeds } = body || {};

    if (!content && !embeds && !code) {
      return res.status(400).json({ error: "content or code required" });
    }

    const finalContent = content || buildDiscordContent({ code, lang });

    if (!process.env.DISCORD_WEBHOOK_URL) {
      return res.status(500).json({ error: "Webhook not configured" });
    }

    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: finalContent, embeds }),
    });

    const text = await r.text();
    if (!r.ok && r.status !== 204) {
      return res
        .status(502)
        .json({ error: "Discord error", status: r.status, detail: text });
    }
    return res.status(204).end();
  } catch (e) {
    console.error("[discord] error:", e);
    return res.status(400).json({ error: String(e.message || e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Local server on :" + port));
