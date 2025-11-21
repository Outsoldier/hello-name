const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

const sessions = new Map();

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getSessionBySocket(ws) {
  if (!ws.sessionCode) return undefined;
  return sessions.get(ws.sessionCode);
}

function getPeer(ws) {
  const session = getSessionBySocket(ws);
  if (!session) return undefined;
  return session.creator === ws ? session.joiner : session.creator;
}

function clearSession(code) {
  if (sessions.has(code)) {
    sessions.delete(code);
    console.log(`Session ${code} removed.`);
  }
}

server.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (err) {
      send(ws, { type: 'error', message: 'Invalid JSON payload.' });
      return;
    }

    const { type, code } = message;

    switch (type) {
      case 'create': {
        if (sessions.has(code)) {
          send(ws, { type: 'error', message: 'Session code already in use.' });
          return;
        }
        sessions.set(code, { creator: ws });
        ws.sessionCode = code;
        ws.role = 'creator';
        send(ws, { type: 'created', code });
        console.log(`Session ${code} created.`);
        break;
      }
      case 'join': {
        const session = sessions.get(code);
        if (!session || session.joiner) {
          send(ws, { type: 'error', message: 'Session unavailable.' });
          return;
        }
        session.joiner = ws;
        ws.sessionCode = code;
        ws.role = 'joiner';
        send(ws, { type: 'joined', code });
        send(session.creator, { type: 'peer-joined', code });
        console.log(`Session ${code} joined by peer.`);
        break;
      }
      case 'sdp-offer': {
        const peer = getPeer(ws);
        send(peer, { type: 'sdp-offer', offer: message.offer });
        break;
      }
      case 'sdp-answer': {
        const peer = getPeer(ws);
        send(peer, { type: 'sdp-answer', answer: message.answer });
        break;
      }
      case 'ice-candidate': {
        const peer = getPeer(ws);
        send(peer, { type: 'ice-candidate', candidate: message.candidate });
        break;
      }
      case 'connected': {
        const session = getSessionBySocket(ws);
        if (session) {
          if (ws.role === 'creator') {
            session.creatorConnected = true;
          } else {
            session.joinerConnected = true;
          }
          if (session.creatorConnected && session.joinerConnected) {
            clearSession(ws.sessionCode);
          }
        }
        break;
      }
      case 'leave': {
        const peer = getPeer(ws);
        send(peer, { type: 'error', message: 'Peer left the session.' });
        clearSession(code);
        break;
      }
      default:
        send(ws, { type: 'error', message: 'Unknown message type.' });
    }
  });

  ws.on('close', () => {
    const session = getSessionBySocket(ws);
    if (session) {
      const peer = getPeer(ws);
      send(peer, { type: 'error', message: 'Peer disconnected.' });
      clearSession(ws.sessionCode);
    }
  });
});

console.log(`Signaling server running on ws://localhost:${PORT}`);
