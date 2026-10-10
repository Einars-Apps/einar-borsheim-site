import { readFileSync } from "node:fs";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getBytes, ref, uploadString } from "firebase/storage";

const PROJECT = "demo-einar-borsheim";
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: readFileSync("storage.rules", "utf8") },
  });
});

after(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  if (typeof env.clearStorage === "function") await env.clearStorage();
});

function adminDb() {
  return env.authenticatedContext("admin-user", { email: "e.bors@hotmail.com" }).firestore();
}

function customerDb(uid = "kunde1") {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
}

function strangerDb() {
  return env.unauthenticatedContext().firestore();
}

async function seedProject() {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1"), {
      name: "Hage",
      shareToken: "TOK123456",
      public: true,
      customerEmail: "secret@example.com",
      customerPhone: "90000000",
      pdfUrl: "https://example.com/secret.pdf",
    });
  });
}

test("fremmede kan ikke lese prosjektet selv om det er offentlig", async () => {
  await seedProject();
  await assertFails(getDoc(doc(strangerDb(), "projects/p1")));
  const other = env.authenticatedContext("other", { email: "other@example.com" }).firestore();
  await assertFails(getDoc(doc(other, "projects/p1")));
});

test("feil token gir ikke tilgang, riktig token gjør det", async () => {
  await seedProject();
  const db = customerDb();
  await assertFails(setDoc(doc(db, "projects/p1/access/kunde1"), { token: "feil" }));
  await assertFails(getDoc(doc(db, "projects/p1")));
  await assertSucceeds(setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" }));
  const snap = await assertSucceeds(getDoc(doc(db, "projects/p1")));
  assert.equal(snap.data().customerEmail, "secret@example.com");
});

test("kunde kan bare opprette ventende innlegg og vurdering", async () => {
  await seedProject();
  const db = customerDb();
  await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
  const items = collection(db, "projects/p1/items");
  await assertFails(addDoc(items, {
    kind: "bilde",
    title: "x",
    text: "x",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(items, {
    kind: "kunde",
    title: "Ønske",
    text: "Vil ha hekk",
    approved: true,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  }));
  const post = await assertSucceeds(addDoc(items, {
    kind: "kunde",
    title: "Ønske",
    text: "Vil ha hekk",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(post, { approved: true }));
  await assertSucceeds(addDoc(items, {
    kind: "vurdering",
    title: "",
    text: "Fint",
    stars: 5,
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(items, {
    kind: "vurdering",
    title: "",
    text: "Fint",
    stars: 9,
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  }));
});

test("kunde kan legge bilde og kommentar på eget ventende innlegg, ikke på andres", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/items/admin-item"), {
      kind: "bilde",
      title: "",
      text: "Internt",
      approved: true,
      reference: false,
      source: "admin",
      createdBy: "admin-user",
    });
    await setDoc(doc(db, "projects/p1/items/hidden"), {
      kind: "bilde",
      title: "",
      text: "Skjult",
      approved: false,
      source: "admin",
      createdBy: "admin-user",
    });
  });
  const db = customerDb();
  await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
  await assertSucceeds(getDoc(doc(db, "projects/p1/items/admin-item")));
  await assertFails(getDoc(doc(db, "projects/p1/items/hidden")));
  const own = await addDoc(collection(db, "projects/p1/items"), {
    kind: "kunde",
    title: "",
    text: "Bilde kommer",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    authorName: "Kunde",
    createdAt: serverTimestamp(),
  });
  await assertSucceeds(addDoc(collection(db, "projects/p1/items", own.id, "photos"), {
    url: "https://firebasestorage.googleapis.com/v0/b/demo/o/a.jpg",
    storagePath: "projects/p1/media/a.jpg",
    caption: "",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(collection(db, "projects/p1/items", own.id, "photos"), {
    url: "http://evil.example/a.jpg",
    storagePath: "projects/p1/media/c.jpg",
    caption: "",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(db, "projects/p1/items", own.id, "photos"), {
    url: "http://127.0.0.1:9199/v0/b/demo/o/a.jpg?alt=media&token=abc",
    storagePath: "projects/p1/media/d.jpg",
    caption: "",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(collection(db, "projects/p1/items/admin-item/photos"), {
    url: "https://firebasestorage.googleapis.com/v0/b/demo/o/a.jpg",
    storagePath: "projects/p1/media/b.jpg",
    caption: "",
    approved: false,
    source: "kunde",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(db, "projects/p1/items/admin-item/comments"), {
    text: "Ser bra ut",
    source: "kunde",
    authorName: "Kunde",
    approved: false,
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(collection(db, "projects/p1/items/hidden/comments"), {
    text: "Skal ikke inn",
    source: "kunde",
    authorName: "Kunde",
    approved: false,
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
});

test("offentlig lesing er bare references, og bare admin skriver", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "references/p1"), { name: "Hage", summary: "Pent" });
    await setDoc(doc(context.firestore(), "projects/p1/items/pub"), {
      kind: "bilde",
      text: "Bilde",
      approved: true,
      reference: true,
      source: "admin",
      createdBy: "admin-user",
    });
  });
  await assertSucceeds(getDoc(doc(strangerDb(), "references/p1")));
  await assertFails(getDoc(doc(strangerDb(), "projects/p1/items/pub")));
  await assertFails(setDoc(doc(customerDb(), "references/p1"), { name: "Tull" }));
  await assertSucceeds(setDoc(doc(adminDb(), "references/p1"), { name: "Hage", summary: "Oppdatert" }));
});

test("storage: kunde med tilgang laster opp bilde, ikke PDF, og fremmede leser ikke rapporten", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1/access/kunde1"), { token: "TOK123456" });
  });
  const admin = env.authenticatedContext("admin-user", { email: "e.bors@hotmail.com" });
  const kunde = env.authenticatedContext("kunde1", { firebase: { sign_in_provider: "anonymous" } });
  const stranger = env.unauthenticatedContext();

  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/rapport/sluttrapport.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertSucceeds(getBytes(ref(kunde.storage(), "projects/p1/rapport/sluttrapport.pdf")));
  await assertFails(getBytes(ref(stranger.storage(), "projects/p1/rapport/sluttrapport.pdf")));
  await assertFails(uploadString(ref(kunde.storage(), "projects/p1/rapport/sluttrapport.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertSucceeds(uploadString(ref(kunde.storage(), "projects/p1/media/bilde.jpg"), "img", "raw", {
    contentType: "image/jpeg",
  }));
  await assertFails(uploadString(ref(kunde.storage(), "projects/p1/media/fil.txt"), "x", "raw", {
    contentType: "text/plain",
  }));
  await assertFails(getBytes(ref(stranger.storage(), "projects/p1/media/bilde.jpg")));
  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/gammelt.jpg"), "img", "raw", {
    contentType: "image/jpeg",
  }));
});

test("regelfilene slipper ikke gjennom åpen skriving", () => {
  const firestore = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  assert.equal(/allow\s+write\s*:\s*if\s+true/.test(firestore), false);
  assert.equal(/allow\s+write\s*:\s*if\s+true/.test(storage), false);
  assert.match(firestore, /e\.bors@hotmail\.com/);
  assert.match(firestore, /references\/\{projectId\}/);
});
