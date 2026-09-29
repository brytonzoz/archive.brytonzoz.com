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
- Next-release teaser (first homepage scene): `lib/next-release.ts`. Set `title` to reveal the name, `date` for a
  live countdown, `enabled: false` to remove it. The link-preview image `public/og.jpg` is a render of that scene.
- Artwork: originals in `assets-src/{covers,scenes/<scene>,icons}/`; `npm run media` builds
  `public/media/` and `lib/media-manifest.json` (commit the manifest). Never put large images in `public/`.
- Music player: `lib/tracks.json` lists every release and its songs; each plays from `/audio/<file>`, which
  `worker/index.ts` streams from the `brytonzoz-media` R2 bucket. Songs come from the owner's Google Drive folder:
  `music/sources.json` maps Drive files to bucket keys and the **Music sync** workflow uploads them. A release only
  shows in the player once `"available": true`, and `npm run check:tracks` (run in both deploy workflows) fails if
  any song of an available release doesn't play.
  Player code lives in `components/player/`; it is mounted in `app/layout.tsx`, so internal links must use
  `next/link` to keep music playing between pages.
- Release sheet ("Listen Now") and song/album pages: `components/release/`. Every song has a shareable page at
  `/<release>/<song-slug>/` (`app/[release]/[song]/`) with a preview card from `npm run media`
  (`scripts/build-share-images.mjs` -> `lib/share-images.json`, also the home-screen icons).
- Scrapwrk store (`/scrapwrk/`, and the homepage's last scene): products and prices in `lib/store-catalog.json`,
  photos in `assets-src/store/<slug>/NN.jpg` (2400px JPEGs; `npm run media` makes the web sizes). UI in `components/store/`;
  Stripe Checkout, 1-of-1 holds and sold state in `worker/store.ts` (D1 table `store_items`; mark a piece sold/available in
  `/admin`). The Stripe key is the `STRIPE_SECRET_KEY` repository secret (staging uses `STRIPE_TEST_SECRET_KEY`, a test
  key); both deploy workflows copy it to the Worker. Never put it in code or chat.
- NonParallel merch, printed to order by Printify (shop "NONPARALLEL"). The homepage scene after Scrapwrk shows the tees;
  below the last scene the page stops snapping and the whole range is a shop with search, category chips and price sort
  (`components/store/MerchShop.tsx`, also `/nonparallel/`, and `/nonparallel/<slug>/` opens one piece).
  `printify/products.json` has `designs` (the artwork) and `lines` (one blank each: tee, hoodie, sticker, mug…; by
  `blueprintId` or `find`, colors per design, placements). Every price is Printify's real cost + US shipping + `markup`
  (20%), with Stripe's fee on top, rounded up to a tidy price ending in 5 or 9. `printify/catalog.md` lists blanks by category. Pushing products.json runs the **Printify**
  workflow, which creates/updates every product and commits their mockups (`assets-src/merch/`) and
  `lib/merch-catalog.json`; its log prints the per-sale margin and any line it skipped. Then run `npm run media`. Its commit comes from the
  GitHub Actions bot, which doesn't redeploy staging on its own: pull it and push your next change to update staging.
  Extra studio shots (Higgsfield, floating / dress form / flat lay, never people) go in
  `assets-src/merch-studio/<slug>/<color>-N.jpg` (`-front` in the name for a front view) and show after Printify's mockups.
  The site only ever shows photographic mockups: `printify/mockups.json` hides flat 2D drawings, models and blank frames,
  and lists lines that show studio shots only (every color of those needs studio shots). Check new products' mockups.
  **Must fix (open): the NonParallel design files have white holes.** The counters inside the letters (the inside of the
  O, the P, etc.) are filled white instead of transparent, so every printed product and every mockup and studio shot shows
  white blobs inside the lettering (obvious on the candle, black tees, dark hoodies). Fix: re-export each design in
  `printify/products.json` `designs` with transparent counters (or knock out the enclosed white areas), upload the new files,
  push products.json so the Printify workflow re-renders every product, then regenerate the studio shots in
  `assets-src/merch-studio/` from the new mockups. Deferred only because regenerating the studio shots costs Higgsfield credits.
  Everything sells through the same bag and Stripe checkout as Scrapwrk (`components/store/Merch*.tsx`, `Bag.tsx`);
  `worker/merch.ts` sends each paid order to Printify (created, then sent to production once Printify has priced it;
  on the thank-you page, plus a 10-minute cron catch-up), tracked in D1 `merch_orders` and shown in `/admin`. One-off
  orders (samples) go in D1 `manual_orders` (the cron places them, capped at `max_cents`); confirm the price with the
  owner first. Token: the `PRINTIFY_ACCESS` repository secret (production only, so staging checkouts never print).
  Never put it in code or chat. The scene's background tees are Bryton's own mockups from the "NP merch" Drive folder,
  cut out in `assets-src/scenes/nonparallel/` (kept faint: `alpha` in `nonparallelStickers`, app/page.tsx).
- Metrics: `lib/analytics.ts` (anonymous, batched) -> `/api/e` in `worker/metrics.ts` -> D1 `brytonzoz-metrics`
  (`brytonzoz-metrics-staging` for staging; schema `worker/schema.sql`). The dashboard is `/admin`; its password is
  the `ADMIN_PASSWORD` repository secret, which both deploy workflows copy to the Worker. Never put it in code or chat.
- Hosting: `wrangler.jsonc` (production + `staging` env), `workers/redirects/` (www/archive → apex),
  `public/_headers` (cache rules). Firebase files are legacy.
