const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateKeyPair() {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'X25519',
    },
    true,
    ['deriveKey', 'deriveBits'],
  );
}

export async function exportPublicKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64(raw);
}

export async function importPublicKey(base64) {
  const data = fromBase64(base64);
  return crypto.subtle.importKey(
    'raw',
    data,
    {
      name: 'ECDH',
      namedCurve: 'X25519',
    },
    false,
    [],
  );
}

async function deriveSecret(localPrivateKey, remotePublicKey) {
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: remotePublicKey,
    },
    localPrivateKey,
    256,
  );
  return new Uint8Array(bits);
}

export async function deriveSharedKey(localPrivateKey, remotePublicKey) {
  const shared = await deriveSecret(localPrivateKey, remotePublicKey);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(16),
      info: textEncoder.encode('p2p-webrtc-chat'),
    },
    hkdfKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptMessage(sharedKey, message) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    sharedKey,
    textEncoder.encode(message),
  );
  return {
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
}

export async function decryptMessage(sharedKey, payload) {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.data);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    sharedKey,
    ciphertext,
  );
  return textDecoder.decode(plaintext);
}

export { toBase64, fromBase64 };
