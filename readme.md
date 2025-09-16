# rbx-proxy

A small Node.js (Express) proxy that:

* sends Discord messages at `/api/discord`
* forwards POST requests to approved external APIs at `/api/proxy` (bypasses browser CORS)

## Endpoints

1. `POST /api/discord`
   Body: `{ "content": "text", "embeds": [...] }` (content or embeds is required)
   Action: posts to the Discord webhook set in `DISCORD_WEBHOOK_URL`. Returns 204 on success.

2. `POST /api/proxy`
   Body: `{ "url": "https://target", "body": {...}, "headers": {...}, "passThroughAuth": false }`
   Action: forwards a POST to `url` if the domain is whitelisted. Mirrors upstream status and body.

## Security and safeguards

* Auth via `x-api-key` header that must match `SHARED_SECRET`
* CORS allowlist via `ALLOWED_ORIGINS`
* Upstream allowlist via `WHITELIST_UPSTREAMS` (only these domains are allowed)
* JSON size limit (200 KB)
* Rate limiting on `/api/*` (60 req per minute by default)

## Environment variables

Create `.env` with:

```
PORT=3000
DISCORD_WEBHOOK_URL=your_discord_webhook_url
SHARED_SECRET=your_strong_secret
ALLOWED_ORIGINS=https://rbxchecking.com,https://localhost:5173,http://localhost:5173
WHITELIST_UPSTREAMS=https://httpbin.org,https://users.roblox.com,https://apis.roblox.com,https://auth.roblox.com
```

Notes:

* No spaces and no trailing slashes in comma lists
* Only include domains you intend to call through `/api/proxy`

## Setup

```bash
npm install
npm start
```

Server starts on `http://localhost:3000` unless `PORT` is set.

## Quick tests

### 1) Discord

```bash
curl -i -X POST http://localhost:3000/api/discord \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"content":"Proxy is live ✅"}'
```

Expected: `204 No Content` and the message appears in your Discord channel.

### 2) Proxy to a safe echo service

Whitelist `https://httpbin.org` in `.env` first, then:

```bash
curl -i -X POST http://localhost:3000/api/proxy \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"url":"https://httpbin.org/post","body":{"ping":"pong"},"headers":{"X-Test":"yes"}}'
```

Expected: `200 OK` and JSON that echoes your payload.

### 3) Browser preflight (optional)

```bash
curl -i -X OPTIONS http://localhost:3000/api/proxy \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-api-key"
```

Expected: `204 No Content` with the allow headers visible.

## Using the proxy with Roblox

* To prove Roblox CORS bypass without auth, you can call:

  * `url: "https://users.roblox.com/v1/usernames/users"`
  * `body: { "usernames": ["Roblox"] }`
* For other Roblox endpoints, add the base domain to `WHITELIST_UPSTREAMS` and pass any required headers in the `headers` object (for example `{"x-api-key": "YOUR_OPEN_CLOUD_KEY"}` for Open Cloud). Keep secrets on the server.

## Common issues

* Restart the server after changing `.env`
* Use a space after the header colon in curl (for example `-H "x-api-key: YOUR_SECRET"`)
* If you get `401 Unauthorized`, the secret did not match
* If you get `403 Upstream not allowed`, the domain is not in `WHITELIST_UPSTREAMS`
