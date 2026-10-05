// Local dev server, no dependencies (Node 18+):
//   GEMINI_API_KEY=your-key node server.js   then open http://localhost:3000
// Serves public/ and routes POST /api/triage to the same handler Vercel uses.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const triage = require("./api/triage.js");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  if (req.url.startsWith("/api/triage")) {
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 8e6) req.destroy(); });
    req.on("end", () => { try { req.body = JSON.parse(raw || "{}"); } catch { req.body = null; } triage(req, res); });
    return;
  }
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(PUBLIC, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, () => console.log(`FixCheck running at http://localhost:${PORT}`));
