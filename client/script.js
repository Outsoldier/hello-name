import {
  decryptMessage,
  deriveSharedKey,
  encryptMessage,
  exportPublicKey,
  generateKeyPair,
  importPublicKey,
} from './crypto.js';

const SIGNALING_URL = `ws://${location.hostname}:3000`;
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

let signaling;
let peer;
let dataChannel;
let role;
let sessionCode;
let keyPair;
let remotePublicKey;
let sharedKey;
let hasSentPublicKey = false;

const statusEl = document.getElementById('status');
const sessionInput = document.getElementById('session-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const sendBtn = document.getElementById('send-btn');
const messageInput = document.getElementById('message');
const chatLog = document.getElementById('chat-log');

function setStatus(text) {
  statusEl.textContent = text;
}

function appendMessage(text, mine = false) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('bubble', mine ? 'me' : 'them');
  wrapper.textContent = text;
  chatLog.appendChild(wrapper);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function enableChat(enabled) {
  messageInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

async function ensureKeyPair() {
  if (!keyPair) {
    keyPair = await generateKeyPair();
  }
}

function ensureSignaling() {
  if (signaling && signaling.readyState === WebSocket.OPEN) {
    return;
  }

  signaling = new WebSocket(SIGNALING_URL);
  signaling.onopen = () => setStatus('Connected to signaling server.');
  signaling.onmessage = handleSignalMessage;
  signaling.onerror = (err) => {
    console.error(err);
    setStatus('Signaling error.');
  };
  signaling.onclose = () => setStatus('Signaling disconnected.');
}

function sendSignal(payload) {
  if (!signaling || signaling.readyState !== WebSocket.OPEN) {
    setStatus('Signaling not ready yet.');
    return;
  }
  signaling.send(JSON.stringify(payload));
}

async function setupPeer() {
  await ensureKeyPair();
  hasSentPublicKey = false;
  sharedKey = undefined;
  remotePublicKey = undefined;

  peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: 'ice-candidate',
        code: sessionCode,
        candidate: event.candidate,
      });
    }
  };
  peer.onconnectionstatechange = () => {
    setStatus(`Peer connection: ${peer.connectionState}`);
  };
  peer.ondatachannel = (event) => {
    attachDataChannel(event.channel);
  };
}

async function startAsCreator(code) {
  role = 'creator';
  sessionCode = code || randomCode();
  sessionInput.value = sessionCode;
  ensureSignaling();
  setStatus('Creating session...');
  sendSignal({ type: 'create', code: sessionCode });
  await setupPeer();
  dataChannel = peer.createDataChannel('chat');
  attachDataChannel(dataChannel);
}

async function startAsJoiner(code) {
  role = 'joiner';
  sessionCode = code;
  ensureSignaling();
  setStatus('Joining session...');
  await setupPeer();
  sendSignal({ type: 'join', code: sessionCode });
}

async function sendOffer() {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  sendSignal({ type: 'sdp-offer', code: sessionCode, offer });
}

async function handleOffer(offer) {
  await peer.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  sendSignal({ type: 'sdp-answer', code: sessionCode, answer });
}

async function handleAnswer(answer) {
  await peer.setRemoteDescription(new RTCSessionDescription(answer));
}

function attachDataChannel(channel) {
  dataChannel = channel;
  dataChannel.onopen = handleChannelOpen;
  dataChannel.onmessage = handleChannelMessage;
  dataChannel.onclose = () => setStatus('Data channel closed.');
}

async function handleChannelOpen() {
  setStatus('Data channel open. Establishing encryption...');
  enableChat(false);
  await ensureKeyPair();
  sendPublicKey();
  sendSignal({ type: 'connected', code: sessionCode });
}

function sendPublicKey() {
  if (hasSentPublicKey || !dataChannel || dataChannel.readyState !== 'open') {
    return;
  }
  exportPublicKey(keyPair.publicKey).then((key) => {
    dataChannel.send(JSON.stringify({ type: 'key', key }));
    hasSentPublicKey = true;
  });
}

async function establishSharedSecret(remoteKeyBase64) {
  remotePublicKey = await importPublicKey(remoteKeyBase64);
  sharedKey = await deriveSharedKey(keyPair.privateKey, remotePublicKey);
  setStatus('Encryption ready. You can chat securely.');
  enableChat(true);
}

async function handleChannelMessage(event) {
  try {
    const payload = JSON.parse(event.data);
    if (payload.type === 'key') {
      if (!hasSentPublicKey) {
        sendPublicKey();
      }
      await establishSharedSecret(payload.key);
      return;
    }

    if (payload.type === 'cipher') {
      if (!sharedKey) {
        appendMessage('Received encrypted message before key exchange.', false);
        return;
      }
      const text = await decryptMessage(sharedKey, payload);
      appendMessage(text, false);
    }
  } catch (err) {
    console.error('Failed to process message', err);
  }
}

async function sendMessage() {
  if (!sharedKey) {
    setStatus('Encryption not ready.');
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  const encrypted = await encryptMessage(sharedKey, text);
  dataChannel.send(JSON.stringify({ type: 'cipher', ...encrypted }));
  appendMessage(text, true);
  messageInput.value = '';
}

function handleSignalMessage(event) {
  const message = JSON.parse(event.data);
  switch (message.type) {
    case 'created':
      setStatus(`Session ${message.code} created. Waiting for peer...`);
      break;
    case 'joined':
      setStatus(`Joined session ${message.code}. Awaiting offer...`);
      break;
    case 'peer-joined':
      setStatus('Peer joined. Negotiating...');
      sendOffer();
      break;
    case 'sdp-offer':
      handleOffer(message.offer);
      break;
    case 'sdp-answer':
      handleAnswer(message.answer);
      break;
    case 'ice-candidate':
      if (peer) {
        peer.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
      break;
    case 'error':
      setStatus(`Error: ${message.message}`);
      break;
    default:
      break;
  }
}

createBtn.onclick = async () => {
  const code = sessionInput.value.trim().toUpperCase() || randomCode();
  await startAsCreator(code);
};

joinBtn.onclick = async () => {
  const code = sessionInput.value.trim().toUpperCase();
  if (!code) {
    setStatus('Enter a session code to join.');
    return;
  }
  await startAsJoiner(code);
};

sendBtn.onclick = sendMessage;
messageInput.addEventListener('keydown', (evt) => {
  if (evt.key === 'Enter' && !evt.shiftKey) {
    evt.preventDefault();
    sendMessage();
  }
});

window.addEventListener('beforeunload', () => {
  sendSignal({ type: 'leave', code: sessionCode });
});
