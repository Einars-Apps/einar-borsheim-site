import test from "node:test";
import assert from "node:assert/strict";
import { readExifDate, readExifMeta } from "../www/js/image.js";
import { captureMillis, sortPhotos } from "../www/js/photos.js";
import { formatCapture, gpsLabel, mapHref, showGpsInReport, withDevicePosition } from "../www/js/place.js";

function textBytes(value) {
  return [...value].map((char) => char.charCodeAt(0));
}

function push16(target, value) {
  target.push(value & 255, (value >> 8) & 255);
}

function push32(target, value) {
  target.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
}

function exifJpeg({ dateTime, original, gps }) {
  const date = textBytes(`${dateTime}\0`);
  const shot = textBytes(`${original}\0`);
  const tiff = [];
  tiff.push(0x49, 0x49);
  push16(tiff, 42);
  push32(tiff, 8);
  const rootCount = gps ? 3 : 2;
  push16(tiff, rootCount);
  push16(tiff, 0x0132);
  push16(tiff, 2);
  push32(tiff, date.length);
  const dateAt = 8 + 2 + rootCount * 12 + 4;
  push32(tiff, dateAt);
  push16(tiff, 0x8769);
  push16(tiff, 4);
  push32(tiff, 1);
  const exifAt = dateAt + date.length;
  push32(tiff, exifAt);
  let gpsAt = 0;
  if (gps) {
    push16(tiff, 0x8825);
    push16(tiff, 4);
    push32(tiff, 1);
    gpsAt = exifAt + 2 + 12 + 4 + shot.length;
    push32(tiff, gpsAt);
  }
  push32(tiff, 0);
  tiff.push(...date);
  push16(tiff, 1);
  push16(tiff, 0x9003);
  push16(tiff, 2);
  push32(tiff, shot.length);
  const shotAt = exifAt + 2 + 12 + 4;
  push32(tiff, shotAt);
  push32(tiff, 0);
  tiff.push(...shot);
  if (gps) {
    const refs = textBytes("N\0E\0");
    const rationals = [];
    for (const value of [gps.lat, gps.lon, gps.accuracy]) {
      if (!value) continue;
      for (const part of value) {
        push32(rationals, part[0]);
        push32(rationals, part[1]);
      }
    }
    const dataAt = gpsAt + 2 + 5 * 12 + 4;
    push16(tiff, 5);
    const latRefAt = dataAt;
    push16(tiff, 0x0001);
    push16(tiff, 2);
    push32(tiff, 2);
    push32(tiff, latRefAt);
    push16(tiff, 0x0002);
    push16(tiff, 5);
    push32(tiff, 3);
    push32(tiff, dataAt + refs.length);
    push16(tiff, 0x0003);
    push16(tiff, 2);
    push32(tiff, 2);
    push32(tiff, latRefAt + 2);
    push16(tiff, 0x0004);
    push16(tiff, 5);
    push32(tiff, 3);
    push32(tiff, dataAt + refs.length + 24);
    push16(tiff, 0x001f);
    push16(tiff, 5);
    push32(tiff, 1);
    push32(tiff, dataAt + refs.length + 48);
    push32(tiff, 0);
    tiff.push(...refs, ...rationals);
  }
  const payload = [...textBytes("Exif\0\0"), ...tiff];
  const size = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, (size >> 8) & 255, size & 255, ...payload, 0xff, 0xd9,
  ]);
}

test("opptakstid vises i Oslo, og EXIF slår filtid", () => {
  assert.equal(formatCapture(Date.parse("2026-10-16T12:32:00Z")), "16.10.2026 kl. 14:32");
  assert.equal(formatCapture(null), "");
  const bytes = exifJpeg({
    dateTime: "2020:01:02 03:04:05",
    original: "2024:05:06 07:08:09",
    gps: {
      lat: [[59, 1], [50, 1], [6, 10]],
      lon: [[10, 1], [26, 1], [672, 100]],
      accuracy: [[5, 1]],
    },
  });
  const meta = readExifMeta(bytes);
  assert.equal(readExifDate(bytes), new Date(2024, 4, 6, 7, 8, 9).getTime());
  assert.equal(meta.takenAt, new Date(2024, 4, 6, 7, 8, 9).getTime());
  assert.ok(Math.abs(meta.lat - 59.8335) < 0.0001);
  assert.ok(Math.abs(meta.lon - 10.4352) < 0.0001);
  assert.equal(meta.accuracyM, 5);
});

test("posisjon vises bare presist når den er innen 30 meter", () => {
  const precise = gpsLabel({ lat: 59.8335, lon: 10.4352, accuracyM: 5 });
  assert.equal(precise.text, "59.8335, 10.4352 ±5 m");
  assert.equal(precise.precise, true);
  assert.match(precise.href, /norgeskart\.no/);
  assert.match(precise.href, /lat=59\.83350/);
  assert.equal(gpsLabel({ lat: 59.8335, lon: 10.4352, accuracyM: 80 }).text, "Omtrentlig posisjon");
  assert.equal(gpsLabel({ lat: 59.8, lon: 10.4 }).precise, false);
  assert.equal(gpsLabel({}), null);
  assert.equal(mapHref("nei", 1), "");
});

test("rapporten viser GPS som standard, og bildene sorteres ulikt", () => {
  assert.equal(showGpsInReport({}), true);
  assert.equal(showGpsInReport({ showGpsInReport: true }), true);
  assert.equal(showGpsInReport({ showGpsInReport: false }), false);
  const photos = [
    { id: "ny", url: "https://cdn.example/ny.jpg", createdAt: 1_700_000_003_000 },
    { id: "gammel", url: "https://cdn.example/gammel.jpg", createdAt: 1_700_000_001_000, takenAt: 1_700_000_000_500 },
    { id: "uten", url: "https://cdn.example/uten.jpg" },
  ];
  assert.deepEqual(sortPhotos(photos, "newest").map((photo) => photo.id), ["ny", "gammel", "uten"]);
  assert.deepEqual(sortPhotos(photos, "oldest").map((photo) => photo.id), ["gammel", "ny", "uten"]);
  assert.equal(captureMillis(photos[1]), 1_700_000_000_500);
  const placed = withDevicePosition({ takenAt: 1, lat: null }, { lat: 59.1, lon: 10.2, accuracyM: 8 });
  assert.equal(placed.lat, 59.1);
  assert.equal(withDevicePosition({ lat: 1, lon: 2, accuracyM: 3 }, { lat: 9, lon: 9, accuracyM: 1 }).lat, 1);
});
