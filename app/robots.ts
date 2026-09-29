import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/artist';

// brytonzoz.com/robots.txt: everything may be crawled (the dashboard opts out with its own noindex tag).
// Search and AI assistants are welcomed by name, so answers about Bryton Zoz come from this site.
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
