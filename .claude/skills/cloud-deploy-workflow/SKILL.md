---
name: cloud-deploy-workflow
description: Audit a web project and port it, once, to the chat-driven release workflow (single open PR -> automatic Cloudflare staging deploy with a link on the PR -> merge publishes production), so the owner can manage the site entirely from Claude chats with no local machine. Use when setting up a new project this way, or when asked to analyze a project for what it needs to adopt this architecture.
---

# Cloud deploy workflow

Reference implementation: the `brytonzoz.com` repo (PostBalloon org), files `.github/workflows/staging.yml`,
`.github/workflows/production.yml`, `wrangler.jsonc`, `CLAUDE.md`, `.claude/skills/site-manager/`.

## Target architecture

- **Code:** one GitHub repo in the owner's organization; `main` is always what production runs.
- **Hosting:** Cloudflare Workers. Static sites use an assets-only Worker (no script, so requests are
  free and served from the edge cache). Apps with server code use a Worker script, with static assets
  alongside it.
- **Environments:** `staging` (a separate Worker on workers.dev) and production (a custom domain on the apex).
  Secondary hostnames (www, old domains) go to a tiny redirect Worker, not to the main one.
- **Pipeline (GitHub Actions):**
  - Pull request into `main`: a "One open PR" guard, then lint, build, deploy staging, and a sticky PR comment with the staging URL.
  - Push to `main` (a merge): build, deploy production, smoke test.
  - The only secret is `CLOUDFLARE_API_TOKEN`; `account_id` lives in the wrangler config.
- **Process:** Claude opens or extends the single open PR, verifies in the cloud session, hands back
  the staging link; the owner merges to publish. Rules live in the repo's `CLAUDE.md` plus a
  project-specific manager skill.

## Step 1: Audit (report before changing anything)

Answer each question from the code and live infrastructure, and give the owner a short punch list:

1. **Build:** framework, build command, and output directory. Can it be a static export? If not, what needs
   a server (API routes, SSR, auth, forms)?
2. **Assets:** total size and largest files; images served unoptimized; anything loaded from dev-only
   hosts such as `r2.dev`; render-blocking third-party scripts or fonts.
3. **Hosting today:** where DNS lives (check the NS records), what each hostname points at, whether email
   (MX) or other services depend on the zone.
4. **Secrets and env vars** the build or runtime needs, and where they come from.
5. **Repo state:** existing CI, branch protection, open PRs, and whether the repo is in the organization.
6. **Performance baseline:** measure first load on throttled 4G (Playwright + CDP) so improvements can be proven.

## Step 2: Port (one pull request)

1. Make the build produce deployable output (a static export where possible).
2. Add `wrangler.jsonc` with `account_id`, production `routes` (custom domain) and `env.staging`
   (`routes: []`, `workers_dev: true`), plus `public/_headers` making hashed assets immutable.
3. Add a redirect Worker for www and legacy hostnames if needed.
4. Copy and adapt `staging.yml` and `production.yml` (Node version, build command, smoke-test URL).
5. Write `CLAUDE.md` (release flow, one-PR rule, where things live) and a `<project>-manager` skill
   describing how to make common changes in this codebase and verify them.
6. Fix the worst performance problems found in the audit, if the owner wants that in the same port.

## Step 3: Owner setup (walk them through it with exact clicks)

1. Move the repo into the organization: repo **Settings → General → Transfer**. Then make sure the Claude
   GitHub App is installed on the organization with access to the repo.
2. Create a Cloudflare API token from the **Edit Cloudflare Workers** template, scoped to the
   account and the domain's zone. Add it as the GitHub Actions secret `CLOUDFLARE_API_TOKEN` (repo or
   organization level).
3. Move DNS to Cloudflare if it isn't there already, and delete old records for hostnames the Workers will claim.
4. Protect `main`: require a pull request before merging, and require the status checks **One open PR**
   and **Build and deploy to staging**. Turn on **Automatically delete head branches**.
5. Merge the port PR, and confirm the Production run succeeds and the domain serves the new build.

## Step 4: Hand over

Show the owner the loop once, end to end: request a small change in chat, staging link appears on
the PR, they merge, production updates. Then the project's manager skill takes over.
