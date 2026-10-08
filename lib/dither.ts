// Turns an uploaded logo into 1-bit thermal print in the browser: fit to the print area, flatten
// on white paper, Atkinson-dither to ink or nothing, and export a small transparent PNG.
import { LOGO_LIMITS } from './shipped-sponsors';

export type DitheredLogo = { blob: Blob; url: string; width: number; height: number };

const INK = [28, 25, 23];

export async function ditherLogo(file: File, maxBytes = LOGO_LIMITS.maxBytes): Promise<DitheredLogo> {
  const bitmap = await createImageBitmap(file);
  const fit = Math.min(LOGO_LIMITS.maxWidth / bitmap.width, LOGO_LIMITS.maxHeight / bitmap.height);
  for (const shrink of [1, 0.75, 0.5]) {
    const width = Math.max(8, Math.round(bitmap.width * fit * shrink));
    const height = Math.max(8, Math.round(bitmap.height * fit * shrink));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

    const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const ink = gray[i] < 128;
        const error = (gray[i] - (ink ? 0 : 255)) / 8;
        for (const [dx, dy] of spread) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny < height) gray[ny * width + nx] += error;
        }
        px[i * 4] = INK[0];
        px[i * 4 + 1] = INK[1];
        px[i * 4 + 2] = INK[2];
        px[i * 4 + 3] = ink ? 255 : 0;
      }
    }
    ctx.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob && blob.size <= maxBytes) {
      bitmap.close();
      return { blob, url: URL.createObjectURL(blob), width, height };
    }
  }
  bitmap.close();
  throw new Error('too-big');
}
