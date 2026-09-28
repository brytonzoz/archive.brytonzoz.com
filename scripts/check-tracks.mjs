// Confirms every song of every release marked "available" in lib/tracks.json is really in R2
// (HTTP 200, audio content type) so the player never ships a broken track.
// Usage: CHECK_ORIGIN=https://… node scripts/check-tracks.mjs [--all]
//   CHECK_ORIGIN: site that serves /audio (default https://brytonzoz.com); --all also reports releases not yet available
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'lib', 'tracks.json'), 'utf8'));
const checkAll = process.argv.includes('--all');
const origin = process.env.CHECK_ORIGIN ?? 'https://brytonzoz.com';
const urlFor = (file) => new URL(`${catalog.baseUrl}/${file}`, origin).href;

async function probe(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      return {
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        size: Number(response.headers.get('content-length') ?? 0),
      };
    } catch (error) {
      if (attempt === 3) return { status: 0, type: '', size: 0, error: error.message };
    }
  }
}

let failures = 0;
for (const release of catalog.releases) {
  if (!release.available && !checkAll) continue;
  console.log(`\n${release.title}${release.available ? '' : ' (not live yet)'}`);
  if (release.tracks.length === 0) {
    console.log('  no tracks listed');
    if (release.available) failures++;
    continue;
  }
  const results = await Promise.all(release.tracks.map(async (track) => ({ track, ...(await probe(urlFor(track.file))) })));
  for (const { track, status, type, size, error } of results) {
    const ok = status === 200 && type.startsWith('audio/');
    if (!ok && release.available) failures++;
    const detail = ok ? `${(size / 1048576).toFixed(1)} MB` : (error ?? `HTTP ${status}${type ? `, ${type}` : ''}`);
    console.log(`  ${ok ? 'ok     ' : 'MISSING'} ${track.file}  (${detail})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} problem(s): upload or rename the files above, or set "available": false in lib/tracks.json.`);
  process.exit(1);
}
console.log('\nAll available releases are playable.');
