import { streamingIconAssets } from './assets';
import type { MediaAsset } from './media';
import { Project, getStreamingLinks, isProjectReleased } from './utils';

export type StreamingService = {
  key: 'applemusic' | 'spotify' | 'youtubemusic';
  name: string;
  icon: MediaAsset;
  tile: string;
  url?: string;
};

const SERVICES: Omit<StreamingService, 'url'>[] = [
  { key: 'applemusic', name: 'Apple Music', icon: streamingIconAssets.applemusic, tile: '#FA2D48' },
  { key: 'spotify', name: 'Spotify', icon: streamingIconAssets.spotify, tile: '#121212' },
  { key: 'youtubemusic', name: 'YouTube Music', icon: streamingIconAssets.youtubemusic, tile: '#0F0F0F' },
];

// Services with a link for this project. Before release only Apple Music (the pre-save) is live;
// the others are still listed, without a url, so people can see where it's coming.
export function getStreamingServices(project: Project): StreamingService[] {
  const links = getStreamingLinks(project);
  if (!links) return [];
  const isReleased = isProjectReleased(project);
  return SERVICES
    .map((service) => ({ ...service, url: isReleased || service.key === 'applemusic' ? links[service.key] : undefined }))
    .filter((service) => service.url || !isReleased);
}

// The label for a project's own link (projects that aren't on streaming services).
export function getVisitLabel(project: Project): string {
  if (project.type === 'ecommerce') return 'Shop';
  if (project.type === 'video-series') return 'Watch';
  return 'Visit';
}
