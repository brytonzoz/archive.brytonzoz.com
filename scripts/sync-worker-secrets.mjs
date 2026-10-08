// Copies the repository secrets Shipped needs into a Worker with one `wrangler secret bulk`, from the deploy
// workflows. Empty secrets are skipped (a value set on the Worker earlier stays). Values are never printed:
// the log lists names only. Turnstile: TURNSTILE_SITE_KEY (public; the Worker hands it to the page) and
// TURNSTILE_SECRET_KEY (server-only, used for siteverify) come from Bryton's widget; without them printing
// and checkout rely on the rate limits and the daily spend cap.
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
