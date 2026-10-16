export const UPLOAD_MAX_EDGE = 2048;
export const UPLOAD_JPEG_QUALITY = 0.8;
export const THUMB_MAX_EDGE = 400;
export const THUMB_JPEG_QUALITY = 0.72;

export function exifDateToMillis(value) {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1) return null;
  return date.getTime();
}

function ascii(bytes, offset, length) {
  let out = "";
  const end = Math.min(bytes.length, offset + length);
  for (let index = offset; index < end; index += 1) {
    const code = bytes[index];
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

function dateFromTiff(bytes, tiff, length) {
  if (tiff < 0 || tiff + 8 > bytes.length) return null;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (offset) => {
    if (offset < tiff || offset + 2 > tiff + length) return null;
    return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  };
  const u32 = (offset) => {
    if (offset < tiff || offset + 4 > tiff + length) return null;
    if (little) {
      return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    }
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  };
  if (u16(tiff + 2) !== 42) return null;
  const readIfd = (offset, depth) => {
    if (depth > 4 || offset == null) return null;
    const base = tiff + offset;
    const count = u16(base);
    if (count == null || count > 200) return null;
    let original = null;
    let digitized = null;
    let plain = null;
    let sub = null;
    for (let index = 0; index < count; index += 1) {
      const entry = base + 2 + index * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const values = u32(entry + 4);
      const raw = u32(entry + 8);
      if (tag == null || type == null || values == null || raw == null) continue;
      if (tag === 0x8769 && type === 4) sub = raw;
      if (type !== 2 || values < 4 || values > 32) continue;
      const textAt = values <= 4 ? entry + 8 : tiff + raw;
      const text = ascii(bytes, textAt, values);
      const when = exifDateToMillis(text);
      if (when == null) continue;
      if (tag === 0x9003) original = when;
      else if (tag === 0x9004) digitized = when;
      else if (tag === 0x0132) plain = when;
    }
    const nested = sub == null ? null : readIfd(sub, depth + 1);
    return original || digitized || nested || plain;
  };
  const start = u32(tiff + 4);
  return readIfd(start, 0);
}

export function readExifDate(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + 2 + size > bytes.length) return null;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === "Exif") {
      const found = dateFromTiff(bytes, offset + 10, size - 8);
      if (found) return found;
    }
    offset += 2 + size;
  }
  return null;
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return createImageBitmap(file);
  }
}

export async function compressImage(file, maxDimension = UPLOAD_MAX_EDGE, quality = UPLOAD_JPEG_QUALITY) {
  const bitmap = await decodeImage(file);
  try {
    let { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    if (longEdge > maxDimension) {
      const scale = maxDimension / longEdge;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("tomt bilde");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

export async function preparePhoto(file) {
  const buffer = await file.arrayBuffer();
  const takenAt = readExifDate(buffer);
  const source = new Blob([buffer], { type: file.type || "image/jpeg" });
  const blob = await compressImage(source, UPLOAD_MAX_EDGE, UPLOAD_JPEG_QUALITY);
  const thumb = await compressImage(blob, THUMB_MAX_EDGE, THUMB_JPEG_QUALITY);
  return { blob, thumb, takenAt };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
