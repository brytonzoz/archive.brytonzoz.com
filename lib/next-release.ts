import type { Project } from './utils';

// The teaser that leads the homepage while the next release is being made.
// - `title`: leave null to keep it unnamed ("New music"); set it when you're ready to reveal.
// - `date`: an ISO date/time (e.g. '2026-11-14T00:00:00-05:00'); once set, "Coming soon" becomes a live
//   countdown, and on the day it reads "Out now".
// - `releaseId`: the release's id in lib/tracks.json. Once the date has passed and that release is
//   marked available, the teaser turns itself into "Listen Now" with no other change needed.
// - `enabled: false` removes the teaser and SOLENYA leads again.
// People can leave their email ("Notify me"); the list is in /admin.
export const nextRelease = {
  enabled: true,
  title: null as string | null,
  date: null as string | null,
  releaseId: null as string | null,
};

export const NEXT_RELEASE_NAME = 'Next release';

export function nextReleaseProject(): Project | null {
  if (!nextRelease.enabled) return null;
  return { name: NEXT_RELEASE_NAME, type: 'coming-soon', description: '' };
}
