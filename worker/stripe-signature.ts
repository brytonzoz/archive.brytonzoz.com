// Stripe's webhook signature (the Stripe-Signature header): HMAC-SHA256 of "<t>.<payload>" with the endpoint's
// signing secret, compared in constant time, and refused when the timestamp is over 5 minutes off (replays).
export async function verifySignature(payload: string, header: string, secret: string, now = Date.now()): Promise<boolean> {
  if (!secret || !header) return false;
  const pairs = header.split(',').map((part) => part.trim().split('=') as [string, string]);
  const stamp = pairs.find(([key]) => key === 't')?.[1] ?? '';
  const timestamp = /^\d{1,12}$/.test(stamp) ? Number(stamp) : NaN;
  const candidates = pairs.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value ?? '')).map(([, value]) => value);
  if (!candidates.length || !Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${stamp}.${payload}`)));
  const expected = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return candidates.some((candidate) => {
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
    return diff === 0;
  });
}
