#!/usr/bin/env node
// Slideshow Relay Server
// Provides WebSocket relay for cross-device slideshow sync
// 
// Usage: node relay-server.js [port]
// Default port: 8765

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || process.argv[2] || 8765;

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

// Session storage
const sessions = new Map(); // sessionId -> { controller: ws, displays: Set<ws> }
const connections = new Map(); // ws -> { role, sessionId }

// HTTP Server
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoints
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      sessions: sessions.size,
      timestamp: Date.now()
    }));
    return;
  }

  if (req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
      sessionId: id,
      hasController: !!data.controller,
      displayCount: data.displays.size,
      created: data.created
    }));
    res.end(JSON.stringify(sessionList));
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/slideshow.html' : req.url;
  filePath = path.join(__dirname, filePath);
  
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket upgrade handling
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  
  const acceptKey = generateAcceptKey(key);
  
  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    ''
  ].join('\r\n');
  
  socket.write(response);
  
  handleWebSocket(socket);
});

function handleWebSocket(socket) {
  let role = null;
  let sessionId = null;
  
  socket.on('data', (data) => {
    const message = parseWebSocketFrame(data);
    if (!message) return;
    
    try {
      const msg = JSON.parse(message);
      
      switch(msg.cmd) {
        case 'register':
          role = msg.role;
          sessionId = msg.sessionId || generateSessionId();
          
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { 
              controller: null, 
              displays: new Set(),
              created: Date.now()
            });
          }
          
          const session = sessions.get(sessionId);
          
          if (role === 'controller') {
            session.controller = socket;
            send(socket, { cmd: 'status', displays: session.displays.size });
          } else {
            session.displays.add(socket);
            if (session.controller) {
              send(session.controller, { cmd: 'displayJoined', sessionId });
            }
            send(socket, { cmd: 'paired' });
          }
          break;
          
        case 'show':
        case 'sync':
          const s = sessions.get(sessionId);
          if (s) {
            s.displays.forEach(display => send(display, msg));
          }
          break;
          
        case 'ping':
          send(socket, { cmd: 'pong' });
          break;
      }
    } catch(e) {
      console.error('Message error:', e);
    }
  });
  
  socket.on('close', () => {
    cleanup(socket, role, sessionId);
  });
  
  socket.on('error', () => {
    cleanup(socket, role, sessionId);
  });
}

function cleanup(socket, role, sessionId) {
  if (!sessionId) return;
  
  const session = sessions.get(sessionId);
  if (session) {
    if (role === 'controller') {
      session.controller = null;
    } else {
      session.displays.delete(socket);
    }
    
    if (!session.controller && session.displays.size === 0) {
      sessions.delete(sessionId);
    }
  }
}

function send(socket, data) {
  if (socket.readyState === 1) { // OPEN
    const frame = encodeWebSocketFrame(JSON.stringify(data));
    socket.write(frame);
  }
}

// WebSocket frame encoding/decoding
function generateAcceptKey(key) {
  const crypto = require('crypto');
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeWebSocketFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  
  if (payload.length < 126) {
    const frame = Buffer.allocUnsafe(2 + payload.length);
    frame[0] = 0x81; // FIN + text
    frame[1] = payload.length;
    payload.copy(frame, 2);
    return frame;
  } else if (payload.length < 65536) {
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    payload.copy(frame, 4);
    return frame;
  }
  // Too large - shouldn't happen for our use case
  return Buffer.alloc(0);
}

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x08) return null; // Close
  if (opcode !== 0x01 && opcode !== 0x02) return null; // Not text/binary
  
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;
  
  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    return null; // Too large
  }
  
  let mask = null;
  if (masked) {
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  
  const payload = buffer.slice(offset, offset + payloadLength);
  
  if (masked && mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }
  
  return payload.toString('utf8');
}

function generateSessionId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Start server
server.listen(PORT, () => {
  console.log(`Slideshow Relay Server running on http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Active sessions: http://localhost:${PORT}/sessions`);
});
