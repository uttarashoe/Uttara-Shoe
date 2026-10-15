const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COOKIE_NAME = 'uttara_cover';
const MAX_IDLE_SECONDS = 30 * 60;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

function validToken(token, secret) {
  if (!token || !secret || secret.length < 32) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadPart, signaturePart] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payloadPart).digest();
  let supplied;
  try { supplied = Buffer.from(signaturePart, 'base64url'); } catch { return false; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(payload.lastActivity) &&
      payload.lastActivity <= now + 30 &&
      now - payload.lastActivity < MAX_IDLE_SECONDS;
  } catch { return false; }
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const secret = process.env.UTTARA_COVER_SECRET;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!validToken(token, secret)) {
    res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    res.statusCode = 307;
    res.setHeader('Location', '/cover.html');
    return res.end();
  }
  try {
    const file = path.join(process.cwd(), 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    const script = '<script src="/cover-session.js" defer></script>';
    if (!html.includes('/cover-session.js')) html = html.replace(/<\/body>/i, script + '</body>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch {
    return res.status(500).send('Application page could not be loaded.');
  }
};
