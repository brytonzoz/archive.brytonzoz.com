# Shipped held-out 15 (fresh, never tuned)

CI runs the free pipeline (no xAI) over cached fetches in `tests/fixtures/shipped-heldout/builders.json`.

None of these queries appear in `docs/shipped-eval-builders.md`, the original held-out 10, or identity tables. Excluded on purpose: steventey, ajlkn, shadcn, leerob, swyx, mckaywrigley, pontusab, rauchg, plus the live QA names nico_jeannen / jarredsumner / dannypostmaa.

| # | Query | Space |
| ---: | --- | --- |
| 1 | `yyx990803` | company / OSS (Vue, VoidZero) |
| 2 | `Rich-Harris` | OSS (Svelte) |
| 3 | `dhh` | company (37signals) |
| 4 | `spolu` | company (Dust) |
| 5 | `developit` | OSS (Preact) |
| 6 | `pi0` | OSS (UnJS) |
| 7 | `mxstbr` | indie / OSS |
| 8 | `threepointone` | OSS |
| 9 | `mattpocock` | indie |
| 10 | `TkDodo` | OSS |
| 11 | `joshwcomeau` | indie |
| 12 | `brianlovin` | indie |
| 13 | `gaearon` | OSS |
| 14 | `wesbos` | indie |
| 15 | `pomber` | OSS |

Pass bar (every receipt): zero third-party products, zero cut titles, zero junk-fixture hits, a non-fallback note, and ≥3 real items when `knownLaunches` is true.

Major OSS maintainers must get ≥10 lines from the GitHub OSS harvest (owned repos + founder/top-3 org repos → 2026 releases/tags, blog RSS, new ≥100-star repos). Evan You and Jarred Sumner must get ≥15. CI uses cached GitHub-shaped releases in `tests/fixtures/shipped-heldout/oss.json`; live prints hit the GitHub API with `SHIPPED_GITHUB_TOKEN`. Held-out notes in CI use the sentence fallback (no Claude); live prints call the cashier writer.
