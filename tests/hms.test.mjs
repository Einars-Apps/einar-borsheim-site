import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  HMS_MAX_BYTES,
  activeHmsDocs,
  customerHmsDocs,
  hmsContentType,
  hmsCountLabel,
  hmsStoragePath,
  isHmsFileName,
  newHmsDoc,
  sortHmsDocs,
} from "../www/js/hms.js";

test("HMS tar imot PDF, Word og bilder, og lagrer dem under prosjektet", () => {
  assert.equal(isHmsFileName("Risiko.pdf"), true);
  assert.equal(isHmsFileName("Notat.DOCX"), true);
  assert.equal(isHmsFileName("foto.jpeg"), true);
  assert.equal(isHmsFileName("virus.exe"), false);
  assert.equal(isHmsFileName("uten"), false);
  assert.equal(hmsContentType("Notat.DOCX"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(hmsContentType("bilde.heic"), "image/heic");
  assert.equal(hmsStoragePath("p1", "doc1", "mappe/HMS plan.pdf"), "projects/p1/hms/doc1/mappe-HMS-plan.pdf");
  assert.equal(HMS_MAX_BYTES, 25 * 1024 * 1024);
  const doc = newHmsDoc({ name: "Plan.pdf", url: "https://example.com/a.pdf", storagePath: "projects/p1/hms/doc1/Plan.pdf", uploadedBy: "e.bors@hotmail.com" });
  assert.equal(doc.visibleToCustomer, false);
  assert.equal(doc.trashed, false);
  assert.equal(doc.source, "admin");
});

test("kunden ser bare delte HMS-dokumenter som ikke ligger i papirkurven", () => {
  const docs = [
    { id: "skjult", name: "Intern", visibleToCustomer: false, trashed: false, createdAt: 1_700_000_003_000 },
    { id: "delt", name: "Delt", visibleToCustomer: true, trashed: false, createdAt: 1_700_000_001_000 },
    { id: "borte", name: "Borte", visibleToCustomer: true, trashed: true, createdAt: 1_700_000_004_000 },
    { id: "ny", name: "Ny", visibleToCustomer: true, trashed: false, createdAt: 1_700_000_002_000 },
  ];
  assert.deepEqual(activeHmsDocs(docs).map((doc) => doc.id), ["skjult", "delt", "ny"]);
  assert.deepEqual(customerHmsDocs(docs).map((doc) => doc.id), ["delt", "ny"]);
  assert.deepEqual(sortHmsDocs(customerHmsDocs(docs)).map((doc) => doc.id), ["ny", "delt"]);
  assert.equal(hmsCountLabel(0), "Ingen dokumenter");
  assert.equal(hmsCountLabel(1), "1 dokument");
  assert.equal(hmsCountLabel(activeHmsDocs(docs).length), "3 dokumenter");
});

test("firestore- og storage-reglene holder HMS unna kunden som standard", () => {
  const firestore = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  const fireStart = firestore.indexOf("match /hmsDocs/{docId}");
  const fireBlock = firestore.slice(fireStart, firestore.indexOf("match /documents/{docId}"));
  assert.match(fireBlock, /visibleToCustomer == true/);
  assert.match(fireBlock, /trashed == false/);
  assert.match(fireBlock, /allow create, update, delete: if isAdmin\(\)/);
  const storageBlock = storage.slice(
    storage.indexOf("match /projects/{projectId}/hms/{docId}/{fileName}"),
    storage.indexOf("match /projects/{projectId}/documents/{fileName}"),
  );
  assert.match(storageBlock, /hmsShared\(projectId, docId\)/);
  assert.match(storageBlock, /allow create: if isAdmin\(\) && isHmsUpload\(\)/);
  assert.equal(storageBlock.includes("hasAccess(projectId) && isHmsUpload"), false);
  assert.match(storage, /function hmsShared/);
});
