import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyPublicSections,
  hasPublicReferences,
  hasRealReviews,
  realReviewQuotes,
} from "../www/js/public-refs.js";

function page() {
  const nodes = [];
  const root = {
    querySelectorAll(selector) {
      return nodes.filter((node) => node.selectors.includes(selector));
    },
  };
  function add(selectors, hidden = true) {
    const node = { selectors, hidden };
    nodes.push(node);
    return node;
  }
  return {
    root,
    nav: add("[data-referanser-nav], #referanser, [data-referanser-side]"),
    section: add("[data-referanser-nav], #referanser, [data-referanser-side]"),
    reviews: add("[data-anmeldelser]"),
  };
}

test("ingen offentlige referanser holder seksjon og meny skjult", () => {
  assert.equal(hasPublicReferences([]), false);
  assert.equal(hasPublicReferences(null), false);
  const view = page();
  const result = applyPublicSections(view.root, []);
  assert.equal(result.references, false);
  assert.equal(result.reviews, false);
  assert.equal(view.nav.hidden, true);
  assert.equal(view.section.hidden, true);
  assert.equal(view.reviews.hidden, true);
});

test("første referanse viser seksjonen, tomme anmeldelser blir skjult", () => {
  const items = [{ id: "p1", name: "Drenering i Asker", ratings: [{ text: "   ", stars: 5 }] }];
  assert.equal(hasPublicReferences(items), true);
  assert.equal(hasRealReviews(items), false);
  assert.equal(realReviewQuotes(items[0].ratings).length, 0);
  const view = page();
  const result = applyPublicSections(view.root, items);
  assert.equal(result.references, true);
  assert.equal(result.reviews, false);
  assert.equal(view.nav.hidden, false);
  assert.equal(view.section.hidden, false);
  assert.equal(view.reviews.hidden, true);
});

test("en ekte kundetekst viser anmeldelsene", () => {
  const items = [{ id: "p1", name: "Hage", ratings: [{ text: "Ryddig jobb.", stars: 5 }] }];
  assert.equal(hasRealReviews(items), true);
  const view = page();
  const result = applyPublicSections(view.root, items);
  assert.equal(result.reviews, true);
  assert.equal(view.reviews.hidden, false);
});

test("forsiden skjuler referanser i HTML før spørringen", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = readFileSync(new URL("../referanser.js", import.meta.url), "utf8");
  const pageHtml = readFileSync(new URL("../referanser/index.html", import.meta.url), "utf8");
  assert.match(html, /data-referanser-nav[^>]*hidden/);
  assert.match(html, /id="referanser"[^>]*hidden/);
  assert.match(pageHtml, /data-referanser-side[^>]*hidden/);
  assert.doesNotMatch(html, /kommer snart/i);
  assert.doesNotMatch(pageHtml, /kommer snart/i);
  assert.doesNotMatch(script, /legges ut etter hvert/);
  assert.doesNotMatch(script, /kunne ikke lastes/);
});
