const CLOUDFLARE_R2_BASE_URL = 'https://pub-c4515a0205d64d9e849dcafe9141149b.r2.dev';

export function getR2AssetUrl(fileName: string): string {
  return `${CLOUDFLARE_R2_BASE_URL}/${encodeURIComponent(fileName)}`;
}

export const solenyaSceneAssets = {
  cover: getR2AssetUrl('Untitled 107.PNG'),
  darkCloud: getR2AssetUrl('graphic 1.png'),
  lightCloud: getR2AssetUrl('graphic 2.png'),
  flowers: getR2AssetUrl('graphic 3.png'),
  waterfall: getR2AssetUrl('graphic 4.png'),
  birds: getR2AssetUrl('graphic 5.png'),
  grass: getR2AssetUrl('graphic 6.png'),
};

export const cautionSceneAssets = {
  cover: '/og/caution---ep.png',
  christler: getR2AssetUrl('christler.png'),
  empire: getR2AssetUrl('empire.png'),
  owt: getR2AssetUrl('owt.png'),
  pigeon: getR2AssetUrl('pigeon.png'),
};

export const reminderSceneAssets = {
  cover: '/og/just-a-reminder.png',
  microphone: getR2AssetUrl('microphone.png'),
  notepad: getR2AssetUrl('notepad.png'),
  paper: getR2AssetUrl('paper.png'),
  pen: getR2AssetUrl('pen.png'),
  pencil: getR2AssetUrl('pencil.png'),
};

export const scrapwrkSceneAssets = {
  cover: '/og/scrapwrk-store.png',
  hat: getR2AssetUrl('hat.png'),
  hoodieTop: getR2AssetUrl('hoodie.png'),
  hoodieBottom: getR2AssetUrl('hoodie 2.png'),
  pants: getR2AssetUrl('pants.png'),
};
