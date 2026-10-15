# Shipped 2026 research pipeline — diagnosis

Date: 2026-10-09. Branch: `cursor/shipped-research-engine` (off `cursor/shipped-receipt-page-918f`).
Raw before-run snapshot: [`shipped-research-diagnosis.before.json`](./shipped-research-diagnosis.before.json).

This document is the evidence from **step 1** (live lookup + gather on the current code) and the slot for **step 4** (same builders after the research-engine fix).

## How this was run

- **Staging lookup** (`POST https://shipped-staging.brytonzoz.com/api/shipped/lookup`) with a browser UA. Staging generator is **on, not demo**, sources advertised as `github, appstore, hn, npm, producthunt, tinyfish`. Turnstile blocks `/print`, so staging was used for identity resolution only.
- **Local `gather()`** of the same Worker modules (`scripts/diagnose-shipped-research.mjs`). This environment has **no** `GITHUB_TOKEN`, `PRODUCTHUNT_*`, `TINYFISH_API_KEY`, or `ANTHROPIC_API_KEY`. That means the local run is the deterministic half of the pipeline (GitHub pages/API, App Store, HN, npm, `readSite`). TinyFish / Product Hunt / Claude only exist on staging, and they are fed **whatever identity `lookup` resolved**.
- Staging has printed 10 receipts; the public pile is empty (printers did not toss). Cached empty receipts cannot be inspected without admin.

Queries: `levelsio`, `marclou`, `tibo_maker`, `rauchg`, `dannypostmaa`, `tdinh_me`, `steventey`, `shadcn`, `pontusab`, `nutlope`, `arvidkahl`, `yongfook`, and the name-style input `Tibo from OpenAI`.

## Before table (current pipeline)

| Query | Staging identity | Surfaces resolved | Sources that ran | Items in `found` | Demo receipt | Cashier note | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| levelsio | auto GitHub `@levelsio` (3 repos, X linked, site `levels.io`) | GH + X + site | github, appstore, hn, npm, site. PH/tinyfish **off locally** | 2 GH (`superlevels`, `xdr-boost`) | 2 | "No refunds on momentum." | 2.1s |
| marclou | auto GitHub `@marclou` (25 repos, site `marclou.com`) | GH + X + site | same | 3 GH | 3 | "No refunds on momentum." | 2.4s |
| tibo_maker | auto **X only** (no GitHub user) | X handle only. No site, no name | appstore (term `@tibo_maker`), hn author `tibo_maker`. GH/npm/PH skipped | **0** | YOUR POTENTIAL | "Item on back order. Ships when you do." | 2.6s |
| rauchg | auto GitHub `@rauchg` (143 repos). GH blog is `twitter.com/rauchg` so **site dropped** | GH + X. No website (`rauchg.com` is on X, never fetched) | github, appstore, hn, npm | 9 (4 GH + 5 npm) | 9 | canned | 2.7s |
| dannypostmaa | **two** candidates, `auto: false`: GitHub `Dannypostmaa` (**0 repos**, no X, no site) and X `@dannypostmaa` | Wrong GitHub wins if the client auto-picks `[0]` | github empty, others empty | **0** | YOUR POTENTIAL | canned potential | 1.2s |
| tdinh_me | auto **X only** | X handle only | appstore + hn | **0** | YOUR POTENTIAL | canned potential | 1.4s |
| steventey | two candidates: GitHub `StevenTey` (6 repos, **no twitter, no blog**) and X | GH without X/site. Real site is Dub | github + npm-ish | 5 GH | 5 | canned | 1.8s |
| shadcn | auto GitHub `@shadcn` (228 repos, X linked, **no blog**) | GH + X. No site | github, npm, … | 10 | 10 | canned | 2.7s |
| pontusab | auto GitHub `@pontusab` (106 repos, site `midday.ai`) | GH + X + site | github + site | 10 GH | 10 | canned | 4.0s |
| nutlope | auto GitHub `@Nutlope` (107 repos, site `nutlope.com`) | GH + X + site | github + site | 15 GH (demo caps 12) | 12 | "Receipt paper running low. Keep going." | 3.7s |
| arvidkahl | auto GitHub `@arvidkahl` (51 repos, site `thebootstrappedfounder.com`, bio names **Podscan.fm**) | GH + X + site **read** (40 links) | all free APIs | **0** — no 2026 personal repo/release/npm/HN. Site links **never become items** | YOUR POTENTIAL | canned potential | 2.8s |
| yongfook | two candidates: GitHub (36 repos, site Bannerbear, **X not on profile**) and X | GH + site. X dropped unless the visitor picks it | github + npm | 4 | 4 | canned | 4.6s |
| Tibo from OpenAI | auto **name only**. GitHub user search for the whole string returned **[]** | no GH, no X, no site | appstore only (term `Tibo from OpenAI`) | **0** | YOUR POTENTIAL | canned potential | 1.2s |

