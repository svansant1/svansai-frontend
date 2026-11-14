// A fixed, synthetic comparison target. It never reads workspace files or secrets.
const http = require("node:http");
const server = http.createServer((req, res) => {
  if (req.url === "/hardened") {
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
  } else if (req.url !== "/weak") { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ fixture: true, note: "Synthetic training data only." }));
});
server.listen(8080, "127.0.0.1");
process.once("SIGTERM", () => server.close());
