import { ProjectData, Project } from './utils';
import { cautionSceneAssets, nonparallelAssets, reminderSceneAssets, scrapwrkSceneAssets, solenyaSceneAssets } from './assets';

// For now, we'll use hardcoded data that matches our YAML structure
// In a production app, this would load from the YAML file
const projectData: ProjectData = {
  music: [
    {
      name: "SOLENYA",
      type: "album",
      description: "learning to grow from loss",
      releaseDate: "2025-09-01", // September 1st release date
      preReleaseDescription: "learning to grow from loss",
      postReleaseDescription: "learning to grow from loss",
      image: solenyaSceneAssets.cover,
      streamingLinks: {
        applemusic: "https://music.apple.com/us/album/solenya/1833829863" // Pre-save link
      },
      postReleaseStreamingLinks: {
        applemusic: "https://music.apple.com/us/album/solenya/1833829863",
        spotify: "https://open.spotify.com/album/4IGIjZH0MbncPO4zxoZKmZ",
        youtubemusic: "https://music.youtube.com/playlist?list=OLAK5uy_maQeci50syKnfqkO1YRqVtcHyRX2TkoLI"
      }
    },
    {
      name: "CAUTION",
      type: "streaming-ep",
      description: "energy, motion, and late nights",
      image: cautionSceneAssets.cover,
      streamingLinks: {
        applemusic: "https://music.apple.com/us/album/caution-ep/1824528138",
        spotify: "https://open.spotify.com/album/0tdB9n4bTY3rYYv5AmZU9r",
        youtubemusic: "https://music.youtube.com/playlist?list=OLAK5uy_n3mF8_7iuzdI5hN7B_Itc0XERH-F7e2Vg"
      }
    },
    {
      name: "Just A Reminder To Live Life",
      url: "https://justaremindertolivelife.com",
      type: "mixtape",
      description: "thoughts, moments, and in-between",
      highlight: "wednesday drops",
      image: reminderSceneAssets.cover
    }
  ],
  fashion: [
    {
      name: "Scrapwrk Store",
      url: "/scrapwrk/",
      type: "ecommerce",
      description: "reconstructed pieces and identity",
      highlight: "Shop",
      image: scrapwrkSceneAssets.cover
    },
    {
      name: "NonParallel",
      url: "/nonparallel/",
      type: "merch",
      description: "the label and company behind all of this",
      highlight: "Shop",
      // Bryton's own rainbow tee mockup (a site image, so pages listing projects don't load the shop).
      image: nonparallelAssets.tees.rainbow
    }
  ]
};

export function getProjects(): ProjectData {
  return projectData;
}

export function getMusicProjects(): Project[] {
  return projectData.music;
}

export function getFashionProjects(): Project[] {
  return projectData.fashion;
}