Local average time: **~2.6s** (no TinyFish, no Claude). Staging print is Turnstile-gated; per-receipt AI cost could not be measured here (no key). Claude is only invoked when `/print` runs, and `SEARCH_BELOW` is **2**, so anyone with ≥2 GitHub toys **never** gets paid web search.

## What each source actually returned

| Source | Enabled when | What happened on this run |
| --- | --- | --- |
| **github** | `profile.github` set | Works when the GitHub login is the one they ship from (rauchg, shadcn, nutlope, pontusab). Misses org work (Vercel, Midday, Dub, Bannerbear app). `arvidkahl`: 51 repos, **none created/released in 2026** → 0. `Dannypostmaa`: empty decoy account. |
| **appstore** | always if a name/handle exists | Search term is `profile.name` or the raw `@handle`. **0 apps for all 13**. `currentVersionReleaseDate` is ignored; only first `releaseDate` in 2026 counts. Handle-only subjects search `"@tibo_maker"`. |
| **hn** | domain, or github/x present | Only `Show HN`/`Launch HN` **authored by the same login**. `levelsio` has no HN account under that name (Algolia `author_levelsio` = []). Domain search only runs for `kind === 'domain'`. |
| **npm** | `profile.github` | Last-publish date in 2026. Helps rauchg / yongfook. Off for X-only people. |
| **producthunt** | token **and** (`x` or `github`) | Staging has a token. Lookup still uses **one** username: `profile.x \|\| profile.github`. X-only `tibo_maker` would be tried; `Tibo from OpenAI` would not (no handle). Public PH pages 403 without the API. |
| **tinyfish** | API key | Staging has it. Locally off, so `web=0`, `pages=0` for everyone. Even when on, search hits go to `gathered.web` / `pages` — **not** `found`. Claude must promote them, then `validateDraft` drops anything without an allowed URL. |
| **site (`readSite`)** | `profile.site` | Ran for levelsio, marclou, pontusab, nutlope, arvidkahl, yongfook. 40 links + 2500 chars of **URL-stripped** text. Those links are prompt context only. **Zero site-derived `Found` items.** |

## Identity resolution (X handle → the rest)

Current rule in `gather()` / `lookup()`:

1. A typed handle is a GitHub user if `github.com/<handle>` exists.
2. An X candidate is added only when that GitHub profile does **not** list this handle as `twitter_username`.
3. X → GitHub only if **the same string** is a GitHub login **and** that profile lists this X handle.
4. Name queries: `search/users?q="<literal> in:name"` (max 3) plus a generic `kind: name` fallback.
5. **X bio/links are never fetched.**

Live mismatches:

| Typed | What we needed | What we got |
| --- | --- | --- |
| `tibo_maker` | X bio: Tibo; site `tmaker.io`; products `revid.ai`, `outrank.so`, `squad.so`, `superx.so`, `postsyncer.com`, `bazzly.ai`, `feather.so` (fxtwitter, 2026-10-09) | X handle, nothing else. GitHub `tibo_maker` 404. |
| `tdinh_me` | GitHub `tony-dinh` (Tony Dinh, 13 repos). Search `"Tony Dinh"` finds him | X handle only. `tdinh_me` is not a GitHub login. |
| `dannypostmaa` | GitHub `dannypostma` (Danny Postma, twitter `dannypostma`, site headshotpro.com, 18 repos) | GitHub **`Dannypostmaa` (0 repos)** preferred. The extra "a" is a decoy. |
| `steventey` | GitHub `steven-tey` **and** `StevenTey`; X bio website `steven.link/dub` | `StevenTey` (6 repos, no blog, no twitter field). Visitor must pick X separately. |
| `yongfook` | X + Bannerbear | GitHub without X (profile has no twitter). PH maker `@yongfook` never attached. |
| `rauchg` / `shadcn` | personal sites `rauchg.com`, ui.shadcn.com | GitHub `blog` empty or a twitter URL (rejected by `siteFromProfile`). X website unused. |
| `Tibo from OpenAI` | parse name + company; find `tibo_maker` and/or `tibo-openai` | User search for the **whole string** = `[]`. Only `kind: name`. |
| `levelsio` | X bio lists PhotoAI, VibeJam, InfiniteSlop, InteriorAI, Nomads, `readMAKE.com`, `levels.vc` | GitHub + `levels.io` only. Bio URLs never parsed. 2 toy repos print; the businesses do not. |

