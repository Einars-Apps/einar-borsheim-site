import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allocateOre,
  evenShares,
  householdAllocation,
  householdShareError,
  normalizeHouseholds,
  parseShare,
  shareSum,
  withEvenShares,
} from "../www/js/households.js";

const pair = [
  { id: "h1", name: "1. etasje", share: 50 },
  { id: "h2", name: "2. etasje", share: 50 },
];

test("lik fordeling blir 50/50 for to og summerer til 100", () => {
  assert.deepEqual(evenShares(0), []);
  assert.deepEqual(evenShares(1), [100]);
  assert.deepEqual(evenShares(2), [50, 50]);
  assert.deepEqual(evenShares(3), [33.34, 33.33, 33.33]);
  assert.deepEqual(evenShares(4), [25, 25, 25, 25]);
  for (const count of [1, 2, 3, 4, 7, 8]) {
    const shares = evenShares(count);
    assert.equal(shares.length, count);
    assert.equal(Math.round(shares.reduce((sum, share) => sum + share, 0) * 100), 10000);
  }
  const edited = withEvenShares([
    { id: "a", name: "A", share: 10 },
    { id: "b", name: "B", share: 90 },
  ]);
  assert.deepEqual(edited.map((row) => row.share), [50, 50]);
});

test("andeler må bli 100 prosent", () => {
  assert.equal(householdShareError([]), "");
  assert.equal(householdShareError(pair), "");
  assert.equal(parseShare("50,5"), 50.5);
  assert.equal(parseShare("50 %"), 50);
  assert.equal(parseShare(""), null);
  assert.equal(parseShare(-1), null);
  assert.match(householdShareError([{ id: "a", name: "", share: 100 }]), /navn/);
  assert.match(householdShareError([{ id: "a", name: "A", share: 40 }, { id: "b", name: "B", share: 40 }]), /100/);
  assert.match(householdShareError([{ id: "a", name: "A", share: "hei" }]), /mellom 0 og 100/);
  assert.match(householdShareError([{ id: "a", name: "A", share: 100, email: "ikke-e-post" }]), /E-post/);
  assert.equal(householdShareError([{ id: "a", name: "A", share: 100, email: "a@b.no", contact: "Kari" }]), "");
  assert.equal(shareSum(pair), 100);
  assert.equal(normalizeHouseholds(null).length, 0);
  assert.equal(normalizeHouseholds([{ name: "Uten id", share: 100 }]).length, 0);
  assert.equal(normalizeHouseholds([{ id: "a", name: "A", share: "60" }, { id: "b", name: "B", share: 40 }])[0].share, 60);
});

test("kroneandeler summerer til totalen, og restøren går til største brøk", () => {
  const split = householdAllocation({
    households: pair,
    totalEx: 1000,
    totalInc: 1250,
    payments: [],
  });
  assert.equal(split.rows[0].exVat, 500);
  assert.equal(split.rows[1].exVat, 500);
  assert.equal(split.rows[0].incVat, 625);
  assert.equal(split.rows[1].incVat, 625);
  assert.equal(split.rows[0].dueEx, 500);
  assert.equal(split.rows[1].dueInc, 625);

  const odd = householdAllocation({
    households: pair,
    totalEx: 1000.01,
    totalInc: 1250.01,
  });
  assert.equal(odd.rows[0].exVat + odd.rows[1].exVat, 1000.01);
  assert.equal(odd.rows[0].incVat + odd.rows[1].incVat, 1250.01);
  assert.equal(odd.rows[0].exVat, 500.01);
  assert.equal(odd.rows[1].exVat, 500);

  const weighted = householdAllocation({
    households: [
      { id: "a", name: "A", share: 60 },
      { id: "b", name: "B", share: 40 },
    ],
    totalEx: 1000,
    totalInc: 1250,
  });
  assert.equal(weighted.rows[0].exVat, 600);
  assert.equal(weighted.rows[1].exVat, 400);
  assert.equal(weighted.rows[0].incVat, 750);
  assert.equal(weighted.rows[1].incVat, 500);

  const three = householdAllocation({
    households: evenShares(3).map((share, index) => ({ id: `h${index}`, name: `H${index}`, share })),
    totalEx: 100,
    totalInc: 125,
  });
  assert.equal(three.rows.reduce((sum, row) => sum + row.exVat, 0), 100);
  assert.equal(three.rows.reduce((sum, row) => sum + row.incVat, 0), 125);
  assert.deepEqual(allocateOre(10001, [5000, 5000]), [5001, 5000]);
});

