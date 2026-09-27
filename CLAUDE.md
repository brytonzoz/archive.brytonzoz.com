# brytonzoz.com

Bryton Zoz's music and fashion site: a Next.js static export served by Cloudflare Workers.
Claude acts as the site manager: the owner asks for changes in chat, and Claude ships them
through a pull request. The owner never needs a laptop.

## Release flow (no exceptions)

1. Every change goes through **one pull request into `main`**.
2. Opening or updating the pull request runs `.github/workflows/staging.yml`: lint, build, and deploy to
   the `archive-staging` Worker, then a comment on the PR with the staging link.
3. The owner reviews staging, then merges. `.github/workflows/production.yml` deploys to https://brytonzoz.com.
4. Never deploy to production any other way, and never push directly to `main`.

## One pull request at a time

- Before opening a PR, list the open PRs into `main`. If one exists, **add your commits to that PR's
  branch** (merge `main` into it first if needed) instead of opening a second PR. The owner has
  authorized pushing to that branch for this purpose.
- If several PRs exist (for example from parallel sessions), consolidate them before ending your turn:
  merge the other branches into one PR branch, resolve conflicts, verify, push, then close the others
  with a comment linking the surviving PR.
- The "One open PR" check fails while more than one PR is open.

## How to make changes

Follow `.claude/skills/site-manager/SKILL.md`. In short: `npm ci`, make the change, `npm run lint`,
`npm run build`, check the result in a browser (Playwright + Chromium are available in cloud sessions),
push, and give the owner the staging link from the PR comment once the Staging workflow finishes.

## Where things live

- Projects and links: `lib/projects.ts` (runtime) and `data/projects.yml` (mirror); homepage order and
  hidden projects: `HOMEPAGE_PROJECT_ORDER` / `HIDDEN_HOMEPAGE_PROJECTS` in `app/page.tsx`.
- Artwork: originals in `assets-src/{covers,scenes/<scene>,icons}/`; `npm run media` builds
  `public/media/` and `lib/media-manifest.json` (commit the manifest). Never put large images in `public/`.
- Hosting: `wrangler.jsonc` (production + `staging` env), `workers/redirects/` (www/archive → apex),
  `public/_headers` (cache rules). Firebase files are legacy.
