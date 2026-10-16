import test from "node:test";
import assert from "node:assert/strict";
import { QUEUE_DB, QUEUE_STORE } from "../www/js/queue.js";
import { exifDateToMillis, readExifDate, UPLOAD_JPEG_QUALITY, UPLOAD_MAX_EDGE, THUMB_MAX_EDGE } from "../www/js/image.js";
import {
  UPLOAD_CONCURRENCY,
  canAttempt,
  failureReason,
  needsPrepare,
  queueBanner,
  retryDelay,
  RETRY_MAX_MS,
  runUploadPool,
  showRetryButton,
  uploadProgressText,
  withTimeout,
} from "../www/js/upload-queue.js";

function textBytes(value) {
  return [...value].map((char) => char.charCodeAt(0));
}

function exifJpeg(dateTime, original) {
  const date = textBytes(`${dateTime}\0`);
  const shot = textBytes(`${original}\0`);
  const tiff = [];
  const push16 = (value) => tiff.push(value & 255, (value >> 8) & 255);
  const push32 = (value) => tiff.push(value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255);
  tiff.push(0x49, 0x49);
  push16(42);
  push32(8);
  push16(2);
  push16(0x0132);
  push16(2);
  push32(date.length);
  push32(38);
  push16(0x8769);
  push16(4);
  push32(1);
  push32(58);
  push32(0);
  tiff.push(...date);
  push16(1);
  push16(0x9003);
  push16(2);
  push32(shot.length);
  push32(76);
  push32(0);
  tiff.push(...shot);
  const payload = [...textBytes("Exif\0\0"), ...tiff];
  const size = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, (size >> 8) & 255, size & 255, ...payload, 0xff, 0xd9,
  ]);
}

test("køen ligger i samme database som bildene som allerede venter", () => {
  assert.equal(QUEUE_DB, "internkontroll");
  assert.equal(QUEUE_STORE, "queue");
});

test("EXIF-dato leses før bildet krympes, og opptakstid slår filtid", () => {
  assert.equal(exifDateToMillis("2024:05:06 07:08:09"), new Date(2024, 4, 6, 7, 8, 9).getTime());
  assert.equal(exifDateToMillis("ikke en dato"), null);
  const when = readExifDate(exifJpeg("2020:01:02 03:04:05", "2024:05:06 07:08:09"));
  assert.equal(when, new Date(2024, 4, 6, 7, 8, 9).getTime());
  assert.equal(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});

test("opplasting skal holde detaljene og lage et lite rutenettbilde", () => {
  assert.equal(UPLOAD_MAX_EDGE, 2048);
  assert.equal(UPLOAD_JPEG_QUALITY, 0.8);
  assert.equal(THUMB_MAX_EDGE, 400);
  assert.equal(UPLOAD_CONCURRENCY, 2);
});

test("fremdrift sier hvilket bilde som lastes opp", () => {
  assert.equal(uploadProgressText(6, 40), "Laster opp 7 av 40");
  assert.equal(uploadProgressText(39, 40), "Laster opp 40 av 40");
  assert.equal(queueBanner({
    online: true,
    active: true,
    phase: "upload",
    done: 6,
    total: 40,
    waiting: 40,
    failed: 0,
  }), "Laster opp 7 av 40");
  assert.equal(showRetryButton({ online: true, active: true, waiting: 40, failed: 0 }), true);
  assert.equal(showRetryButton({ online: false, waiting: 34, failed: 34 }), false);
});

test("gamle køposter uten miniatyrbilde klargjøres på nytt, små ferdige poster gjør ikke", () => {
  assert.equal(needsPrepare({ blob: { size: 2_000_000 } }), true);
  assert.equal(needsPrepare({ blob: { size: 400_000 }, thumb: { size: 20_000 } }), false);
  assert.equal(needsPrepare({ blob: { size: 900_000 }, thumb: { size: 20_000 } }), true);
  assert.equal(needsPrepare({ blob: { size: 900_000 }, thumb: { size: 20_000 }, prepared: true }), false);
  assert.equal(needsPrepare({ url: "https://example.test/a.jpg" }), false);
});

test("retry venter lenger for hvert forsøk og en feil stopper ikke de andre", async () => {
  assert.equal(retryDelay(0), 4000);
  assert.ok(retryDelay(1) > retryDelay(0));
  assert.equal(retryDelay(20), RETRY_MAX_MS);
  const now = 1_000_000;
  assert.equal(canAttempt({ held: true, nextAttemptAt: 0 }, now), false);
  assert.equal(canAttempt({ held: false, nextAttemptAt: now + 1 }, now), false);
  assert.equal(canAttempt({ held: false, nextAttemptAt: now }, now), true);
  assert.equal(canAttempt({ held: false }, now), true);
  assert.match(failureReason({ code: "timeout", message: "Tidsavbrudd" }), /Tidsavbrudd/);
  assert.equal(failureReason({ message: "Failed to fetch" }), "Ingen nett");

  let active = 0;
  let max = 0;
  const done = [];
  const items = [1, 2, 3, 4, 5].map((id) => ({ id }));
  await runUploadPool(items, async (item) => {
    active += 1;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    if (item.id === 2) throw new Error("timeout");
    done.push(item.id);
  }, { concurrency: 2 });
  assert.ok(max <= 2);
  assert.ok(max >= 2);
  assert.deepEqual(done.sort((a, b) => a - b), [1, 3, 4, 5]);
});

test("en opplasting som henger får tidsavbrudd", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20), /Tidsavbrudd/);
});
