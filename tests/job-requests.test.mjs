import test from "node:test";
import assert from "node:assert/strict";
import { jobRequestFields, jobStatusLabel, jobKindLabel } from "../www/js/job-requests.js";

test("forespoersel har type, tekst og valgfritt antall, og ingen pris", () => {
  const priced = jobRequestFields({
    kind: "bestilling",
    text: "  Ekstra drenering  ",
    quantity: "2,5",
  });
  assert.equal(priced.kind, "bestilling");
  assert.equal(priced.text, "Ekstra drenering");
  assert.equal(priced.quantity, 2.5);
  assert.equal(priced.status, "ny");
  assert.equal("unitPrice" in priced, false);
  assert.equal("price" in priced, false);
  const plain = jobRequestFields({ kind: "pris", text: "Ny kum", quantity: "" });
  assert.equal(plain.kind, "pris");
  assert.equal("quantity" in plain, false);
  assert.equal(jobKindLabel(priced), "Bestilling");
  assert.equal(jobStatusLabel({ status: "ny" }), "Ny");
  assert.equal(jobStatusLabel({ status: "besvart" }), "Besvart");
  assert.equal(jobStatusLabel({ status: "tillegg" }), "Lagt til som tillegg");
});
