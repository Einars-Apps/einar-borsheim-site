import test from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_PREVIEW_APP,
  PORTAL_PREVIEW_BANNER,
  applyPortalPreviewLock,
  customerOwnPending,
  customerVisibleContent,
  customerVisibleDocument,
  isPortalPreview,
  portalPreviewUrl,
  portalUrl,
  previewOpenMode,
} from "../www/js/logic.js";

const adminUid = "einar-uid";

test("kundelenken er uendret og forhåndsvisningen legger bare på vis", () => {
  const shared = new URL(portalUrl("prosjekt-1", "tok 1"));
  assert.equal(shared.searchParams.get("p"), "prosjekt-1");
  assert.equal(shared.searchParams.get("t"), "tok 1");
  assert.equal(shared.searchParams.get("vis"), null);
  assert.match(shared.pathname, /kunde/);

  const preview = new URL(portalPreviewUrl("prosjekt-1", "tok 1"));
  assert.equal(preview.origin + preview.pathname, shared.origin + shared.pathname);
  assert.equal(preview.searchParams.get("p"), "prosjekt-1");
  assert.equal(preview.searchParams.get("t"), "tok 1");
  assert.equal(preview.searchParams.get("vis"), "forhandsvisning");
  assert.equal(isPortalPreview(preview.search), true);
  assert.equal(isPortalPreview(shared.search), false);
  assert.equal(isPortalPreview("vis=forhandsvisning"), true);
  assert.equal(isPortalPreview("vis=noe-annet"), false);
});

test("banner og eget Firebase-appnavn er faste", () => {
  assert.equal(PORTAL_PREVIEW_BANNER, "Forhåndsvisning – slik ser kunden det");
  assert.equal(PORTAL_PREVIEW_APP, "kunde-forhandsvisning");
});

test("Android åpner i appen, ellers ny fane", () => {
  assert.equal(previewOpenMode({ native: true, hasBrowser: true }), "in-app");
  assert.equal(previewOpenMode({ native: true, hasBrowser: false }), "copy");
  assert.equal(previewOpenMode({ native: false, hasBrowser: true }), "tab");
  assert.equal(previewOpenMode({}), "tab");
});

test("kunden ser godkjent innhold, ikke Einars utkast selv om uid er den samme", () => {
  const approved = { id: "a", approved: true, source: "admin", createdBy: adminUid, title: "Ferdig notat" };
  const draft = { id: "b", approved: false, source: "admin", createdBy: adminUid, title: "Utkast" };
  const own = { id: "c", approved: false, source: "kunde", createdBy: "kunde-uid", kind: "kunde" };
  const trashed = { id: "d", approved: true, trashed: true, source: "admin", createdBy: adminUid, url: "https://example.test/a.jpg" };

  assert.equal(customerVisibleContent(approved, adminUid), true);
  assert.equal(customerVisibleContent(draft, adminUid), false);
  assert.equal(customerOwnPending(draft, adminUid), false);
  assert.equal(customerVisibleContent(own, "kunde-uid"), true);
  assert.equal(customerVisibleContent(own, adminUid), false);
  assert.equal(customerVisibleContent(trashed, adminUid), false);
  assert.equal(customerVisibleContent({ approved: false, source: "customer", createdBy: "kunde-uid" }, "kunde-uid"), true);
});

test("bilder i papirkurven og avviste adminbilder holdes utenfor", () => {
  const best = { id: "best", approved: true, best: true, url: "https://example.test/best.jpg", source: "admin" };
  const rest = { id: "rest", approved: true, trashed: true, url: "https://example.test/rest.jpg", source: "admin" };
  const pendingAdmin = { id: "pending", approved: false, url: "https://example.test/p.jpg", source: "admin", createdBy: adminUid };
  assert.equal(customerVisibleContent(best, adminUid), true);
  assert.equal(customerVisibleContent(rest, adminUid), false);
  assert.equal(customerVisibleContent(pendingAdmin, adminUid), false);
  assert.equal(customerOwnPending({
    approved: false,
    source: "kunde",
    createdBy: "kunde-uid",
    url: "https://example.test/own.jpg",
  }, "kunde-uid"), true);
});

test("dokumenter følger kunderegelen", () => {
  assert.equal(customerVisibleDocument({ approved: true, source: "admin" }), true);
  assert.equal(customerVisibleDocument({ approved: false, source: "admin" }), false);
  assert.equal(customerVisibleDocument({ approved: false, source: "customer", name: "Tegning" }), true);
});

test("forhåndsvisning låser knapper og felt, og lar alternativene stå", () => {
  const root = {
    nodes: [
      { kind: "button", disabled: false },
      { kind: "textarea", disabled: false },
      { kind: "input", type: "file", disabled: false },
      { kind: "input", type: "text", disabled: false },
      { kind: "input", type: "radio", disabled: false },
    ],
    querySelectorAll(selector) {
      if (selector.startsWith("button")) return this.nodes.filter((node) => node.kind !== "input");
      return this.nodes.filter((node) => node.kind === "input");
    },
  };
  applyPortalPreviewLock(root);
  assert.equal(root.nodes[0].disabled, true);
  assert.equal(root.nodes[1].disabled, true);
  assert.equal(root.nodes[2].disabled, true);
  assert.equal(root.nodes[3].disabled, true);
  assert.equal(root.nodes[4].disabled, false);
  applyPortalPreviewLock(null);
});
