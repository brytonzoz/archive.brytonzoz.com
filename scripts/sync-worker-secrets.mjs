// Copies the repository secrets Shipped needs into a Worker with one `wrangler secret bulk`, from the deploy
// workflows. Empty secrets are skipped (a value set on the Worker earlier stays). Values are never printed:
// the log lists names only. Turnstile: when the repo has no TURNSTILE_* secrets, the widget is created (or
// reused) through the Cloudflare API with CLOUDFLARE_API_TOKEN; without Turnstile permission it's skipped
// and printing relies on the rate limits and the daily spend cap.
//
//   node scripts/sync-worker-secrets.mjs staging|production
import { execFileSync } from 'node:child_process';

const target = process.argv[2];
if (target !== 'staging' && target !== 'production') {
  console.error('usage: sync-worker-secrets.mjs staging|production');
  process.exit(1);
}
const env = process.env;
const pick = (...names) => names.map((name) => env[name]).find((value) => typeof value === 'string' && value.trim() !== '');

// Worker secret name <- repository secret name(s), first non-empty wins.
const secrets = {
  ANTHROPIC_API_KEY: pick('CLAUDE_KEY', 'ANTHROPIC_API_KEY'),
  ANTHROPIC_WORKSPACE_ID: pick('CLAUDE_WORKSPACE', 'ANTHROPIC_WORKSPACE_ID'),
  TINYFISH_API_KEY: pick('TINYFISH', 'TINYFISH_API_KEY'),
  GITHUB_TOKEN: pick('SHIPPED_GITHUB_TOKEN'),
  PRODUCTHUNT_KEY: pick('PRODUCTHUNT_KEY'),
  PRODUCTHUNT_SECRET: pick('PRODUCTHUNT_SECRET'),
  PRODUCTHUNT_TOKEN: pick('PRODUCTHUNT_TOKEN'),
  BRANDFETCH_API: pick('BRANDFETCH_API', 'BRANDFETCH_KEY'),
  STRIPE_SHIPPED_WEBHOOK_SECRET:
    target === 'staging' ? pick('STRIPE_TEST_SHIPPED_WEBHOOK_SECRET', 'STRIPE_SHIPPED_WEBHOOK_SECRET') : pick('STRIPE_SHIPPED_WEBHOOK_SECRET'),
  TURNSTILE_SITE_KEY: pick('TURNSTILE_SITE_KEY'),
  TURNSTILE_SECRET_KEY: pick('TURNSTILE_SECRET_KEY'),
};

const WHY_SKIPPED = {
  ANTHROPIC_API_KEY: target === 'staging' ? 'receipts print as a demo (free sources only)' : 'printing stays offline',
  ANTHROPIC_WORKSPACE_ID: 'the Worker uses ANTHROPIC_WORKSPACE_DEFAULT from wrangler.jsonc',
  TINYFISH_API_KEY: 'receipts skip TinyFish',
  GITHUB_TOKEN: "GitHub is read anonymously and from its public pages",
  PRODUCTHUNT_KEY: 'receipts skip Product Hunt',
  PRODUCTHUNT_SECRET: 'receipts skip Product Hunt',
  PRODUCTHUNT_TOKEN: 'Product Hunt uses PRODUCTHUNT_KEY + PRODUCTHUNT_SECRET',
  BRANDFETCH_API: "logos come from each site's own icon or favicon",
  STRIPE_SHIPPED_WEBHOOK_SECRET: "payments are confirmed on return; refunds made in Stripe's dashboard aren't seen",
  TURNSTILE_SITE_KEY: target === 'staging' ? 'staging uses the Turnstile test keys' : 'printing relies on rate limits and the spend cap',
  TURNSTILE_SECRET_KEY: target === 'staging' ? 'staging uses the Turnstile test keys' : 'printing relies on rate limits and the spend cap',
};

const ACCOUNT = '480a4eebfef4c5ba2d0e225fde891ae8';
const WIDGET_NAME = 'shipped';
const WIDGET_DOMAINS = ['brytonzoz.com', 'shipped.brytonzoz.com', 'shipped-staging.brytonzoz.com', 'archive-staging.bryton-p-zoz.workers.dev'];

async function cloudflare(method, route, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/${route}`, {
    method,
    headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const message = (data.errors ?? []).map((error) => `${error.code}: ${error.message}`).join('; ') || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data.result;
}

/** The "shipped" Turnstile widget's keys: reused if it exists (its hostnames topped up), created if not. */
async function turnstileKeys() {
  const widgets = await cloudflare('GET', 'challenges/widgets?per_page=100');
  let widget = (widgets ?? []).find((item) => item.name === WIDGET_NAME);
  if (widget) {
    const missing = WIDGET_DOMAINS.filter((domain) => !(widget.domains ?? []).includes(domain));
    if (missing.length) {
      widget = await cloudflare('PUT', `challenges/widgets/${widget.sitekey}`, {
        name: WIDGET_NAME,
        mode: widget.mode ?? 'managed',
        domains: [...new Set([...(widget.domains ?? []), ...WIDGET_DOMAINS])],
      });
    }
    if (!widget.secret) widget = await cloudflare('GET', `challenges/widgets/${widget.sitekey}`);
    console.log(`Turnstile: reusing widget "${WIDGET_NAME}"${missing.length ? ` (added ${missing.join(', ')})` : ''}.`);
  } else {
    widget = await cloudflare('POST', 'challenges/widgets', { name: WIDGET_NAME, mode: 'managed', domains: WIDGET_DOMAINS });
    console.log(`Turnstile: created widget "${WIDGET_NAME}" for ${WIDGET_DOMAINS.join(', ')}.`);
  }
  if (!widget?.sitekey || !widget?.secret) throw new Error('the API returned no keys');
  return { site: widget.sitekey, secret: widget.secret };
}

if (!secrets.TURNSTILE_SITE_KEY || !secrets.TURNSTILE_SECRET_KEY) {
  if (!env.CLOUDFLARE_API_TOKEN) {
    console.log('::notice::Turnstile: no CLOUDFLARE_API_TOKEN, skipped.');
  } else {
    try {
      const keys = await turnstileKeys();
      console.log(`::add-mask::${keys.secret}`);
      secrets.TURNSTILE_SITE_KEY = keys.site;
      secrets.TURNSTILE_SECRET_KEY = keys.secret;
    } catch (error) {
      console.log(`::notice::Turnstile widget not set up (${error.message}). The API token likely lacks "Account: Turnstile: Edit"; printing relies on rate limits and the spend cap.`);
    }
  }
}

const set = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
for (const name of Object.keys(secrets).filter((name) => !set[name])) console.log(`::notice::${name} not set, so ${WHY_SKIPPED[name]}.`);

if (!Object.keys(set).length) {
  console.log('No Shipped secrets to set.');
  process.exit(0);
}

// Piped on stdin, so the values never touch the disk or the command line.
execFileSync('npx', ['wrangler', 'secret', 'bulk', target === 'staging' ? '--env=staging' : '--env='], {
  input: JSON.stringify(set),
  stdio: ['pipe', 'ignore', 'inherit'],
});
console.log(`Set on the ${target} Worker: ${Object.keys(set).sort().join(', ')}`);
