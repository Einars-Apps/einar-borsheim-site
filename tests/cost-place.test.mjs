import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { customerSeesCost } from "../www/js/cost.js";

function sliceFn(source, name, next) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${next}`);
  assert.ok(start >= 0 && end > start, name);
  return source.slice(start, end);
}

test("nåværende kostnad ligger i Tilbud og endringer, og prosjektet gjenbruker samme bryter", () => {
  const app = readFileSync("www/app.js", "utf8");
  const offers = sliceFn(app, "mountOffers", "fikenLinkPatch");
  const project = sliceFn(app, "mountProject", "loadDrainagePhotos");
  const visibility = readFileSync("www/js/portal-visibility.js", "utf8");
  assert.match(offers, /renderCostOverview\(/);
  assert.match(offers, /Vis kostnad for kunden i portalen/);
  assert.match(offers, /showCostToCustomer: shareCost\.checked === true/);
  assert.equal(project.includes("renderCostOverview"), false);
  assert.equal(project.includes("showCostToCustomer"), false);
  assert.match(project, /renderCustomerVisibility\(/);
  assert.match(visibility, /if \(id === "kostnad"\) return \{ showCostToCustomer: on \}/);
  assert.equal(customerSeesCost({}), false);
  assert.equal(customerSeesCost({ showCostToCustomer: false }), false);
  assert.equal(customerSeesCost({ showCostToCustomer: true }), true);
});

test("portalen viser kostnaden inne i Tilbud og endringer, og bare når bryteren er på", () => {
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const heading = portal.indexOf('el("h2", {}, "Tilbud og endringer")');
  const slot = portal.indexOf('id: "cost-slot"');
  assert.ok(heading > 0 && slot > heading);
  assert.equal(portal.slice(0, heading).includes('id: "cost-slot"'), false);
  assert.match(portal, /if \(offerPosts\.length \|\| customerSeesCost\(project\)\)/);
  assert.match(portal, /if \(customerSeesCost\(project\)\) box\.append\(el\("div", \{ id: "cost-slot" \}\)\)/);
});
