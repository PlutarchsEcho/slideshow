// Simple WebSocket relay for cross-device slideshow sync
// Run: node relay.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8765;

// MIME types for static files
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

// Store sessions
const sessions = new Map(); // sessionId -> { controller: ws, displays: Set<ws> }
const connections = new Map(); // ws -> { role, sessionId }

// Create HTTP server
const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
    return;
  }

  // List active sessions (for debugging)
  if (req.url === '/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const sessionList = Array.from(sessions.entries()).map(([id, data]) => ({
      sessionId: id,
      hasController: !!data.controller,
      displayCount: data.displays.size
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

// WebSocket handling
server.on('upgrade', (req, socket, head) => {
  // Simple WebSocket handshake
  const key = req.headers['sec-websocket-key'];
  const acceptKey = generateAcceptKey(key);
  
  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    ''
  ].join('\r\n') + '\r\n';
  
  socket.write(response);
  
  const ws = {
    socket,
    send: (data) => sendFrame(socket, JSON.stringify(data)),
    close: () => socket.end()
  };
  
  handleConnection(ws);
});

function handleConnection(ws) {
  let role = null;
  let sessionId = null;
  
  ws.socket.on('data', (data) => {
    const message = parseFrame(data);
    if (!message) return;
    
    try {
      const msg = JSON.parse(message);
      
      switch(msg.cmd) {
        case 'register':
          role = msg.role; // 'controller' or 'display'
          sessionId = msg.sessionId || generateSessionId();
          connections.set(ws.socket, { role, sessionId });
          
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { controller: null, displays: new Set() });
          }
          
          const session = sessions.get(sessionId);
          
          if (role === 'controller') {
            session.controller = ws;
            // Notify controller of existing displays
            ws.send({ cmd: 'status', displays: session.displays.size });
          } else {
            session.displays.add(ws);
            // Notify controller
            if (session.controller) {
              session.controller.send({ cmd: 'displayJoined', sessionId });
            }
            // Notify display it's paired
            ws.send({ cmd: 'paired' });
          }
          
          console.log(`${role} joined session ${sessionId} (${session.displays.size} displays)`);
          break;
          
        case 'show':
        case 'sync':
          // Forward to all displays in session
          const s = sessions.get(sessionId);
          if (s) {
            s.displays.forEach(display => display.send(msg));
          }
          break;
          
        case 'ping':
          ws.send({ cmd: 'pong' });
          break;
      }
    } catch(e) {
      console.error('Message parse error:', e);
    }
  });
  
  ws.socket.on('close', () => {
    const conn = connections.get(ws.socket);
    if (conn) {
      const { role, sessionId } = conn;
      const session = sessions.get(sessionId);
      
      if (session) {
        if (role === 'controller') {
          session.controller = null;
        } else {
          session.displays.delete(ws);
        }
        
        // Clean up empty sessions
        if (!session.controller && session.displays.size === 0) {
          sessions.delete(sessionId);
        }
      }
      
      connections.delete(ws.socket);
      console.log(`${role} left session ${sessionId}`);
    }
  });
  
  ws.socket.on('error', (e) => {
    console.error('Socket error:', e);
  });
}

// WebSocket helpers
function generateAcceptKey(key) {
  const crypto = require('crypto');
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function sendFrame(socket, data) {
  const payload = Buffer.from(data, 'utf8');
  const frame = Buffer.allocUnsafe(2 + payload.length);
  
  frame[0] = 0x81; // FIN + text frame
  frame[1] = payload.length; // No mask, length < 126
  payload.copy(frame, 2);
  
  socket.write(frame);
}

function parseFrame(buffer) {
  if (buffer.length < 2) return null;
  
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x08) return null; // Close frame
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
  
  if (masked) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }
  
  return payload.toString('utf8');
}

function generateSessionId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

server.listen(PORT, () => {
  console.log(`Slideshow relay running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
