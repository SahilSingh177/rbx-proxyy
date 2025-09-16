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

/** POST /api/discord -> forwards {content}|{code,lang} */
app.post("/discord", async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;
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
