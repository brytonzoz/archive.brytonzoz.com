import { ARTIST, ARTIST_PROFILES, CLOTHING_LINE, LABEL, LISTEN_LINKS, SITE_URL } from '../../lib/artist';
import { products, productPath } from '../../lib/store';
import { releasePath, releases, trackPath } from '../../lib/tracks';

// brytonzoz.com/llms.txt: a plain summary for AI assistants and answer engines (ChatGPT, Claude,
// Perplexity, Gemini…), built from the same facts as the site. See https://llmstxt.org.
export const dynamic = 'force-static';

export function GET() {
  const lines = [
    `# ${ARTIST.name}`,
    '',
    `> ${ARTIST.description}`,
    '',
    ...ARTIST.bio.flatMap((paragraph, i) => (i ? ['', paragraph] : [paragraph])),
    '',
    `- Based in: ${ARTIST.city}, ${ARTIST.region}, United States`,
    `- Work: music (writing and production), fashion (${CLOTHING_LINE.name}), design, and the ${LABEL.name} label`,
    `- Contact and bookings: ${SITE_URL}/work/`,
    '',
    '## Music',
    '',
    ...releases.flatMap((release) => [
      `- [${release.title}](${SITE_URL}${releasePath(release)}): ${release.tracks.length} songs by ${ARTIST.name}`,
      ...release.tracks.map((track) => `  - [${track.title}](${SITE_URL}${trackPath(track)})`),
    ]),
    '',
    'Streaming:',
    ...LISTEN_LINKS.map((link) => `- [${link.name}](${link.url})`),
    '',
    '## Fashion and label',
    '',
    `- [${CLOTHING_LINE.name}](${CLOTHING_LINE.url}): ${CLOTHING_LINE.description}`,
    ...products.map((product) => `  - [${product.name}](${SITE_URL}${productPath(product)})`),
    `- [${LABEL.name}](${LABEL.url}): ${LABEL.description}`,
    '',
    '## About',
    '',
    `- [About ${ARTIST.name}](${SITE_URL}/about/)`,
    `- [Music](${SITE_URL}/music/)`,
    `- [Fashion](${SITE_URL}/fashion/)`,
    '',
    '## Profiles',
    '',
    ...ARTIST_PROFILES.map((url) => `- ${url}`),
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
