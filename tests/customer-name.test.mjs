import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("eksisterende prosjekt lagrer kundenavn, og portalen viser det", () => {
  const app = readFileSync("www/app.js", "utf8");
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const pdf = readFileSync("www/js/pdf.js", "utf8");
  const form = app.slice(app.indexOf("function mountForm"), app.indexOf("function mountReport"));
  const box = app.slice(app.indexOf("function customerBox"), app.indexOf("function templateBox"));
  const report = app.slice(app.indexOf("async function saveReportPdf"), app.indexOf("async function urlToDataUrl"));

  assert.match(form, /field\("Kundenavn", customerName\)/);
  assert.match(form, /customerNamePatch\(source, customerName\.value\)/);
  assert.match(form, /customerName: nameFields\.customerName/);
  assert.match(box, /placeholder: "Kundens navn"/);
  assert.match(box, /saveCustomerName\(project, latest\)/);
  assert.match(report, /fresh\.data\(\)\.customerName/);
  assert.match(pdf, /Oppdragsgiver: \$\{model\.project\.customerName\}/);
  assert.match(portal, /normalizedCustomerName\(project\.customerName\)/);
  assert.match(portal, /class: "customer-name"/);
});

test("dreneringsflisen er borte i portal og app, modulen og rapportdata er igjen", () => {
  const app = readFileSync("www/app.js", "utf8");
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const project = app.slice(app.indexOf("function mountProject"), app.indexOf("async function loadDrainagePhotos"));

  assert.equal(project.includes("tile-drenering"), false);
  assert.equal(project.includes('tile-label" }, "Drenering"'), false);
  assert.equal(portal.includes("Drenering"), false);
  assert.equal(portal.includes("drainagePoints"), false);
  assert.match(app, /function mountDrainage/);
  assert.match(app, /Drenering – dokumentasjon og vurdering/);
  assert.match(readFileSync("www/js/drainage.js", "utf8"), /export function drainageReportText/);
  assert.equal(readFileSync("www/app.css", "utf8").includes("tile-drenering"), false);
});
