import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/artist';

// brytonzoz.com/robots.txt: everything may be crawled. /admin and /shipped opt out with their
// own noindex tags (not Disallow), so crawlers can still read those tags — and X can still
// fetch /shipped for link previews. Search and AI assistants are welcomed by name.
export const dynamic = 'force-static';

const AI_CRAWLERS = [
  'Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot',
  'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'meta-externalagent',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: AI_CRAWLERS, allow: '/', disallow: ['/admin/', '/api/'] },
      { userAgent: '*', allow: '/', disallow: ['/admin/', '/api/'] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