Unauthenticated X: `cdn.syndication.twimg.com` returns empty 200. `api.fxtwitter.com/<handle>` returns name, bio, and `website` for levelsio, marclou, tibo_maker, rauchg, steventey, arvidkahl (others 404 / rate-limit). TinyFish could fetch `x.com/<handle>` on staging; today it is never asked to.

## What got dropped, and why

1. **Identity never expanded** → github/npm/PH/site disabled. `tibo_maker`, `tdinh_me`, `Tibo from OpenAI`, and the decoy `Dannypostmaa` path.
2. **2026 date gate on GitHub** → only repos *created* this year or *released* this year. Older products still shipping (Podscan, Shipfast, HeadshotPro, Bannerbear the product) are dropped. Missing dates are OK on GitHub only when search/feed marks `thisYear`.
3. **App Store first-release date** → an app first shipped before 2026 and updated this year is dropped (`releaseDate`, not `currentVersionReleaseDate`).
4. **HN author-only** → no posts unless the HN login equals github/x. No domain search for handle subjects.
5. **Site / TinyFish / X bio never become `Found`** → Claude is the only path from a homepage to a line item. `clean()` **strips URLs from page text**. `inYearCount >= 2` turns **off** Claude `web_search` (`SEARCH_BELOW = 2`, `max_uses` capped at 2 in `maxSearches()`). levelsio (2 GH toys) and marclou (3) therefore get **no** paid gap-fill, and locally no TinyFish either.
6. **`validateDraft`** → every printed line needs a URL the sources already returned. Claude cannot invent PhotoAI.com unless TinyFish or `readSite` put that URL in `allowed`. Site links *are* allowed when `readSite` ran — but only if Claude emits them **and** the date is not a non-2026 year. Conservative prompt: "Fewer real items beat guesses."
7. **Dedupe** on `loose(name)` can collapse a repo and its npm package (intended) but also a product and a similarly named post.
8. **7-day receipt cache** (`CACHE_DAYS = 7` in `worker/shipped.ts`) stores the first print, including **YOUR POTENTIAL**. A failed identity is free to reprint emptiness for a week. There is **no** 24h gather cache keyed on a normalized identity.
9. **Caps** → GitHub search 20 names; npm 5; App Store 8; TinyFish fetch 5 URLs; demo receipt 12; AI items 20.

## Commentary (why notes are generic)

`demoReceipt` and any AI note that trips `AI_VOICE` or `MOCKING` is replaced by:

- "Thank you for shipping. Come again."
- "No refunds on momentum."
- "Keep the receipt. You will want it in December."
- "Your build streak qualifies for free shipping."
- or, if empty: "Nothing on the shelf yet…" / "Item on back order…" / "The register is open…"

The system prompt **forbids** jokes at the person's expense and asks for a "neutral" list. The cashier is *allowed* to be dry and specific, but:

- the fallback is canned and **does not mention any item**;
- there are **no stat lines** (`7 launches · 3 on Product Hunt · 1 App Store app`);
- `MOCKING` is a word-list that is correct for slurs and "loser/scam", and is not the reason notes are empty — **lack of items + canned fallback** is.

On staging, Claude runs, but with 0–2 sourced items and no X/site expansion it has nothing concrete to mention, so notes stay generic or get replaced.

## Cost (current)

- Model: `claude-haiku-5-5` at $0.10 / $0.50 per MTok; web search $10 / 1k (`SEARCH_MICROS = 10_000`).
- Cycle cap: **$180 + 80% of settled sales**, fail closed (`lib/shipped-budget.ts`). Intact; do not loosen.
- `worstCaseMicros` reserves a full 3-turn, 4096-token, **2-search** call before print. Raising search to 3 must stay well under ~$0.05 typical.
- This diagnosis run: **$0.00** AI (no key). Staging costs were not attributed per handle (print blocked).

## Root causes to fix (confirmed)

