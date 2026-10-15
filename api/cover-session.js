const crypto = require('node:crypto');

const COOKIE_NAME = 'uttara_cover';
const MAX_IDLE_SECONDS = 30 * 60;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

function readValidPayload(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signaturePart] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payloadPart).digest();
  let supplied;
  try { supplied = Buffer.from(signaturePart, 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(payload.lastActivity) || payload.lastActivity > now + 30 ||
        now - payload.lastActivity >= MAX_IDLE_SECONDS) return null;
    return payload;
  } catch { return null; }
}

function makeToken(secret) {
  const payload = Buffer.from(JSON.stringify({ lastActivity: Math.floor(Date.now() / 1000) })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  const secret = process.env.UTTARA_COVER_SECRET;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!readValidPayload(token, secret)) {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    return res.status(401).json({ ok: false });
  }
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + makeToken(secret) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + MAX_IDLE_SECONDS);
  return res.status(200).json({ ok: true });
};
