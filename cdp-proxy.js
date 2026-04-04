// Simple HTTP + WebSocket proxy: 0.0.0.0:9223 → 127.0.0.1:9222
// Allows other Docker containers to reach Chromium's CDP endpoint

const http = require('http');
const net = require('net');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 9222;
const LISTEN_PORT = 9223;

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
  const proxy = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });
  req.pipe(proxy);
  proxy.on('error', () => res.end());
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
  const proxy = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const hdrs = { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
    proxy.write(
      `GET ${req.url} HTTP/1.1\r\n` +
      Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
      '\r\n\r\n'
    );
    if (head.length) proxy.write(head);
  });
  proxy.pipe(socket);
  socket.pipe(proxy);
  proxy.on('error', () => socket.destroy());
  socket.on('error', () => proxy.destroy());
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`CDP proxy: 0.0.0.0:${LISTEN_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
});
