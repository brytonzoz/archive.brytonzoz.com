import './resolve-ts.mjs';
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

const { checkFetchUrl, safeFetch, finalUrl, imageSize, FetchBlocked } = await import('../worker/shipped-fetch.ts');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('SSRF: only public http(s) hosts on default ports, no IPs in any spelling, no metadata or local names', () => {
  for (const ok of ['https://acme.dev/', 'http://acme.dev/about', 'https://www.acme.dev:443/x']) assert.equal(checkFetchUrl(ok).ok, true, ok);
  const blocked = {
    'file:///etc/passwd': 'scheme',
    'gopher://acme.dev/': 'scheme',
    'ftp://acme.dev/': 'scheme',
    'data:text/plain,hi': 'scheme',
    'javascript:alert(1)': 'scheme',
    'not a url': 'scheme',
    'https://user:pw@acme.dev/': 'credentials',
    'https://acme.dev:8080/': 'port',
    'http://127.0.0.1/': 'ip',
    'http://10.0.0.1/': 'ip',
    'http://169.254.169.254/latest/meta-data/': 'ip',
    'http://[::1]/': 'ip',
    'http://[fd00::1]/': 'ip',
    'http://[::ffff:127.0.0.1]/': 'ip',
    'http://2130706433/': 'ip',
    'http://0x7f000001/': 'ip',
    'http://0177.0.0.1/': 'ip',
    'http://localhost/': 'host',
    'http://metadata.google.internal/': 'host',
    'http://metadata/': 'host',
    'http://printer.local/': 'host',
    'http://intranet/': 'host',
    'http://127.0.0.1.nip.io/': 'host',
    'http://10-0-0-1.sslip.io/': 'host',
    'http://app.localtest.me/': 'host',
  };
  for (const [url, problem] of Object.entries(blocked)) assert.deepEqual(checkFetchUrl(url), { ok: false, problem }, url);
});

const redirectTo = (location) => new Response(null, { status: 302, headers: { location } });

test('SSRF: every redirect hop is checked again, and there are at most 3', async () => {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push(url);
    assert.equal(init.redirect, 'manual', 'redirects are never followed automatically');
    return redirectTo('http://169.254.169.254/latest/meta-data/');
  };
  await assert.rejects(safeFetch('https://acme.dev/'), (error) => error instanceof FetchBlocked && error.problem === 'ip');
  assert.deepEqual(asked, ['https://acme.dev/'], 'the metadata address is never requested');

  let hops = 0;
  globalThis.fetch = async () => redirectTo(`https://acme.dev/${++hops}`);
  await assert.rejects(safeFetch('https://acme.dev/'), (error) => error.problem === 'redirect');
  assert.equal(hops, 4);

  globalThis.fetch = async () => redirectTo('https://localhost/');
  await assert.rejects(finalUrl('https://acme.dev/'), (error) => error.problem === 'host');
});

test('SSRF: bodies are capped, types are checked, slow hosts time out', async () => {
  globalThis.fetch = async () => new Response('x'.repeat(5000), { headers: { 'content-type': 'image/png' } });
  await assert.rejects(safeFetch('https://acme.dev/logo.png', { maxBytes: 1000 }), (error) => error.problem === 'too-big');
  globalThis.fetch = async () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '99999999' } });
  await assert.rejects(safeFetch('https://acme.dev/logo.png', { maxBytes: 1000 }), (error) => error.problem === 'too-big');
  globalThis.fetch = async () => new Response('<svg onload=alert(1)>', { headers: { 'content-type': 'image/svg+xml' } });
  await assert.rejects(safeFetch('https://acme.dev/logo.svg', { types: ['image/png', 'image/jpeg'] }), (error) => error.problem === 'type');
  globalThis.fetch = (url, init) =>
    new Promise((_, reject) => {
      // AbortSignal.timeout's timer is unref'd in Node; this keeps the test process alive until it fires.
      const alive = setTimeout(() => {}, 5000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(alive);
        reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      });
    });
  await assert.rejects(safeFetch('https://acme.dev/', { timeoutMs: 50 }), (error) => error.problem === 'timeout');
  globalThis.fetch = async () => new Response('ok', { headers: { 'content-type': 'text/html' } });
  const page = await safeFetch('https://acme.dev/', { types: ['text/html'] });
  assert.equal(new TextDecoder().decode(page.bytes), 'ok');
});

test('image headers are read before decoding (decompression bombs are refused by size)', () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(png.buffer).setUint32(16, 50_000);
  new DataView(png.buffer).setUint32(20, 50_000);
  assert.deepEqual(imageSize(png), { width: 50_000, height: 50_000, type: 'png' });
  assert.equal(imageSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null, 'SVG is never an image here');
  assert.equal(imageSize(new Uint8Array([1, 2, 3])), null);
});
