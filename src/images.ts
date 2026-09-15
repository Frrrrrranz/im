// Anything WebKit can decode → a `data:` URL every provider accepts: PNG,
// JPEG, GIF or WebP, at most 2048px on the long edge and a few MB. Originals
// within those limits are kept byte for byte; everything else (HEIC photos,
// 5K screenshots, TIFFs) is redrawn — PNG stays PNG so text stays sharp, the
// rest becomes JPEG.

const MAX_EDGE = 2048;
const MAX_BYTES = 3.5 * 1024 * 1024;
const KEEP = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const EXTENSIONS = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?)$/i;

/** A file's bytes, or a `data:` URL that already holds them. */
export type ImageSource = Blob | ArrayBuffer | string;

export function isImagePath(path: string): boolean {
  return EXTENSIONS.test(path);
}

export async function normalizeImage(source: ImageSource): Promise<string> {
  const blob = toBlob(source);
  const mime = sniff(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
  const img = await decode(blob);
  try {
    const edge = Math.max(img.width, img.height);
    if (KEEP.has(mime) && edge <= MAX_EDGE && blob.size <= MAX_BYTES) return await toDataUrl(blob, mime);
    let scale = Math.min(1, MAX_EDGE / edge);
    let type = mime === "image/png" ? "image/png" : "image/jpeg";
    for (let i = 0; i < 6; i++) {
      const url = draw(img, scale, type);
      if (bytesOf(url) <= MAX_BYTES) return url;
      if (type === "image/png") type = "image/jpeg";
      else scale *= 0.75;
    }
    throw new Error("image is too large");
  } finally {
    img.close();
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(blob: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(blob);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Formats createImageBitmap refuses but <img> still renders (WebKit: HEIC, TIFF).
    const url = URL.createObjectURL(blob);
    const el = new Image();
    el.src = url;
    try {
      await el.decode();
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("not an image");
    }
    return { source: el, width: el.naturalWidth, height: el.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
}

function draw(img: Decoded, scale: number, type: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img.source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.9);
}

function toBlob(source: ImageSource): Blob {
  if (source instanceof Blob) return source;
  if (typeof source !== "string") return new Blob([source]);
  // fetch() on a data: URL is a connect-src violation under our CSP; decode by hand.
  const comma = source.indexOf(",");
  const meta = source.slice(5, comma);
  const bin = atob(source.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: meta.split(";")[0] });
}

function toDataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([blob], { type: mime }));
  });
}

function sniff(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "";
}

/** Decoded size of a base64 data URL. */
export function bytesOf(dataUrl: string): number {
  return Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
}
