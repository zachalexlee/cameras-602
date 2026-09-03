/**
 * Session auth for the single-user dashboard.
 *
 * A session is an HMAC-SHA256 signed token stored in an HttpOnly cookie.
 * Token format: `v1.<expiresAtUnixSeconds>.<base64url(HMAC(secret, "v1.<exp>"))>`
 *
 * Everything here uses the Web Crypto API so it works identically in
 * `proxy.ts`, route handlers and server components.
 */

export const SESSION_COOKIE_NAME = "dash_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const TOKEN_VERSION = "v1";
const MIN_SECRET_LENGTH = 16;

const encoder = new TextEncoder();

function getAuthSecret(): string | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return secret;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of u8) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Creates a signed session token that expires SESSION_TTL_SECONDS from now. */
export async function createSessionToken(now: number = Date.now()): Promise<string> {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error(`AUTH_SECRET is not set or is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${exp}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** Returns true only for a well-formed, unexpired token with a valid signature. Fails closed. */
export async function verifySessionToken(
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const secret = getAuthSecret();
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expText, signatureText] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!/^\d{1,12}$/.test(expText)) return false;
  if (Number(expText) * 1000 <= now) return false;

  const signature = fromBase64Url(signatureText);
  if (!signature || signature.length !== 32) return false;

  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${version}.${expText}`));
}

/**
 * Constant-time password check against DASHBOARD_PASSWORD.
 * Both sides are hashed first so the comparison length never leaks the password length.
 */
export async function passwordMatches(candidate: string): Promise<boolean> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return constantTimeEqual(new Uint8Array(a), new Uint8Array(b));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

/** True when the server is configured well enough to accept logins. */
export function authConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_PASSWORD) && getAuthSecret() !== null;
}
