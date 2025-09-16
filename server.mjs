import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "200kb" }));

// CORS: allow Roblox website
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
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-api-key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Rate limit + tiny auth
app.use("/api/", rateLimit({ windowMs: 60_000, max: 60 }));
function checkAuth(req, res) {
  if (req.headers["x-api-key"] !== process.env.SHARED_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// POST /api/discord  -> forwards {content}|{code,lang} to your webhook
app.post("/api/discord", async (req, res) => {
  try {
    if (!checkAuth(req, res)) return;
    let { content, code, lang, embeds } = req.body || {};
    if (!content && !embeds && !code) {
      return res.status(400).json({ error: "content or code required" });
    }
    if (!content && code) {
      const fence = "```";
      content = `${fence}${(lang || "").trim()}\n${String(code)}\n${fence}`;
    }
    const resp = await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, embeds }),
    });
    const text = await resp.text();
    if (!resp.ok && resp.status !== 204) {
      return res
        .status(502)
        .json({ error: "Discord error", status: resp.status, detail: text });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

export default app;

// If running locally (not serverless)
if (process.env.VERCEL !== "1") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log("Server on :" + port));
}