test("betaling uten husstand deles, og en merket betaling går til den husstanden", () => {
  const unassigned = householdAllocation({
    households: pair,
    totalEx: 1000,
    totalInc: 1250,
    payments: [{ amount: 200, vat: "eks", status: "betalt" }],
  });
  assert.equal(unassigned.rows[0].paidEx, 100);
  assert.equal(unassigned.rows[1].paidEx, 100);
  assert.equal(unassigned.rows[0].paidInc, 125);
  assert.equal(unassigned.rows[1].paidInc, 125);
  assert.equal(unassigned.rows[0].dueEx, 400);
  assert.equal(unassigned.rows[1].dueEx, 400);

  const assigned = householdAllocation({
    households: pair,
    totalEx: 1000,
    totalInc: 1250,
    payments: [{ amount: 200, vat: "eks", status: "betalt", householdId: "h1" }],
  });
  assert.equal(assigned.rows[0].paidEx, 200);
  assert.equal(assigned.rows[0].paidInc, 250);
  assert.equal(assigned.rows[1].paidEx, 0);
  assert.equal(assigned.rows[1].paidInc, 0);
  assert.equal(assigned.rows[0].dueEx, 300);
  assert.equal(assigned.rows[1].dueEx, 500);

  const mixed = householdAllocation({
    households: pair,
    totalEx: 1000,
    totalInc: 1250,
    payments: [
      { amount: 200, vat: "eks", status: "betalt", householdId: "h1" },
      { amount: 100, vat: "eks", status: "betalt" },
      { amount: 999, vat: "eks", status: "sendt", householdId: "h2" },
      { amount: 999, vat: "eks", status: "betalt", householdId: "ukjent" },
      { amount: 50, status: "betalt" },
    ],
  });
  assert.equal(mixed.rows[0].paidEx, 200 + 50 + 499.5);
  assert.equal(mixed.rows[1].paidEx, 50 + 499.5);
  assert.equal(mixed.rows[0].paidInc, 250 + 62.5 + 624.38);
  assert.equal(Math.round((mixed.rows[0].paidEx + mixed.rows[1].paidEx) * 100), Math.round((200 + 100 + 999) * 100));

  const inkl = householdAllocation({
    households: pair,
    totalEx: 800,
    totalInc: 1000,
    payments: [{ amount: 1000, vat: "inkl", status: "betalt", householdId: "h2" }],
  });
  assert.equal(inkl.rows[1].paidInc, 1000);
  assert.equal(inkl.rows[1].paidEx, 800);
  assert.equal(inkl.rows[0].paidInc, 0);
  assert.equal(inkl.rows[1].dueInc, -500);
  assert.equal(inkl.rows[0].dueInc, 500);

  assert.equal(householdAllocation({ households: [], totalEx: 100, payments: [] }), null);
});

test("portalen bruker én lenke og viser fordelingen når seksjonen er synlig", () => {
  const portal = readFileSync("kunde/kunde.js", "utf8");
  const app = readFileSync("www/app.js", "utf8");
  const rules = readFileSync("firestore.rules", "utf8");
  assert.match(portal, /householdAllocation/);
  assert.match(portal, /portalSectionVisible\(project, "kostnad"\)/);
  assert.match(portal, /portalSectionVisible\(project, "betalinger"\)/);
  assert.match(app, /householdsForSave/);
  assert.equal(app.includes("householdToken"), false);
  assert.match(rules, /householdId/);
  const access = rules.slice(rules.indexOf("match /access/"), rules.indexOf("match /photos/"));
  assert.match(access, /shareToken/);
  assert.equal(access.includes("households"), false);
});
