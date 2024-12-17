import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes, managedNonce } from "@noble/ciphers/webcrypto";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

function getSessionCipher() {
  const keyHex = process.env.API_SESSION_KEY;
  if (!keyHex || keyHex.length !== 64) throw new Error("No session key");
  const key = hexToBytes(keyHex);
  return managedNonce(xchacha20poly1305)(key); // manages nonces for you
}

export function createSessionToken(pubkey: string) {
  if (pubkey.length !== 64) throw new Error("Bad pubkey");
  const cipher = getSessionCipher();
  const payload = JSON.stringify([pubkey, Math.floor(Date.now() / 1000)]);
  const data = utf8ToBytes(payload);
  const ciphertext = cipher.encrypt(data);
  return Buffer.from(ciphertext).toString("base64");
}

export function parseSessionToken(token: string) {
  if (!token || token.length < 10) return undefined;
  try {
    const bytes = Buffer.from(token, "base64");
    const cipher = getSessionCipher();
    const payload = cipher.decrypt(bytes);
    const data = JSON.parse(Buffer.from(payload).toString("utf-8"));
    if (
      Array.isArray(data) &&
      data.length >= 2 &&
      data[0].length === 64 &&
      data[1] > 0
    ) {
      return {
        pubkey: data[0],
        timestamp: data[1],
      };
    }
  } catch (e) {
    console.log("bad session token", token, e);
  }
  return undefined;
}

export function generateOTP() {
  return [...randomBytes(6)]
    .map((b) => b % 10)
    .map((b) => "" + b)
    .join("");
}