1. **Identity is a single-string guess**, not an expansion across X → bio URLs → GitHub (possibly different login) → PH / npm / App Store / company site.
2. **Web evidence is prompt-only.** Homepages, `/now`, `/projects`, changelogs, and X bio products are not lifted into `Found` with a date confidence.
3. **Dating is a hard drop** on several sources; undated-but-attributed work should keep with `unknown` / `inferred` confidence.
4. **Claude search is almost never on** (`< 2` items) and capped at 2 uses. Spec: gap-fill when `< 4` items, `max_uses` 3.
5. **Empty results are cached for 7 days**; there is no 24h identity/gather cache.
6. **Cashier note + one-liners are canned** unless Claude gets a rich `found` list.

## After table (original 13, item counts)

Local deterministic harvest after the multi-pass redesign. AI cost is $0 here (no key). Staging print still adds Haiku + up to 3 searches when gaps remain.

| Query | Items before | Items after | Sources hit after | Sample cashier note | Cost | Time |
| --- | --- | --- | --- | --- | --- | --- |
| levelsio | 2 | 20 printed / 26 found | github, site, X bio, /projects | SuperLevels 553 stars · github.com/levelsio/superlevels | $0 local | 1.4s |
| marclou | 3 | 20 / 30 | github, site, TrustMRR | TrustMRR + DataFast + McCreep | $0 local | 1.3s |
| tibo_maker | 0 | 20 / 30 | tmaker.io site hint | SuperX, Revid, Outrank, Squad… | $0 local | 1.3s |
| rauchg | 9 | 9 | github, npm | npm + GH 2026 | $0 local | ~5s |
| dannypostmaa | 0 | 3 | github @dannypostma | AgentBar 28 stars · HeadshotPro | $0 local | 1.4s |
| tdinh_me | 0 | 7 | alias tony-dinh | GH 2026 | $0 local | ~6s |
| steventey | 5 | 13 | site hint steventey.com + npm | Dub, Novel, ShareGPT, One Word Domains | $0 local | 1.8s |
| shadcn | 10 | 16 | github, npm, ui.shadcn.com | improve 9.2k stars · GitHub registries | $0 local | 1.2s |
| pontusab | 10 | 12 | github | Workbench 450 stars · Caltext · Hyper | $0 local | 1.5s |
| nutlope | 15 / 12 | 21 | github | Hallmark 29.8k stars · Inspo 874 | $0 local | 2.1s |
| arvidkahl | 0 | 12 | site + bio | Podscan $5k/mo · podscan.fm | $0 local | 3.1s |
| yongfook | 4 | 5 | github, npm | Bannerbear | $0 local | ~2.6s |
| Tibo from OpenAI | 0 | (company login `tibo-openai`) | name parse | identity pass | $0 local | — |
| **Average cost** | $0 (no AI locally) | $0 local / ~$0.03–$0.04 with Haiku+3 searches | | | **$0.05 cap** | |

## Completeness (10-builder ground truth)

Hand-built 2026 ships: [`docs/shipped-ground-truth.json`](./shipped-ground-truth.json). Runner: `scripts/eval-shipped-recall.mjs`. Latest: [`docs/shipped-recall.json`](./shipped-recall.json).

A must-find is a named public product/repo/app with 2026 evidence from the person's site, GitHub, PH, App Store, npm, or a dated post. 0-star personal toys that only the GitHub API dates as 2026 are `must: false` (anonymous HTML often misses created-year).

| Query | Must-find | Recall | Sourced stats (found / public) | Example sourced stat |
| --- | ---: | ---: | ---: | --- |
| levelsio | 7 / 8 | 88% | 4 / 4 | SuperLevels stars + $86k/mo from X bio |
| marclou | 7 / 7 | 100% | 2 / 2 | TrustMRR list + repos |
| tibo_maker | 7 / 7 | 100% | 0 / 1 PH SuperX — needs Product Hunt token | $1M/mo · tmaker.io (X bio + site, no alias table) |
| shadcn | 4 / 5 | 80% | 2 / 2 | improve 9.2k stars |
| steventey | 1 / 4 | **25%** | 1 / 1 npm | Dub only. Novel / ShareGPT / One Word Domains lived on a `steventey.com` site hint — that table is gone |
| pontusab | 8 / 8 | 100% | 2 / 2 | Workbench 450 stars |
| arvidkahl | 2 / 2 must | 100% must | 1 / 1 | $5k/mo · podscan.fm |
| nutlope | 6 / 8 | 75% | 1 / 3 | Hallmark still prints; two older toys dropped without a hint |
| simonw | 5 / 6 | 83% | 1 / 1 | 992 public repos |
| dannypostmaa | 2 / 2 | 100% | 2 / 2 | AgentBar 28 stars (`dannypostmaa` → `dannypostma` via doubled-letter variant, not a table) |

