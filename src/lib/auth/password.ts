import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, "hex");
  // Buffer.from(..., "hex") silently truncates at the first invalid hex
  // character instead of throwing, so a corrupt/malformed key (e.g. "zz",
  // which contains no valid hex digits) would otherwise decode to a
  // 0-length buffer. Without this guard, scrypt would be asked to derive a
  // 0-length key and timingSafeEqual would trivially "match" two empty
  // buffers regardless of the password — silently accepting any password
  // against a corrupt hash. Requiring the decoded length to match what the
  // hex string actually specifies (2 hex chars per byte) rejects any
  // truncated/invalid decode before it reaches that comparison.
  if (keyBuffer.length === 0 || keyBuffer.length * 2 !== key.length) return false;

  const derivedKey = (await scrypt(password, salt, keyBuffer.length)) as Buffer;
  if (derivedKey.length !== keyBuffer.length) return false;

  return timingSafeEqual(derivedKey, keyBuffer);
}
