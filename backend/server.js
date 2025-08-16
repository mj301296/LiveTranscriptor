import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { googleStream, googleChunk } from './adapters/google.js';

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/chunk', express.raw({ type: 'application/octet-stream', limit: '50mb' }), async (req, res) => {
  try {
    const out = await googleChunk(req.body);
    res.json({ text: out });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const source = url.searchParams.get('source') || 'mixed';

  googleStream(socket, source);
});

const PORT = process.env.PORT || 8787;
server.listen(PORT, () => console.log('Relay listening on', PORT));
