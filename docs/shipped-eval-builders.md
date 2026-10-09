# Shipped 2026 eval builders

Fixed list of **50** lookup queries. Used for both the before snapshot and every after run of the research engine. Do not silently drop a row — if a handle does not resolve, swap it here and note the replacement.

Scoring (per receipt):

- **Items** — count of `Found` rows that survive `inYear` / dating (demo receipt length, cap 15).
- **Sourced %** — share of those items with a real `url` (not invented).
- **Note** — cashier-note specificity 1–5 (`1` canned / empty, `3` names one real item or a stat, `5` names a real item *and* a grounded stat).
- **Prolific** people must land in **6–15** real items. Sparse public shippers (lab CEOs, video-first creators) may score lower; they are marked `prolific: no`.

## Queries

| # | Query | Category | Prolific | Expected identity |
| ---: | --- | --- | --- | --- |
| 1 | `levelsio` | indie | yes | Pieter Levels · GH `@levelsio` · levels.io |
| 2 | `marclou` | indie | yes | Marc Lou · GH `@marclou` · marclou.com |
| 3 | `tdinh_me` | indie | yes | Tony Dinh · GH `@tony-dinh` · tonyis.online |
| 4 | `dannypostmaa` | indie | yes | Danny Postma · GH `@dannypostma` · dannypostma.com |
| 5 | `arvidkahl` | indie | yes | Arvid Kahl · thebootstrappedfounder.com · Podscan |
| 6 | `yongfook` | indie | yes | Yongfook · Bannerbear |
| 7 | `tibo_maker` | indie | yes | Tibo · GH `@tibo-maker` · tibo.tech |
| 8 | `pontusab` | indie | yes | Pontus Abrahamsson · Midday |
| 9 | `jackfriks` | indie | yes | Jack Friks · indie apps |
| 10 | `dvassallo` | indie | yes | Daniel Vassallo · dvassallo.com |
| 11 | `nico_jeannen` | indie | yes | Nico Jeannen · Undermind / indie |
| 12 | `sama` | ai | no | Sam Altman · OpenAI |
| 13 | `karpathy` | ai | yes | Andrej Karpathy · GH `@karpathy` |
| 14 | `swyx` | ai | yes | Shawn Wang · GH `@swyxio` / `@sw-yx` |
| 15 | `simonw` | ai | yes | Simon Willison · datasette / simonwillison.net |
| 16 | `alexalbert__` | ai | no | Alex Albert · Anthropic |
| 17 | `OfficialLoganK` | ai | no | Logan Kilpatrick · Google / AI |
| 18 | `amasad` | ai | yes | Amjad Masad · Replit |
| 19 | `rauchg` | ai | yes | Guillermo Rauch · Vercel / Next.js |
| 20 | `goodside` | ai | yes | Riley Goodside |
| 21 | `shadcn` | devtools | yes | shadcn · ui.shadcn.com |
| 22 | `steventey` | devtools | yes | Steven Tey · Dub |
| 23 | `nutlope` | devtools | yes | Hassan · nutlope.com |
| 24 | `t3dotgg` | devtools | yes | Theo · T3 / UploadThing |
| 25 | `theo` | devtools | yes | same person as t3dotgg (name-style handle) |
| 26 | `kentcdodds` | devtools | yes | Kent C. Dodds |
| 27 | `sindresorhus` | devtools | yes | Sindre Sorhus |
| 28 | `mitchellh` | devtools | yes | Mitchell Hashimoto · Ghostty / HashiCorp |
| 29 | `jarredsumner` | devtools | yes | Jarred Sumner · Bun |
| 30 | `antfu7` | devtools | yes | Anthony Fu |
| 31 | `leeerob` | devtools | yes | Lee Robinson · Vercel |
| 32 | `tannerlinsley` | devtools | yes | Tanner Linsley · TanStack |
| 33 | `colinhacks` | devtools | yes | Colin McDonnell · Zod |
| 34 | `rauno` | design | yes | Rauno Freiberg · Vercel |
| 35 | `emilkowalski` | design | yes | Emil Kowalski · Sonner / Vaul |
| 36 | `jh3yy` | design | yes | Jhey Tompkins |
| 37 | `pacocoursey` | design | yes | Paco Coursey · cmdk / Geist |
| 38 | `peduarte` | design | yes | Pedro Duarte · Radix |
| 39 | `twostraws` | mobile | yes | Paul Hudson · Hacking with Swift |
| 40 | `nathanborror` | mobile | yes | Nathan Borror |
| 41 | `christianselig` | mobile | yes | Christian Selig · Apollo / Goldbar |
| 42 | `jordibruin` | mobile | yes | Jordi Bruin |
| 43 | `dimillian` | mobile | yes | Thomas Ricouard · Ice Cubes |
| 44 | `ThePrimeagen` | hardware/games/creators | yes | ThePrimeagen · Neovim / courses |
| 45 | `mkbhd` | hardware/games/creators | no | Marques Brownlee |
| 46 | `notch` | hardware/games/creators | no | Markus Persson · Minecraft |
| 47 | `geerlingguy` | hardware/games/creators | yes | Jeff Geerling · Pi / Ansible |
| 48 | `Tibo from OpenAI` | name | yes | Tibo · GH `@tibo-openai` |
| 49 | `the guy who made Photo AI` | name | yes | Pieter Levels via Photo AI |
| 50 | `Marc Lou` | name | yes | same person as marclou |

### Swaps

If a query 404s or lands on a decoy, replace it in this table and record the swap below. Original prompt names that already needed a known GitHub spelling stay as the **query** (what a visitor types); expected identity is the resolved account.

- `theo` is kept even though it is a short first name — the engine must prefer `t3dotgg` over random Theos.
- `Tibo from OpenAI` / `Marc Lou` / `the guy who made Photo AI` are the name-style inputs from the prompt.
- Hardware / games / creators: ThePrimeagen, MKBHD, Notch, plus Jeff Geerling as the levelsio-adjacent hardware maker (Pi, racks, shipping actual kit). Joey Castillo / Unexpected Maker were probed and are sparser on public 2026 software surfaces, so Geerling is the hardware row.

## Scoreboard

Completeness (recall vs hand-built 2026 ships) is the 10-builder table in [`shipped-research-diagnosis.md`](./shipped-research-diagnosis.md) § Completeness. Latest raw: [`shipped-recall.json`](./shipped-recall.json).

| Query | Items | Recall | Sourced stats | Note |
| --- | ---: | ---: | ---: | --- |
| levelsio | 26 | 88% | stars + repos + $86k/mo | missed DroneSim |
| marclou | 30 | 100% | partial MRR | TrustMRR $44k is on a newsletter |
| tibo_maker | 30 | 100% | PH votes need token | SuperX + Revid + Outrank |
| shadcn | 16 | 80% | 2/2 | improve 9.2k stars |
| steventey | 13 | 100% | npm weekly | site hint |
| pontusab | 12 | 100% | 2/2 | Workbench 450 stars |
| arvidkahl | 12 | 100% must | 1/1 | Podscan $5k/mo |
| nutlope | 21 | 100% | 3/3 | Hallmark 29.8k stars |
| simonw | 30 | 83% | repos | prolific GH |
| dannypostmaa | 3 | 100% | 2/2 | AgentBar + HeadshotPro |

Median must-find recall **100%**. The other 40 rows on this list use the same gather path; swap a handle here if identity lands on a decoy.
