import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`appdelivery:v1:${purpose}`).digest();
}

export function otpHash(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', deriveKey(secret, 'otp'))
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

export function csrfToken(secret: string, sessionId: string): string {
  return createHmac('sha256', deriveKey(secret, 'csrf')).update(sessionId).digest('base64url');
}

export function encryptTotp(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'totp'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function decryptTotp(secret: string, encrypted: string): string {
  const data = Buffer.from(encrypted, 'base64url');
  if (data.length < 29) throw new Error('Invalid encrypted MFA secret');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, 'totp'), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encodeBase32(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid MFA secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 4226/6238, SHA-1, 6 digits, 30-second timestep, compatible with authenticator apps.
export function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now.getTime() / 30_000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate >= 0 && safeEqual(totpForStep(secret, candidate), code)) return candidate;
  }
  return null;
}

async function scryptKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$16384$8$1$${salt}$${(await scryptKey(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const pieces = stored?.split('$');
  const validFormat = pieces?.length === 6 && pieces.slice(0, 4).join('$') === 'scrypt$16384$8$1';
  const salt = validFormat ? pieces![4]! : '00000000000000000000000000000000';
  const expected = validFormat ? pieces![5]! : '0'.repeat(128);
  const derived = await scryptKey(password, salt);
  return safeEqual(derived.toString('hex'), expected) && Boolean(validFormat);
}
