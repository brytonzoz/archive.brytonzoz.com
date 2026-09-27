import { ProjectData, Project } from './utils';
import { cautionSceneAssets, scrapwrkSceneAssets, solenyaSceneAssets } from './assets';

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
        spotify: "https://open.spotify.com/artist/2XP6WdGTizwwiIFjuAbGVc?si=xjSj6u56SQmhZ6B-2zPOpA",
        youtubemusic: "https://music.youtube.com/channel/UCUj0eTHlcpfBcOLPg4PFBjQ?si=YUhf7W-MVG6Qk0-A"
      }
    },
    {
      name: "CAUTION",
      type: "streaming-ep",
      description: "energy, motion, and late nights",
      image: cautionSceneAssets.cover,
      streamingLinks: {
        applemusic: "https://music.apple.com/us/album/caution-ep/1824528138",
        spotify: "https://open.spotify.com/album/0tdB9n4bTY3rYYv5AmZU9r?si=WyA-7u8hTsirIPzeTP6wJw",
        youtubemusic: "https://music.youtube.com/playlist?list=OLAK5uy_n3mF8_7iuzdI5hN7B_Itc0XERH-F7e2Vg&si=IMOAIcungvz8DdCm"
      }
    },
    {
      name: "Just A Reminder To Live Life",
      url: "https://justaremindertolivelife.com",
      type: "mixtape",
      description: "thoughts, moments, and in-between",
      highlight: "wednesday drops",
      image: "/og/just-a-reminder.png"
    },
    {
      name: "The Archive (Music)",
      url: "https://nonparallel.wixstudio.com/archive",
      type: "multi-purpose-stream",
      description: "Multi-purpose streaming platform for creative content",
      highlight: "Beta Access",
      image: "/og/archive-music.png"
    }
  ],
  fashion: [
    {
      name: "Loopless Collection (Episodes)",
      url: "https://nonparallel.wixstudio.com/archive/thearchive-fashion-1",
      type: "video-series",
      description: "Fashion video series showcasing creative collections",
      highlight: "Latest Episodes",
      image: "/og/Untitled 14.jpg"
    },
    {
      name: "Scrapwrk Store",
      url: "https://scrapwrk.com",
      type: "ecommerce",
      description: "reconstructed pieces and identity",
      highlight: "Visit",
      image: scrapwrkSceneAssets.cover
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
