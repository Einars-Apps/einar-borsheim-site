import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_JUMPS,
  PORTAL_SECTIONS,
  applyPortalPatch,
  clonePortalVisibility,
  offerSendNote,
  portalAllSectionsPatch,
  portalSectionPatch,
  portalSectionVisible,
  restorePortalVisibility,
} from "../www/js/portal-visibility.js";

test("eksisterende prosjekt beholder dagens synlighet", () => {
  const project = { name: "Hage" };
  assert.equal(portalSectionVisible(project, "tilbud"), true);
  assert.equal(portalSectionVisible(project, "tilbudEndringer"), true);
  assert.equal(portalSectionVisible(project, "kostnad"), false);
  assert.equal(portalSectionVisible(project, "betalinger"), true);
  assert.equal(portalSectionVisible(project, "bilder"), true);
  assert.equal(portalSectionVisible(project, "endringer"), true);
  assert.equal(portalSectionVisible(project, "dokumentasjon"), true);
  assert.equal(portalSectionVisible(project, "grunnlag"), true);
  assert.equal(portalSectionVisible(project, "meldinger"), true);
  assert.equal(portalSectionVisible(project, "foresporsler"), true);
  assert.equal(portalSectionVisible(project, "hms"), true);
  assert.equal(portalSectionVisible(project, "vurdering"), true);
  assert.equal(portalSectionVisible(project, "ukjent"), false);
  assert.equal(portalSectionVisible({ showCostToCustomer: "true" }, "kostnad"), false);
  assert.equal(portalSectionVisible({ showCostToCustomer: true }, "kostnad"), true);
  assert.equal(portalSectionVisible({ portalSections: { kostnad: true } }, "kostnad"), false);
});

test("avkryssing lagres på eksisterende felt, ikke et nytt kostnadsflagg", () => {
  assert.deepEqual(portalSectionPatch("kostnad", true), { showCostToCustomer: true });
  assert.deepEqual(portalSectionPatch("kostnad", false), { showCostToCustomer: false });
  assert.deepEqual(portalSectionPatch("meldinger", false), { "portalSections.meldinger": false });
  assert.deepEqual(portalSectionPatch("ukjent", true), {});
  const allOn = portalAllSectionsPatch(true);
  const allOff = portalAllSectionsPatch(false);
  assert.equal(allOn.showCostToCustomer, true);
  assert.equal(allOff.showCostToCustomer, false);
  for (const section of PORTAL_SECTIONS) {
    if (section.id === "kostnad") {
      assert.equal(allOn["portalSections.kostnad"], undefined);
      continue;
    }
    assert.equal(allOn[`portalSections.${section.id}`], true);
    assert.equal(allOff[`portalSections.${section.id}`], false);
  }
});

test("ett felt kan skjules uten å endre de andre", () => {
  const project = {};
  applyPortalPatch(project, portalSectionPatch("grunnlag", false));
  assert.equal(portalSectionVisible(project, "grunnlag"), false);
  assert.equal(portalSectionVisible(project, "meldinger"), true);
  assert.equal(portalSectionVisible(project, "kostnad"), false);
  const previous = clonePortalVisibility(project);
  applyPortalPatch(project, portalAllSectionsPatch(true));
  assert.equal(portalSectionVisible(project, "kostnad"), true);
  assert.equal(portalSectionVisible(project, "grunnlag"), true);
  restorePortalVisibility(project, previous);
  assert.equal(portalSectionVisible(project, "grunnlag"), false);
  assert.equal(portalSectionVisible(project, "kostnad"), false);
  assert.equal(portalSectionVisible(project, "meldinger"), true);
});

test("utkast i Tilbud og endringer forklares for Einar", () => {
  assert.match(offerSendNote([]), /Utkast vises ikke/);
  assert.match(offerSendNote([{ kind: "tilbud", approvalRequested: false, fikenBase: false }]), /Ett utkast/);
  assert.match(offerSendNote([
    { kind: "tilbud", approvalRequested: true },
    { kind: "endring", approvalRequested: false },
  ]), /Én post er sendt/);
  assert.match(offerSendNote([{ kind: "tilbud", fikenBase: true, approvalRequested: false }]), /Ingen poster/);
});

test("portalen og feltappen bruker de samme seksjonene", () => {
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const view = readFileSync("www/js/portal-visibility-view.js", "utf8");
  const app = readFileSync("www/app.js", "utf8");
  assert.match(view, /Synlig for kunden/);
  assert.match(view, /Vis alt/);
  assert.match(view, /Skjul alt/);
  assert.match(view, /Kunden kan ikke endre dette/);
  assert.match(app, /renderCustomerVisibility\(/);
  assert.match(portal, /portalSectionVisible\(project, "tilbudEndringer"\)/);
  assert.match(portal, /portalSectionVisible\(project, "grunnlag"\)/);
  assert.match(portal, /portalSectionVisible\(project, "meldinger"\)/);
  assert.match(portal, /fillPortalNav/);
  assert.match(portal, /if \(offerPosts\.length \|\| customerSeesCost\(project\)\)/);
  assert.match(portal, /showPayments: false/);
  assert.match(portal, /PORTAL_PREVIEW_NOTE/);
  assert.match(readFileSync("www/js/logic.js", "utf8"), /Dette følger Synlig for kunden/);
  for (const jump of PORTAL_JUMPS) {
    if (jump.id === "hms" || jump.id === "cost-slot") continue;
    assert.match(portal, new RegExp(jump.id));
  }
  assert.match(readFileSync("firestore.rules", "utf8"), /allow create, update, delete: if isAdmin\(\);/);
});
