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

/** GET /relay  -> server-side post to Discord using query (?m) or (?code&lang) */
app.get("/relay", async (req, res) => {
  try {
    // Optional: referer allowlist (defense-in-depth; OK to remove if annoying)
    const referer = req.headers.referer || "";
    const allowedReferers = (process.env.ALLOWED_REFERERS || "https://www.roblox.com,https://web.roblox.com")
      .split(",").map(s => s.trim()).filter(Boolean);
    if (referer && allowedReferers.length && !allowedReferers.some(r => referer.startsWith(r))) {
      return html(res, 403, "Forbidden (bad referer)");
    }

    const msg  = (req.query.m || "").toString().trim();
    const code = req.query.code != null ? String(req.query.code) : "";
    const lang = (req.query.lang || "").toString().trim();

    if (!msg && !code) return html(res, 400, "Missing message or code");

    const content = msg || `\`\`\`${lang}\n${code}\n\`\`\``;

    if (!process.env.DISCORD_WEBHOOK_URL) {
      return html(res, 500, "Webhook not configured");
    }

    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });

    if (!r.ok && r.status !== 204) {
      const t = await r.text();
      return html(res, 502, `Discord error: ${r.status}<br>${escapeHtml(t).slice(0,500)}`);
    }

    return html(res, 200, "Sent ✅", true);
  } catch (e) {
    return html(res, 400, "Error: " + escapeHtml(e?.message || e));
  }
});


/** POST /api/discord -> forwards {content}|{code,lang} */
app.post("/discord", async (req, res) => {
  try {
    // if (!checkAuth(req, res)) return;
    const body = await readJson(req);

    let { content, code, lang, embeds } = body || {};
    if (!content && !embeds && !code) {
      return res.status(400).json({ error: "content or code required" });
    }
    if (!content && code) {
      const fence = "```";
      content = `${fence}${(lang || "").trim()}\n${String(code)}\n${fence}`;
    }

    if (!process.env.DISCORD_WEBHOOK_URL) {
      return res.status(500).json({ error: "Webhook not configured" });
    }

    const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });

    const text = await r.text(); // for logging if needed
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
