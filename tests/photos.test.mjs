import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DELETE_OTHERS_CONFIRM,
  DELETE_PHOTO_CONFIRM,
  SIMILAR_MS,
  groupPhotos,
  moreLabel,
  newGroupId,
  photoKey,
  photoMillis,
  collectSharedPhotos,
  galleryPage,
  galleryPageLabels,
  galleryPageSize,
  galleryShowsPager,
  photoIsShared,
  photoTag,
  publicPhotos,
  redundantPhotoItem,
  representativePhotos,
  sharedWithCustomer,
  viewerIndex,
} from "../www/js/photos.js";

const t0 = Date.parse("2026-05-01T10:00:00.000Z");

function shot(id, extra = {}) {
  return {
    id,
    itemId: extra.itemId || id,
    url: `https://cdn.example/${id}.jpg`,
    caption: extra.caption || "",
    comment: extra.comment || extra.caption || "",
    step: extra.step || "",
    createdAt: extra.createdAt ?? t0,
    approved: extra.approved !== false,
    ...extra,
  };
}

test("tidspunkt leses fra millisekunder, sekunder og Firestore-timestamp", () => {
  assert.equal(photoMillis(t0), t0);
  assert.equal(photoMillis({ seconds: 1_700_000_000, nanoseconds: 0 }), 1_700_000_000_000);
  assert.equal(photoMillis(new Date(t0)), t0);
  assert.equal(photoMillis("2026-05-01T10:00:00.000Z"), t0);
  assert.equal(photoMillis(null), null);
});

test("samme notat, samme mal eller samme kommentar blir én bunke", () => {
  const stacks = groupPhotos([
    shot("a", { itemId: "note", createdAt: t0 }),
    shot("b", { itemId: "note", createdAt: t0 + 10 * SIMILAR_MS }),
    shot("c", { itemId: "annet", step: "Grøft", createdAt: t0 + 86_400_000 }),
    shot("d", { itemId: "tredje", step: "Grøft", caption: "annet", comment: "annet", createdAt: t0 + 2 * 86_400_000 }),
    shot("e", { itemId: "fjerde", caption: "Før graving", comment: "Før graving", createdAt: t0 + 3 * 86_400_000 }),
    shot("f", { itemId: "femte", caption: "  før   graving ", comment: "  før   graving ", createdAt: t0 + 4 * 86_400_000 }),
  ]);
  assert.equal(stacks.length, 3);
  const note = stacks.find((stack) => stack.photos.some((photo) => photo.id === "a"));
  assert.deepEqual(note.photos.map((photo) => photo.id).sort(), ["a", "b"]);
  const trench = stacks.find((stack) => stack.photos.some((photo) => photo.id === "c"));
  assert.deepEqual(trench.photos.map((photo) => photo.id).sort(), ["c", "d"]);
  const comment = stacks.find((stack) => stack.photos.some((photo) => photo.id === "e"));
  assert.deepEqual(comment.photos.map((photo) => photo.id).sort(), ["e", "f"]);
});

test("bilder tatt innen 60 sekunder grupperes, og et opphold på mer skiller dem", () => {
  const close = groupPhotos([
    shot("a", { itemId: "a", createdAt: t0 }),
    shot("b", { itemId: "b", createdAt: t0 + SIMILAR_MS }),
  ]);
  assert.equal(close.length, 1);
  assert.equal(close[0].others.length, 1);
  assert.equal(moreLabel(close[0].others.length), "1 til");

  const apart = groupPhotos([
    shot("a", { itemId: "a", createdAt: t0 }),
    shot("b", { itemId: "b", createdAt: t0 + SIMILAR_MS + 1 }),
  ]);
  assert.equal(apart.length, 2);

  const chain = groupPhotos([
    shot("a", { itemId: "a", createdAt: t0 }),
    shot("b", { itemId: "b", createdAt: t0 + 50_000 }),
    shot("c", { itemId: "c", createdAt: t0 + 100_000 }),
  ]);
  assert.equal(chain.length, 1);
  assert.equal(moreLabel(chain[0].others.length), "2 flere");
});

test("tom kommentar og tom mal grupperer ikke urelaterte bilder", () => {
  const stacks = groupPhotos([
    shot("a", { itemId: "a", caption: "", comment: "", step: "", createdAt: t0 }),
    shot("b", { itemId: "b", caption: "  ", comment: "", step: "", createdAt: t0 + 3 * SIMILAR_MS }),
  ]);
  assert.equal(stacks.length, 2);
});

