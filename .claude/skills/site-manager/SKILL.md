---
name: site-manager
description: Ship owner-requested changes to brytonzoz.com (new projects, copy and link edits, artwork, layout experiments) through the single-PR staging-then-production pipeline. Use for any request to change, add to, or test something on the site.
---

# Site manager

The owner describes what they want in chat. You make the change, prove it works, and hand back a
staging link. Merging the pull request is the owner's approval and publishes to https://brytonzoz.com.

## 1. Start from the right branch

```bash
git fetch origin
```

List open pull requests into `main` (GitHub MCP `list_pull_requests`, state `open`, base `main`).

- **None open:** branch from `origin/main` (use the session's designated branch name).
- **One open:** check out that PR's branch, merge `origin/main` into it, and add your work there.
- **More than one open:** consolidate first (section 5), then continue on the surviving branch.

Then run `npm ci`.

## 2. Make the change

| Request | Where |
| --- | --- |
| New project, link, description, release date | `lib/projects.ts`, and mirror it in `data/projects.yml` |
| Show, hide, or reorder on the homepage | `HOMEPAGE_PROJECT_ORDER`, `HIDDEN_HOMEPAGE_PROJECTS` in `app/page.tsx` |
| New cover art | Save the original to `assets-src/covers/<slug>.<ext>`, run `npm run media`, use `media['covers/<slug>']` |
| New scene stickers | `assets-src/scenes/<scene>/`, then wire them up in `lib/assets.ts` and the scene in `app/page.tsx` |
| Music / fashion grid pages | `app/music/page.tsx`, `app/fashion/page.tsx`, `components/ProjectCard.tsx` |

Images the owner sends in chat: save the original under `assets-src/` (never `public/`), run
`npm run media`, and commit both the original and `lib/media-manifest.json`.

A homepage project without its own scene renders as a `ProjectCard`. A full scene like SOLENYA's
needs a scene component in `app/page.tsx`. For bigger "test a new structure" requests, build it in
the same PR so the owner can judge it on staging; nothing reaches production until they merge.

## 3. Verify before pushing

```bash
npm run lint
npm run build
npm run preview   # serves out/ in the Workers runtime at http://localhost:8787
```

Load the changed pages with Playwright (Chromium is at `/opt/pw-browsers`). Check that images load,
nothing logs errors, and the change looks right on a phone-sized viewport (390x844) and on desktop.
Send the owner a screenshot when the change is visual.

## 4. Push and hand off

- Commit with a message that says what changed for the site visitor.
- Push. If there is no open PR, open one; its body lists each change in plain language.
- Subscribe to the PR's activity and wait for the **Staging** workflow. When it finishes, reply with
  the staging link from the PR comment, and say what to look at.
- If Staging fails, read the log, fix it, and push again. Never hand over a red PR.
- Tell the owner that merging the PR publishes it, and that the **Production** workflow deploys it within
  about two minutes.

## 5. Consolidating pull requests

When more than one PR into `main` is open:

1. Pick the oldest as the survivor. Check out its branch and merge `origin/main`.
2. Merge each other PR's branch into it. Resolve conflicts so every requested change survives, and ask
   the owner only if two changes truly contradict each other.
3. Verify (section 3), push, and update the surviving PR's description to list every change.
4. Close each other PR with a comment: "Consolidated into #N."

Do this before ending any turn in which you opened or pushed to a PR.

## Rules

- Never push to `main`, and never run production deploys yourself; merging is the only path to production.
- Keep secrets out of the repo. The only secret is `CLOUDFLARE_API_TOKEN`, stored in GitHub Actions.
- Keep the site fast: no image over a few hundred KB in the output, no new render-blocking third-party
  scripts, and the first scene stays in the static HTML.
