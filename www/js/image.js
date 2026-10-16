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

const EMPTY_EXIF = { takenAt: null, lat: null, lon: null, accuracyM: null };

function parseTiff(bytes, tiff, length) {
  if (tiff < 0 || tiff + 8 > bytes.length) return { ...EMPTY_EXIF };
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return { ...EMPTY_EXIF };
  const inTiff = (offset, size) => offset >= tiff && offset + size <= tiff + length && offset + size <= bytes.length;
  const u16 = (offset) => {
    if (!inTiff(offset, 2)) return null;
    return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
  };
  const u32 = (offset) => {
    if (!inTiff(offset, 4)) return null;
    if (little) {
      return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    }
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  };
  const i32 = (offset) => {
    const value = u32(offset);
    if (value == null) return null;
    return value > 0x7fffffff ? value - 0x100000000 : value;
  };
  if (u16(tiff + 2) !== 42) return { ...EMPTY_EXIF };

  function readEntries(offset) {
    if (offset == null) return [];
    const base = tiff + offset;
    const count = u16(base);
    if (count == null || count > 200) return [];
    const entries = [];
    for (let index = 0; index < count; index += 1) {
      const entry = base + 2 + index * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const countValue = u32(entry + 4);
      const raw = u32(entry + 8);
      if (tag == null || type == null || countValue == null || raw == null) continue;
      entries.push({ tag, type, count: countValue, raw, entry });
    }
    return entries;
  }

  function textOf(entry) {
    if (!entry || entry.type !== 2 || entry.count < 2 || entry.count > 64) return "";
    const textAt = entry.count <= 4 ? entry.entry + 8 : tiff + entry.raw;
    return ascii(bytes, textAt, entry.count);
  }

  function rationalAt(entry, index) {
    if (!entry || (entry.type !== 5 && entry.type !== 10) || index >= entry.count) return null;
    const start = entry.count * 8 <= 4 ? entry.entry + 8 : tiff + entry.raw;
    const offset = start + index * 8;
    const numerator = entry.type === 10 ? i32(offset) : u32(offset);
    const denominator = u32(offset + 4);
    if (numerator == null || denominator == null || denominator === 0) return null;
    return numerator / denominator;
  }

  function dateOf(entry) {
    return exifDateToMillis(textOf(entry));
  }

  function dms(entry, ref) {
    if (!entry || entry.count < 3) return null;
    const degrees = rationalAt(entry, 0);
    const minutes = rationalAt(entry, 1);
    const seconds = rationalAt(entry, 2);
    if (degrees == null || minutes == null || seconds == null) return null;
    let value = degrees + minutes / 60 + seconds / 3600;
    const mark = String(ref || "").trim().toUpperCase();
    if (mark === "S" || mark === "W") value = -Math.abs(value);
    return value;
  }

  function readGps(entries) {
    const byTag = new Map(entries.map((entry) => [entry.tag, entry]));
    const lat = dms(byTag.get(0x0002), textOf(byTag.get(0x0001)));
    const lon = dms(byTag.get(0x0004), textOf(byTag.get(0x0003)));
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return {};
    const error = byTag.get(0x001f);
    const accuracy = error ? rationalAt(error, 0) : null;
    const accuracyM = accuracy != null && accuracy >= 0 && accuracy <= 100000 ? accuracy : null;
    return { lat, lon, accuracyM };
  }

  const root = readEntries(u32(tiff + 4));
  let original = null;
  let digitized = null;
  let plain = null;
  let exifAt = null;
  let gpsAt = null;
  for (const entry of root) {
    if (entry.tag === 0x8769 && entry.type === 4) exifAt = entry.raw;
    else if (entry.tag === 0x8825 && entry.type === 4) gpsAt = entry.raw;
    else if (entry.tag === 0x0132) plain = dateOf(entry) || plain;
  }
  for (const entry of readEntries(exifAt)) {
    if (entry.tag === 0x9003) original = dateOf(entry) || original;
    else if (entry.tag === 0x9004) digitized = dateOf(entry) || digitized;
  }
  const gps = gpsAt == null ? {} : readGps(readEntries(gpsAt));
  return {
    takenAt: original || digitized || plain || null,
    lat: gps.lat ?? null,
    lon: gps.lon ?? null,
    accuracyM: gps.accuracyM ?? null,
  };
}

export function readExifMeta(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { ...EMPTY_EXIF };
  let offset = 2;
  let found = null;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + 2 + size > bytes.length) break;
    if (marker === 0xe1 && ascii(bytes, offset + 4, 4) === "Exif") {
      const meta = parseTiff(bytes, offset + 10, size - 8);
      found = {
        takenAt: found?.takenAt || meta.takenAt,
        lat: found?.lat ?? meta.lat,
        lon: found?.lon ?? meta.lon,
        accuracyM: found?.accuracyM ?? meta.accuracyM,
      };
      if (found.takenAt && found.lat != null && found.lon != null) break;
    }
    offset += 2 + size;
  }
  return found || { ...EMPTY_EXIF };
}

export function readExifDate(buffer) {
  return readExifMeta(buffer).takenAt;
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
  const meta = readExifMeta(buffer);
  const source = new Blob([buffer], { type: file.type || "image/jpeg" });
  const blob = await compressImage(source, UPLOAD_MAX_EDGE, UPLOAD_JPEG_QUALITY);
  const thumb = await compressImage(blob, THUMB_MAX_EDGE, THUMB_JPEG_QUALITY);
  return { blob, thumb, ...meta };
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
