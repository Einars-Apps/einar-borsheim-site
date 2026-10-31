import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FDV_LOCKED_TEXT,
  fdvDownloadOpen,
  fdvOpenReason,
  fdvReasonText,
} from "../www/js/fdv.js";

const paid = (extra = {}) => ({ amount: 1000, vat: "eks", status: "betalt", ...extra });
const sent = (extra = {}) => ({ amount: 1000, vat: "eks", status: "sendt", ...extra });

test("FDV åpnes når sluttfakturaen er betalt", () => {
  const finished = { status: "fullfort" };
  assert.equal(fdvDownloadOpen({
    project: finished,
    payments: [paid({ sluttfaktura: true })],
  }), true);
  assert.equal(fdvOpenReason({
    project: finished,
    payments: [paid({ sluttfaktura: true }), sent()],
  }), "sluttfaktura");
  assert.equal(fdvDownloadOpen({
    project: { status: "aktiv" },
    payments: [paid({ sluttfaktura: true })],
  }), false);
  assert.equal(fdvDownloadOpen({
    project: finished,
    payments: [sent({ sluttfaktura: true }), paid()],
  }), false);
  assert.equal(fdvOpenReason({
    project: finished,
    payments: [sent({ sluttfaktura: true })],
  }), "locked");
});

test("uten merket sluttfaktura kreves ferdig prosjekt og bare betalte fakturaer", () => {
  const finished = { status: "fullfort" };
  assert.equal(fdvDownloadOpen({ project: finished, payments: [paid(), paid()] }), true);
  assert.equal(fdvOpenReason({ project: finished, payments: [paid()] }), "ferdig");
  assert.equal(fdvDownloadOpen({ project: { status: "done" }, payments: [{ amount: 500 }] }), true);
  assert.equal(fdvDownloadOpen({ project: finished, payments: [paid(), sent()] }), false);
  assert.equal(fdvDownloadOpen({ project: { status: "aktiv" }, payments: [paid()] }), false);
  assert.equal(fdvDownloadOpen({ project: finished, payments: [] }), false);
  assert.equal(fdvDownloadOpen({ project: finished }), false);
});

test("manuell opplåsing åpner nedlastingen, og låst tekst er fast", () => {
  const locked = { project: { status: "fullfort" }, payments: [sent({ sluttfaktura: true })] };
  assert.equal(fdvDownloadOpen(locked), false);
  assert.equal(fdvDownloadOpen({ project: { ...locked.project, fdvUnlocked: true }, payments: locked.payments }), true);
  assert.equal(fdvOpenReason({ project: { fdvUnlocked: true, status: "aktiv" }, payments: [] }), "override");
  assert.equal(fdvReasonText("locked"), FDV_LOCKED_TEXT);
  assert.equal(FDV_LOCKED_TEXT, "FDV-rapporten blir tilgjengelig her når prosjektet er ferdig og sluttoppgjøret er på plass. Takk for et godt samarbeid!");
  assert.equal(FDV_LOCKED_TEXT.includes("ubetalt"), false);
  assert.match(fdvReasonText("override"), /manuelt/);
  assert.match(fdvReasonText("sluttfaktura"), /sluttfakturaen er betalt/);
  assert.match(fdvReasonText("ferdig"), /alle fakturaene er betalt/);
});

test("bare FDV-filen er låst, resten av portalen er urørt", () => {
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  const firestore = readFileSync("firestore.rules", "utf8");
  const paint = portal.slice(portal.indexOf("function paintFdv"), portal.indexOf("function paintAllocation"));
  assert.match(paint, /renderFdvWait/);
  assert.match(paint, /getDownloadURL/);
  assert.equal(paint.includes("pdfUrl"), false);
  assert.equal(paint.includes("ubetalt"), false);
  const css = readFileSync("kunde/kunde.css", "utf8");
  const wait = css.slice(css.indexOf(".fdv-wait"), css.indexOf(".allocation-box"));
  assert.match(wait, /#f7f4ee/);
  assert.equal(wait.includes("#8e2f2f"), false);
  assert.equal(wait.includes("danger"), false);
  const documents = portal.slice(portal.indexOf("function documentSection"), portal.indexOf("function watchGps"));
  assert.equal(documents.includes("fdvDownloadOpen"), false);
  assert.equal(documents.includes("FDV_LOCKED_TEXT"), false);

  const rapport = storage.slice(storage.indexOf("match /projects/{projectId}/rapport/"), storage.indexOf("match /projects/{projectId}/hms/"));
  assert.match(rapport, /fdvReleased/);
  assert.match(storage, /fdvAvailable == true/);
  const media = storage.slice(storage.indexOf("match /projects/{projectId}/media/"), storage.indexOf("match /projects/{projectId}/rapport/"));
  assert.equal(media.includes("fdvAvailable"), false);
  const files = storage.slice(storage.indexOf("match /projects/{projectId}/documents/"), storage.indexOf("match /henvendelser/"));
  assert.equal(files.includes("fdvAvailable"), false);
  assert.match(firestore, /sluttfaktura/);
  assert.match(readFileSync("www/app.js", "utf8"), /fdvUnlocked/);
});