**Median must-find recall on the original set: 87.5%.** The earlier 100% was overfit to `HANDLE_ALIASES` / `PRODUCT_OWNERS` / `SITE_HINTS`. Those tables are gone (`IDENTITY_COLLISIONS` is `{}`).

## Held-out completeness (the bar that matters)

20 builders not in `docs/shipped-eval-builders.md` and not in any identity table: [`docs/shipped-heldout-builders.md`](./shipped-heldout-builders.md). Ground truth for 10 of them: [`docs/shipped-heldout-ground-truth.json`](./shipped-heldout-ground-truth.json). Raw: [`docs/shipped-heldout-recall.json`](./shipped-heldout-recall.json).

`mckaywrigley` was on the first draft of the 20 and was swapped for `keijiro`: Chatbot UI last moved in 2024, so it is not a 2026 ship.

| Query | Recall | Sourced stats | Note (demoReceipt) | Cost | Time |
| --- | ---: | ---: | --- | ---: | ---: |
| kitze | 80% (4/5, missed Sizzy) | 1 / 3 (unclutter/skillbox stars crowded by other GH stars) | names a GitHub/npm line | $0 | 4.1s |
| rameerez | 100% | 1 / 1 | MAPPO + allgood 272 stars | $0 | 2.9s |
| steipete | 75% (3/4, missed accesskit.dev under npm flood) | 1 / 1 repos | names an npm/OpenClaw line | $0 | 5.5s |
| insidegui | 100% | 1 / 2 | names GitHub utilities | $0 | 2.5s |
| fofrAI | 100% | 1 / 1 nano-banana 26 stars | resolved **fofr** (X miss + 0-repo `fofrai` decoy; token `fofr` + twitter cross-check) | $0 | 3.5s |
| dabit3 | 100% | 2 / 2 | jev-experiments 401 stars | $0 | 4.4s |
| joshpuckett | 100% | 2 / 2 | dialkit 1.2k stars | $0 | 2.4s |
| yacineMTB | 100% | 1 / 1 dingcad 507 stars | dingcad on the tape | $0 | 2.9s |
| johnrushx | 50% (MarsX yes; x-algorithm drowned by marsx.dev chrome) | 1 / 1 TrustMRR $39k/mo | names a MarsX/site line | $0 | 1.4s |
| keijiro | 100% | 2 / 2 Jacquard 240 stars + 947 repos | AudioTailor through-line | $0 | 3.4s |

**Held-out median must-find recall: 100%** (pass was ≥80%). Average time ~3.3s. Deterministic harvest **$0**; Haiku + 3 searches on staging still ~$0.03–$0.04 of the $0.05 cap.

Identity is general: public Fx/Vx Twitter (browser UA), t.co expand, follow site GitHub links, `fullname:` / `in:name` search, camelCase handle tokens, 0-repo decoy cap. No eval person is in `IDENTITY_COLLISIONS`.

Stats still missing without paid/token surfaces:
- Product Hunt upvotes/ranks — local $0; staging with `PRODUCTHUNT_*` fills SuperX 929 / #1 day.
- Newsletter MRR posts (Marc's Beehiiv $44k July) — TinyFish/Claude gap-fill, ~$0.01/search.
- GitHub contribution totals — parsed from the overview HTML when GitHub serves it; anonymous sometimes 404s.

## Cost tradeoff (not silently cut)

| Wave | What it buys | Typical $ | Inside $0.05? |
| --- | --- | ---: | --- |
| Deterministic harvest (identity, GH, npm, App Store, HN, /projects, TrustMRR, bio MRR) | Most ships + stars/downloads/ratings/HN | $0.00 | yes |
| Haiku assemble, 0 searches | Cashier note from gathered stats | ~$0.002 | yes |
| +3 Claude web searches | PH-less launches, newsletter MRR, /now pages TinyFish missed | +$0.03 | yes (~$0.032–$0.04) |
| +1 extra search wave | Diminishing: one more PH/blog | +$0.01 | **only if $0.01 remains**; else `coverageCapped: true` |

We do **not** skip gap-fill just because four GitHub toys already exist (`SEARCH_BELOW` is 8, and named gaps still trigger search). We skip a search only when the remaining micros cannot pay `SEARCH_MICROS`, and we log that.

## 50-builder eval list

Fixed queries: [`docs/shipped-eval-builders.md`](./shipped-eval-builders.md). Completeness truth is the 10-row subset above (hand-checked). The other 40 are identity + item-count scored the same way; prolific rows are expected to land in 6–15 printed items.
