# archive.bryton.studio

Creative portfolio and project archive for Bryton's music, fashion, and experimental web work. The homepage is a full-screen, scroll-driven showcase that opens with **SOLENYA** and continues through the current featured projects.

## Featured projects

The homepage currently presents:

1. **SOLENYA** — album
2. **CAUTION** — EP
3. **Just A Reminder To Live Life** — evolving mixtape
4. **Scrapwrk Store** — fashion and e-commerce project

The complete catalog also includes **Loopless Collection (Episodes)** and **The Archive (Music)** on the category pages.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Immersive scroll-based featured-project experience |
| `/music/` | Music project grid |
| `/fashion/` | Fashion project grid |

## Technology

- Next.js 14 using the App Router
- React 18 and TypeScript
- Tailwind CSS with custom animation and scene styling
- Next.js static export (`output: 'export'`)
- Firebase Hosting for the generated static site
- Cloudflare R2 for large scene artwork and decorative assets

## Project structure

```text
.
├── app/
│   ├── fashion/page.tsx       # Fashion catalog route
│   ├── music/page.tsx         # Music catalog route
│   ├── globals.css            # Global styles and animations
│   ├── layout.tsx             # Metadata, fonts, and root layout
│   └── page.tsx               # Featured homepage and scene choreography
├── components/
│   ├── ui/                    # Shared interface primitives
│   ├── Navigation.tsx         # Navigation component
│   └── ProjectCard.tsx        # Project cards and streaming modal
├── data/projects.yml          # Human-readable catalog reference
├── lib/
│   ├── assets.ts              # Local and Cloudflare R2 asset mapping
│   ├── projects.ts            # Runtime project catalog
│   └── utils.ts               # Project types and release helpers
├── public/                    # Static images, icons, and fallback pages
├── firebase.json              # Firebase Hosting configuration
├── next.config.js             # Static-export and image configuration
└── package.json               # Commands and dependencies
```

`lib/projects.ts` is the runtime source of truth used by the application. `data/projects.yml` mirrors the catalog as an editable content reference but is not loaded during the build.

## Local development

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

Next.js normally serves the app at [http://localhost:3000](http://localhost:3000). If that port is occupied, it selects the next available port.

No environment variables are currently required. The public Cloudflare R2 base URL is declared in `lib/assets.ts`.

## Validation and production build

```bash
npm run lint
npm run build
```

The production build is exported as static files in `out/`. That directory is generated and intentionally excluded from Git.

## Hosting

The repository is configured for Firebase Hosting:

- `.firebaserc` selects the Firebase project `thearchive-nonparallel`.
- `firebase.json` publishes the generated `out/` directory.
- Requests that do not match a static file fall back to `index.html`.
- `next.config.js` enables a static export, trailing slashes, and unoptimized images so the site can run without a Next.js server.

Build and deploy with the Firebase CLI:

```bash
npm run build
npx firebase-tools deploy --only hosting
```

Deployment requires access to the configured Firebase project. Building locally does not deploy or alter the live site.

Because the output is fully static, the `out/` directory can also be hosted by any static hosting provider. Firebase is the configuration committed in this repository.

## Assets and external services

- Files in `public/` are bundled into the static export.
- Larger scene elements are fetched from the public Cloudflare R2 bucket configured in `lib/assets.ts`.
- Streaming and project buttons link to external services such as Apple Music, Spotify, YouTube Music, and the individual project sites.
- There is no application server, database, authentication layer, or private API key in the current architecture.

## Updating the catalog

1. Update the project entry in `lib/projects.ts`.
2. Keep `data/projects.yml` synchronized for documentation and content reference.
3. Add local images under `public/`, or map R2-hosted assets in `lib/assets.ts`.
4. Update `HOMEPAGE_PROJECT_ORDER` and `HIDDEN_HOMEPAGE_PROJECTS` in `app/page.tsx` when changing the featured homepage sequence.
5. Run lint and a production build before publishing.

## Repository scope

Generated folders (`.next/`, `out/`, and `.firebase/`), local environment files, and nested standalone projects are excluded from this repository. This repository contains only the archive site and the assets it directly uses.