test("stjerne velger beste, ellers det nyeste", () => {
  const unmarked = groupPhotos([
    shot("eldre", { itemId: "samme", createdAt: t0 }),
    shot("ny", { itemId: "samme", createdAt: t0 + 1000 }),
  ]);
  assert.equal(unmarked[0].best.id, "ny");

  const marked = groupPhotos([
    shot("eldre", { itemId: "samme", createdAt: t0, best: true }),
    shot("ny", { itemId: "samme", createdAt: t0 + 1000, best: false }),
  ]);
  assert.equal(marked[0].best.id, "eldre");
  assert.deepEqual(marked[0].others.map((photo) => photo.id), ["ny"]);
});

test("manuell gruppe samler valgte bilder og tar ikke med naboen i tid", () => {
  const groupId = "grp-test";
  const stacks = groupPhotos([
    shot("a", { itemId: "a", groupId, step: "Ferdig", createdAt: t0 }),
    shot("b", { itemId: "b", groupId, step: "Før", createdAt: t0 + 5 * 86_400_000 }),
    shot("c", { itemId: "c", step: "Ferdig", createdAt: t0 + 20_000 }),
  ]);
  const manual = stacks.find((stack) => stack.id === `grp:${groupId}`);
  assert.deepEqual(manual.photos.map((photo) => photo.id).sort(), ["a", "b"]);
  assert.equal(stacks.some((stack) => stack.photos.some((photo) => photo.id === "c") && stack.photos.length === 1), true);
  assert.match(newGroupId(t0), /^grp-/);
});

test("kunden ser hvert godkjente bilde, også flere på samme post", () => {
  const photos = [
    shot("a", { itemId: "samme", createdAt: t0 }),
    shot("b", { itemId: "samme", createdAt: t0 + 1000 }),
    shot("c", { itemId: "samme", approved: false, createdAt: t0 + 2000 }),
    shot("d", { itemId: "samme", trashed: true, createdAt: t0 + 3000 }),
    shot("e", { itemId: "samme", url: "", createdAt: t0 + 4000 }),
  ];
  assert.deepEqual(sharedWithCustomer(photos).map((photo) => photo.id), ["a", "b"]);
  assert.equal(publicPhotos(photos).length, 1);
});

test("deling kan ligge på approved, shared eller visibleToCustomer", () => {
  assert.equal(photoIsShared(shot("a")), true);
  assert.equal(photoIsShared(shot("b", { approved: false, shared: true })), true);
  assert.equal(photoIsShared(shot("c", { approved: false, visibleToCustomer: true })), true);
  assert.equal(photoIsShared(shot("d", { approved: false })), false);
  assert.equal(photoIsShared(shot("e", { url: "", thumbUrl: "https://cdn.example/e.jpg" })), true);
  assert.equal(photoIsShared(shot("f", { url: "", thumbUrl: "" })), false);
  assert.equal(photoIsShared(shot("g", { trashed: true })), false);
  assert.equal(photoTag({ step: "Grøft", caption: "Grøft" }), "Grøft");
  assert.equal(photoTag({ step: "Grøft", caption: "Hjørnet" }), "Grøft · Hjørnet");
});

test("bilder på bilde-poster og forsidebilde når kunden, ikke bare ett utvalgt", () => {
  const items = [
    { id: "groft", kind: "bilde", approved: true, step: "Grøft", coverUrl: "https://cdn.example/a.jpg", text: "" },
    { id: "for", kind: "bilde", approved: true, step: "Før", coverUrl: "https://cdn.example/cover.jpg", text: "" },
    { id: "skjult", kind: "bilde", approved: false, step: "Ferdig", coverUrl: "https://cdn.example/hemmelig.jpg" },
  ];
  const photosByItem = {
    groft: [
      shot("a", { itemId: "groft", url: "https://cdn.example/a.jpg", step: "Grøft" }),
      shot("b", { itemId: "groft", url: "https://cdn.example/b.jpg", step: "Grøft" }),
      shot("nei", { itemId: "groft", approved: false, url: "https://cdn.example/nei.jpg" }),
    ],
  };
  const shared = collectSharedPhotos({
    items,
    photosByItem,
    legacy: [shot("gammel", { itemId: "legacy-gammel", url: "https://cdn.example/gammel.jpg", caption: "Gammel" })],
  });
  assert.deepEqual(shared.map((photo) => photo.id), ["a", "b", "cover-for", "gammel"]);
  assert.equal(shared.some((photo) => photo.id === "nei" || String(photo.url).includes("hemmelig")), false);
  const embedded = collectSharedPhotos({
    items: [{
      id: "notat",
      approved: true,
      step: "Rør/duk",
      photos: [{ id: "inne", url: "https://cdn.example/inne.jpg" }],
    }],
  });
  assert.deepEqual(embedded.map((photo) => photo.id), ["inne"]);
  assert.equal(embedded[0].step, "Rør/duk");
});

