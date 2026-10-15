import { NextResponse } from 'next/server';

const COOKIE_NAME = 'uttara_cover';
const MAX_IDLE_SECONDS = 30 * 60;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function validToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadPart, signaturePart] = parts;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(decodeBase64Url(signaturePart), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return false;
    const payload = JSON.parse(decodeBase64Url(payloadPart));
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(payload.lastActivity) &&
      payload.lastActivity <= now + 30 &&
      now - payload.lastActivity < MAX_IDLE_SECONDS;
  } catch {
    return false;
  }
}

export async function middleware(request) {
  const secret = process.env.UTTARA_COVER_SECRET;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (secret && token && await validToken(token, secret)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/cover.html';
  url.search = '';
  const response = NextResponse.redirect(url, 307);
  if (token) response.cookies.delete(COOKIE_NAME);
  return response;
}

export const config = {
  matcher: ['/', '/index.html']
};
