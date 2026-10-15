const crypto = require('node:crypto');

const COOKIE_NAME = 'uttara_cover';
const MAX_AGE_SECONDS = 30 * 60;
const attempts = new Map();

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function makeToken(secret) {
  const payload = base64url(JSON.stringify({ lastActivity: Math.floor(Date.now() / 1000) }));
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return payload + '.' + signature;
}

function setCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + value +
    '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + maxAge);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'এই অনুরোধ গ্রহণযোগ্য নয়।' });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: 'অনুরোধ গ্রহণ করা যায়নি।' });

  const expected = process.env.UTTARA_COVER_PASSWORD;
  const secret = process.env.UTTARA_COVER_SECRET;
  if (!expected || !secret || secret.length < 32) {
    return res.status(503).json({ error: 'কভার পাসওয়ার্ড এখনো নিরাপদভাবে সেট করা হয়নি।' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const previous = attempts.get(ip);
  if (previous && previous.until > now && previous.count >= 8) {
    res.setHeader('Retry-After', String(Math.ceil((previous.until - now) / 1000)));
    return res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।' });
  }
  if (!previous || previous.until <= now) attempts.set(ip, { count: 0, until: now + 15 * 60 * 1000 });

  let password = '';
  try {
    password = typeof req.body?.password === 'string' ? req.body.password : '';
  } catch {}
  const suppliedHash = crypto.createHash('sha256').update(password).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  const matches = crypto.timingSafeEqual(suppliedHash, expectedHash);
  if (!matches) {
    const state = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
    state.count += 1;
    attempts.set(ip, state);
    await new Promise(resolve => setTimeout(resolve, 350));
    return res.status(401).json({ error: 'পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন।' });
  }

  attempts.delete(ip);
  setCookie(res, makeToken(secret), MAX_AGE_SECONDS);
  return res.status(200).json({ ok: true });
};