test("portalen henter bilder også når posten ikke har et kort", () => {
  const portal = readFileSync(new URL("../kunde/kunde.js", import.meta.url), "utf8");
  const hydrate = portal.slice(portal.indexOf("async function hydrate"), portal.indexOf("async function loadVisible"));
  assert.equal(hydrate.includes("if (!media || media.dataset.loaded) return"), false);
  assert.match(hydrate, /loadVisible/);
  assert.match(portal, /openPhotoViewer\(index >= 0 \? series : usable/);
  assert.match(portal, /galleryShowsPager/);
  assert.match(readFileSync(new URL("../kunde/kunde.css", import.meta.url), "utf8"), /grid-template-columns: 1fr 1fr 1fr/);
});

test("galleriet deles i sider, og lysbordet stopper i enden", () => {
  const photos = Array.from({ length: 10 }, (_, index) => shot(String(index + 1)));
  assert.equal(galleryPageSize(390), 6);
  assert.equal(galleryPageSize(900), 9);
  assert.equal(galleryShowsPager(6, 6), false);
  assert.equal(galleryShowsPager(7, 6), true);
  const narrow = galleryPage(photos, 2, 6);
  assert.equal(narrow.page, 2);
  assert.equal(narrow.pages, 2);
  assert.deepEqual(narrow.photos.map((photo) => photo.id), ["7", "8", "9", "10"]);
  const wide = galleryPage(photos, 1, 9);
  assert.equal(wide.photos.length, 9);
  assert.equal(galleryPage(photos, 9, 9).page, 2);
  assert.deepEqual(galleryPageLabels(2, 1), ["1", "2"]);
  assert.deepEqual(galleryPageLabels(12, 6), ["1", "…", "5", "6", "7", "…", "12"]);
  assert.equal(viewerIndex(0, -1, 4), 0);
  assert.equal(viewerIndex(3, 1, 4), 3);
  assert.equal(viewerIndex(1, 1, 4), 2);
  assert.equal(viewerIndex(0, 1, 1), 0);
});

test("bare beste synlige bilde går ut, ikke papirkurv eller avviste", () => {
  const photos = [
    shot("beste", { itemId: "samme", best: true, createdAt: t0 }),
    shot("ekstra", { itemId: "samme", createdAt: t0 + 1000 }),
    shot("borte", { itemId: "samme", trashed: true, best: true, createdAt: t0 + 2000 }),
    shot("avvist", { itemId: "samme", approved: false, createdAt: t0 + 3000 }),
    shot("annet", { itemId: "annet", createdAt: t0 + 3 * SIMILAR_MS, caption: "Ferdig", comment: "Ferdig", step: "Ferdig" }),
  ];
  const shown = publicPhotos(photos).map((photo) => photo.id).sort();
  assert.deepEqual(shown, ["annet", "beste"]);
  assert.equal(publicPhotos(photos).some((photo) => photo.id === "borte" || photo.id === "ekstra"), false);
  const drafts = representativePhotos(photos).map(photoKey);
  assert.equal(drafts.includes(photoKey(photos[1])), false);
});

test("papirkurv og manglende stjerne: neste godkjente bilde med lenke vises", () => {
  const photos = [
    shot("uten-lenke", { itemId: "samme", url: "", best: true, createdAt: t0 + 5000 }),
    shot("synlig", { itemId: "samme", createdAt: t0 }),
  ];
  assert.deepEqual(publicPhotos(photos).map((photo) => photo.id), ["synlig"]);
});

test("duplikat uten egen tekst skjules når beste bilde vises", () => {
  const best = shot("beste", { itemId: "a", best: true, itemText: "Grøft", comment: "Grøft" });
  const extra = shot("ekstra", { itemId: "b", itemText: "Grøft", comment: "Grøft", step: "Grøft" });
  const unique = shot("unikt", { itemId: "c", itemText: "Egen merknad", comment: "Egen merknad", step: "Ferdig", createdAt: t0 + 3 * SIMILAR_MS });
  const all = [best, extra, unique];
  assert.equal(redundantPhotoItem({ id: "b", kind: "bilde", text: "Grøft" }, all), true);
  assert.equal(redundantPhotoItem({ id: "a", kind: "bilde", text: "Grøft" }, all), false);
  assert.equal(redundantPhotoItem({ id: "c", kind: "bilde", text: "Egen merknad" }, all), false);
  assert.equal(redundantPhotoItem({ id: "b", kind: "bilde", text: "" }, all, { hasComments: true }), false);
});

test("slettetekst er den korte bekreftelsen", () => {
  assert.equal(DELETE_PHOTO_CONFIRM, "Slette bildet?");
  assert.equal(DELETE_OTHERS_CONFIRM, "Slette de andre bildene?");
});
