// One-page PDF for a 4-inch Rollo: 203 dpi, 812 dots wide, page height matches the receipt.
// The image is DeviceRGB + Flate (zlib), which Workers can emit via CompressionStream.

export const ROLLO_DPI = 203;
/** 4 inches × 203 dpi. */
export const ROLLO_WIDTH_PX = 812;

const encoder = new TextEncoder();

export function pagePoints(widthPx: number, heightPx: number, dpi = ROLLO_DPI): { w: number; h: number } {
  return { w: (widthPx / dpi) * 72, h: (heightPx / dpi) * 72 };
}

/** Straight RGB, paper showing through any holes. */
export function rgbaToRgb(pixels: Uint8Array, paper: [number, number, number] = [242, 238, 230]): Uint8Array {
  const rgb = new Uint8Array((pixels.length / 4) * 3);
  for (let i = 0, j = 0; i + 3 < pixels.length; i += 4, j += 3) {
    const a = pixels[i + 3] / 255;
    rgb[j] = Math.round(pixels[i] * a + paper[0] * (1 - a));
    rgb[j + 1] = Math.round(pixels[i + 1] * a + paper[1] * (1 - a));
    rgb[j + 2] = Math.round(pixels[i + 2] * a + paper[2] * (1 - a));
  }
  return rgb;
}

/** zlib (RFC 1950), which PDF FlateDecode expects. */
export async function rgbFlate(rgb: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  await writer.write(rgb);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** One image, one page. Page size is the receipt at `dpi` (default 203). */
export function pdfFromRgb(width: number, height: number, flate: Uint8Array, dpi = ROLLO_DPI): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('pdf size');
  }
  const { w, h } = pagePoints(width, height, dpi);
  const parts: Uint8Array[] = [];
  const offsets = [0];
  let pos = 0;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    pos += bytes.length;
  };
  const str = (value: string) => push(encoder.encode(value));
  const obj = (n: number, dict: string, stream?: Uint8Array) => {
    offsets[n] = pos;
    if (stream) {
      str(`${n} 0 obj\n${dict}\nstream\n`);
      push(stream);
      str('\nendstream\nendobj\n');
    } else {
      str(`${n} 0 obj\n${dict}\nendobj\n`);
    }
  };

  str('%PDF-1.4\n%\x80\x80\x80\x80\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(w)} ${num(h)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  obj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>`,
    flate,
  );
  const content = encoder.encode(`q\n${num(w)} 0 0 ${num(h)} 0 0 cm\n/Im0 Do\nQ\n`);
  obj(5, `<< /Length ${content.length} >>`, content);

  const xrefAt = pos;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  str(xref);
  str(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
