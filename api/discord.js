export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || "";
  const allowed = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,x-api-key,x-vercel-protection-bypass"
  );
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  if (req.headers["x-api-key"] !== process.env.SHARED_SECRET)
    return res.status(401).json({ error: "Unauthorized" });

  const { content, code, lang, embeds } = req.body || {};
  if (!content && !embeds && !code)
    return res.status(400).json({ error: "content or code required" });

  const wrapped =
    !content && code ? `\`\`\`${lang || ""}\n${String(code)}\n\`\`\`` : content;

  const r = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: wrapped, embeds }),
  });

  if (!r.ok && r.status !== 204) {
    const text = await r.text();
    return res
      .status(502)
      .json({ error: "Discord error", status: r.status, detail: text });
  }
  return res.status(204).end();
}
