import type { MediaAsset } from './media';

// Utility function to check if a project has been released
export function isProjectReleased(project: Project): boolean {
  if (!project.releaseDate) return true; // No release date means it's already released

  const releaseDate = new Date(project.releaseDate);
  const currentDate = new Date();

  // Set time to start of day for accurate date comparison
  releaseDate.setHours(0, 0, 0, 0);
  currentDate.setHours(0, 0, 0, 0);

  return currentDate >= releaseDate;
}

export type Project = {
  name: string;
  url?: string;
  type: string;
  description: string;
  highlight?: string;
  image?: MediaAsset;
  releaseDate?: string; // ISO date string for release date logic
  preReleaseDescription?: string; // Description to show before release
  postReleaseDescription?: string; // Description to show after release
  streamingLinks?: {
    applemusic?: string;
    spotify?: string;
    youtubemusic?: string;
  };
  postReleaseStreamingLinks?: {
    applemusic?: string;
    spotify?: string;
    youtubemusic?: string;
  };
}

export type ProjectData = {
  music: Project[];
  fashion: Project[];
}