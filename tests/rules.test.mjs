import { readFileSync } from "node:fs";
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
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

test("meldinger og dokumenter er bare for admin og kunden med lenke", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/messages/m1"), { text: "Hei", sender: "admin" });
    await setDoc(doc(db, "projects/p1/documents/d1"), {
      name: "Tegning",
      approved: true,
      source: "admin",
      url: "https://example.com/tegning.pdf",
    });
    await setDoc(doc(db, "projects/p1/documents/pending"), {
      name: "Fra kunde",
      approved: false,
      source: "customer",
      uploadedBy: "kunde",
    });
  });
  const kunde = customerDb();
  const stranger = strangerDb();
  await assertSucceeds(getDoc(doc(kunde, "projects/p1/messages/m1")));
  await assertSucceeds(getDoc(doc(kunde, "projects/p1/documents/d1")));
  await assertSucceeds(getDoc(doc(kunde, "projects/p1/documents/pending")));
  await assertFails(getDoc(doc(stranger, "projects/p1/messages/m1")));
  await assertFails(getDoc(doc(stranger, "projects/p1/documents/d1")));
  await assertSucceeds(addDoc(collection(kunde, "projects/p1/messages"), {
    text: "Vi er hjemme",
    sender: "customer",
    createdAt: serverTimestamp(),
  }));
  await assertFails(addDoc(collection(kunde, "projects/p1/messages"), {
    text: "Jeg er admin",
    sender: "admin",
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(adminDb(), "projects/p1/messages"), {
    text: "Kommer i morgen",
    sender: "admin",
    createdAt: serverTimestamp(),
  }));
});

test("kunde kan godkjenne et tilbud, ikke et skjult punkt", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/items/tilbud1"), {
      kind: "tilbud",
      title: "Drenering",
      text: "Rundt huset",
      approved: true,
      approvalRequested: true,
      approvalStatus: "venter",
      source: "admin",
    });
    await setDoc(doc(db, "projects/p1/items/hidden-offer"), {
      kind: "endring",
      title: "Skjult",
      text: "Ikke vist",
      approved: false,
      approvalRequested: true,
      approvalStatus: "venter",
      source: "admin",
    });
  });
  const db = customerDb();
  await assertSucceeds(updateDoc(doc(db, "projects/p1/items/tilbud1"), {
    approvalStatus: "godkjent",
    approvedAt: serverTimestamp(),
    approvedBy: "kunde1",
    approvedByName: "Kari",
  }));
  await assertFails(updateDoc(doc(db, "projects/p1/items/hidden-offer"), {
    approvalStatus: "godkjent",
    approvedAt: serverTimestamp(),
    approvedBy: "kunde1",
    approvedByName: "Kari",
  }));
  await assertFails(updateDoc(doc(db, "projects/p1/items/tilbud1"), { text: "Endret tekst" }));
  await assertFails(updateDoc(doc(db, "projects/p1/items/tilbud1"), {
    alternatives: [{ id: "a", name: "Dyrere", priceExVat: 99999 }],
  }));
});

test("kunde kan velge alternativ, ikke endre prisen", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/items/valg1"), {
      kind: "tillegg",
      title: "Brønn",
      text: "To løsninger",
      approved: true,
      approvalRequested: true,
      approvalStatus: "venter",
      source: "admin",
      alternatives: [
        { id: "standard", name: "Standard", description: "Inkludert", priceExVat: 0 },
        { id: "anbefalt", name: "Anbefalt løsning", description: "Med brønn", priceExVat: 4500 },
      ],
    });
  });
  const db = customerDb();
  await assertFails(updateDoc(doc(db, "projects/p1/items/valg1"), {
    alternatives: [{ id: "anbefalt", name: "Anbefalt løsning", priceExVat: 1 }],
  }));
  await assertFails(updateDoc(doc(db, "projects/p1/items/valg1"), {
    approvalStatus: "godkjent",
    approvedAt: serverTimestamp(),
    approvedBy: "kunde1",
    approvedByName: "Kari",
    selectedAlternativeId: "finnes-ikke",
  }));
  await assertSucceeds(updateDoc(doc(db, "projects/p1/items/valg1"), {
    approvalStatus: "godkjent",
    approvedAt: serverTimestamp(),
    approvedBy: "kunde1",
    approvedByName: "Kari",
    selectedAlternativeId: "anbefalt",
  }));
});

test("drenering leses av admin, kunde og offentlig prosjekt", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/drainage/s1"), { name: "Nordvegg", verdict: "gronn" });
    await setDoc(doc(db, "projects/p2"), { name: "Skjult", shareToken: "TOK999999", public: false });
    await setDoc(doc(db, "projects/p2/drainage/s1"), { name: "Hemmelig" });
  });
  await assertSucceeds(getDoc(doc(customerDb(), "projects/p1/drainage/s1")));
  await assertSucceeds(getDoc(doc(strangerDb(), "projects/p1/drainage/s1")));
  await assertFails(setDoc(doc(customerDb(), "projects/p1/drainage/s2"), { name: "Kunde" }));
  await assertSucceeds(setDoc(doc(adminDb(), "projects/p1/drainage/s2"), { name: "Sørvegg" }));
  await assertFails(getDoc(doc(strangerDb(), "projects/p2/drainage/s1")));
  await assertFails(getDoc(doc(customerDb(), "settings/app")));
});

test("kunde kan lese mengder bare når Einar har skrudd det på, og kan ikke skrive dem", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(context.firestore(), "projects/p1/quantities/live"), {
      agreedExVat: 10000,
      lines: { groft: { planned: 40, done: 28, unitPrice: 350 } },
    });
    await setDoc(doc(context.firestore(), "projects/p1/costLog/log1"), {
      at: new Date(),
      by: "admin-user",
      byName: "Einar",
      lineId: "groft",
      label: "Grøft",
      field: "done",
      from: 0,
      to: 28,
      unit: "m",
      text: "Grøft, utført: 0 → 28 m",
    });
  });
  const customer = customerDb();
  await assertFails(getDoc(doc(customer, "projects/p1/quantities/live")));
  await assertFails(getDoc(doc(customer, "projects/p1/costLog/log1")));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), "projects/p1"), { showCostToCustomer: true });
  });
  const snap = await assertSucceeds(getDoc(doc(customer, "projects/p1/quantities/live")));
  assert.equal(snap.data().agreedExVat, 10000);
  await assertSucceeds(getDoc(doc(customer, "projects/p1/costLog/log1")));
  await assertFails(setDoc(doc(customer, "projects/p1/quantities/live"), { agreedExVat: 1 }));
  await assertFails(updateDoc(doc(customer, "projects/p1"), { costOverview: { agreedExVat: 1 } }));
  await assertFails(addDoc(collection(customer, "projects/p1/costLog"), {
    at: serverTimestamp(),
    by: "kunde1",
    byName: "Kari",
    lineId: "groft",
    label: "Grøft",
    field: "done",
    from: 0,
    to: 99,
    unit: "m",
    text: "Grøft, utført: 0 → 99 m",
  }));
  await assertSucceeds(setDoc(doc(adminDb(), "projects/p1/quantities/live"), {
    agreedExVat: 12000,
    lines: { groft: { planned: 40, done: 30, unitPrice: 350 } },
  }));
  await assertSucceeds(addDoc(collection(adminDb(), "projects/p1/costLog"), {
    at: serverTimestamp(),
    by: "admin-user",
    byName: "Einar",
    lineId: "groft",
    label: "Grøft",
    field: "done",
    from: 28,
    to: 30,
    unit: "m",
    text: "Grøft, utført: 28 → 30 m",
  }));
  await assertSucceeds(addDoc(collection(adminDb(), "projects/p1/costLog"), {
    at: serverTimestamp(),
    by: "admin-user",
    byName: "Einar",
    lineId: "ta-en",
    label: "Ekstra kumlokk",
    field: "quantity",
    from: 0,
    to: 2,
    unit: "stk",
    text: "Ekstra kumlokk, antall: 0 → 2 stk",
  }));
  await assertFails(addDoc(collection(adminDb(), "projects/p1/costLog"), {
    at: serverTimestamp(),
    by: "noen-annen",
    byName: "Einar",
    lineId: "groft",
    label: "Grøft",
    field: "done",
    from: 1,
    to: 2,
    unit: "m",
    text: "feil bruker",
  }));
});

test("Fiken-tilbudet kan bare leses og skrives av admin", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(context.firestore(), "projects/p1/fikenOffers/ft-5"), { number: "10001" });
  });
  await assertFails(getDoc(doc(customerDb(), "projects/p1/fikenOffers/ft-5")));
  await assertFails(setDoc(doc(customerDb(), "projects/p1/fikenOffers/ft-9"), { number: "1" }));
  const snap = await assertSucceeds(getDoc(doc(adminDb(), "projects/p1/fikenOffers/ft-5")));
  assert.equal(snap.data().number, "10001");
  await assertSucceeds(setDoc(doc(adminDb(), "projects/p1/fikenOffers/ft-5"), { number: "10002", comment: "Nordvegg" }));
});

test("e-postkø og maler er bare for admin", async () => {
  await assertFails(getDoc(doc(strangerDb(), "mail/x")));
  await assertFails(addDoc(collection(customerDb(), "mail"), {
    to: "a@b.no",
    message: { subject: "Hei", text: "Tekst" },
    createdAt: serverTimestamp(),
  }));
  await assertSucceeds(addDoc(collection(adminDb(), "mail"), {
    to: "kunde@example.com",
    message: { subject: "Rapport", text: "Klar" },
    createdAt: serverTimestamp(),
  }));
  await assertFails(getDoc(doc(strangerDb(), "photoTemplates/drenering")));
  await assertSucceeds(setDoc(doc(adminDb(), "photoTemplates/drenering"), { name: "Drenering", steps: ["Før"] }));
});

test("kunde kan ikke hente et bilde som ligger i papirkurven", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/items/admin-item"), {
      kind: "bilde",
      title: "",
      text: "Grøft",
      approved: true,
      source: "admin",
      createdBy: "admin-user",
    });
    await setDoc(doc(db, "projects/p1/items/admin-item/photos/ok"), {
      url: "https://firebasestorage.googleapis.com/v0/b/demo/o/ok.jpg",
      approved: true,
      source: "admin",
      createdBy: "admin-user",
    });
    await setDoc(doc(db, "projects/p1/items/admin-item/photos/gone"), {
      url: "https://firebasestorage.googleapis.com/v0/b/demo/o/gone.jpg",
      approved: true,
      trashed: true,
      source: "admin",
      createdBy: "admin-user",
    });
    await setDoc(doc(db, "projects/p1/photos/legacy-ok"), {
      url: "https://cdn.example/ok.jpg",
      approved: true,
    });
    await setDoc(doc(db, "projects/p1/photos/legacy-gone"), {
      url: "https://cdn.example/gone.jpg",
      approved: true,
      trashed: true,
    });
  });
  const db = customerDb();
  await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
  await assertSucceeds(getDoc(doc(db, "projects/p1/items/admin-item/photos/ok")));
  await assertFails(getDoc(doc(db, "projects/p1/items/admin-item/photos/gone")));
  await assertSucceeds(getDoc(doc(db, "projects/p1/photos/legacy-ok")));
  await assertFails(getDoc(doc(db, "projects/p1/photos/legacy-gone")));
  await assertFails(getDoc(doc(strangerDb(), "projects/p1/photos/legacy-gone")));
  await assertSucceeds(getDoc(doc(strangerDb(), "projects/p1/photos/legacy-ok")));
  const listed = await assertSucceeds(getDocs(query(
    collection(db, "projects/p1/items/admin-item/photos"),
    where("approved", "==", true),
  )));
  assert.equal(listed.size, 2);
  await assertSucceeds(getDoc(doc(adminDb(), "projects/p1/items/admin-item/photos/gone")));
});

test("storage: dokumenter er ikke offentlige", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1/access/kunde1"), { token: "TOK123456" });
  });
  const kunde = env.authenticatedContext("kunde1", { firebase: { sign_in_provider: "anonymous" } });
  const stranger = env.unauthenticatedContext();
  await assertSucceeds(uploadString(ref(kunde.storage(), "projects/p1/documents/tegning.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertFails(getBytes(ref(stranger.storage(), "projects/p1/documents/tegning.pdf")));
});

test("HMS er skjult for kunden til dokumentet er delt, og papirkurven skjuler det", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/hmsDocs/skjult"), {
      name: "Intern.pdf",
      visibleToCustomer: false,
      trashed: false,
    });
    await setDoc(doc(db, "projects/p1/hmsDocs/delt"), {
      name: "Delt.pdf",
      visibleToCustomer: true,
      trashed: false,
    });
    await setDoc(doc(db, "projects/p1/hmsDocs/borte"), {
      name: "Borte.pdf",
      visibleToCustomer: true,
      trashed: true,
    });
  });
  const kunde = customerDb();
  await assertFails(getDoc(doc(kunde, "projects/p1/hmsDocs/skjult")));
  await assertSucceeds(getDoc(doc(kunde, "projects/p1/hmsDocs/delt")));
  await assertFails(getDoc(doc(kunde, "projects/p1/hmsDocs/borte")));
  await assertFails(getDoc(doc(strangerDb(), "projects/p1/hmsDocs/delt")));
  await assertFails(getDocs(collection(kunde, "projects/p1/hmsDocs")));
  await assertFails(getDocs(query(
    collection(kunde, "projects/p1/hmsDocs"),
    where("visibleToCustomer", "==", true),
  )));
  const listed = await assertSucceeds(getDocs(query(
    collection(kunde, "projects/p1/hmsDocs"),
    where("visibleToCustomer", "==", true),
    where("trashed", "==", false),
  )));
  assert.equal(listed.size, 1);
  assert.equal(listed.docs[0].id, "delt");
  await assertFails(updateDoc(doc(kunde, "projects/p1/hmsDocs/delt"), { trashed: true }));
  await assertFails(setDoc(doc(kunde, "projects/p1/hmsDocs/ny"), {
    name: "Nei",
    visibleToCustomer: true,
    trashed: false,
  }));
  await assertSucceeds(getDoc(doc(adminDb(), "projects/p1/hmsDocs/skjult")));
  await assertSucceeds(updateDoc(doc(adminDb(), "projects/p1/hmsDocs/skjult"), { visibleToCustomer: true }));
});

test("storage: HMS-filer leses av kunden bare når dokumentet er delt", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p1/hmsDocs/delt"), { visibleToCustomer: true, trashed: false });
    await setDoc(doc(db, "projects/p1/hmsDocs/skjult"), { visibleToCustomer: false, trashed: false });
    await setDoc(doc(db, "projects/p1/hmsDocs/borte"), { visibleToCustomer: true, trashed: true });
  });
  const admin = env.authenticatedContext("admin-user", { email: "e.bors@hotmail.com" });
  const kunde = env.authenticatedContext("kunde1", { firebase: { sign_in_provider: "anonymous" } });
  const stranger = env.unauthenticatedContext();
  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/hms/delt/plan.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/hms/skjult/intern.docx"), "doc", "raw", {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }));
  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/hms/delt/bilde.jpg"), "img", "raw", {
    contentType: "image/jpeg",
  }));
  await assertFails(uploadString(ref(kunde.storage(), "projects/p1/hms/delt/kunde.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertFails(uploadString(ref(admin.storage(), "projects/p1/hms/delt/virus.exe"), "x", "raw", {
    contentType: "application/octet-stream",
  }));
  await assertSucceeds(getBytes(ref(kunde.storage(), "projects/p1/hms/delt/plan.pdf")));
  await assertFails(getBytes(ref(kunde.storage(), "projects/p1/hms/skjult/intern.docx")));
  await assertFails(getBytes(ref(stranger.storage(), "projects/p1/hms/delt/plan.pdf")));
  await assertSucceeds(uploadString(ref(admin.storage(), "projects/p1/hms/borte/slettet.pdf"), "pdf", "raw", {
    contentType: "application/pdf",
  }));
  await assertFails(getBytes(ref(kunde.storage(), "projects/p1/hms/borte/slettet.pdf")));
});

test("henvendelse kan opprettes uten innlogging, og bare admin kan lese", async () => {
  const id = "abcdefghij1234567890";
  const base = {
    name: "Kari Nord",
    phone: "905 52 065",
    place: "Bærum",
    text: "Fuktig kjeller.",
    createdAt: serverTimestamp(),
  };
  const stranger = strangerDb();
  await assertSucceeds(setDoc(doc(stranger, `henvendelser/${id}`), base));
  await assertFails(getDoc(doc(stranger, `henvendelser/${id}`)));
  await assertFails(updateDoc(doc(stranger, `henvendelser/${id}`), { text: "Endret" }));
  await assertFails(setDoc(doc(stranger, "henvendelser/kort"), base));
  await assertFails(setDoc(doc(stranger, `henvendelser/${id}b`), { ...base, name: "A" }));
  const admin = adminDb();
  const snap = await assertSucceeds(getDoc(doc(admin, `henvendelser/${id}`)));
  assert.equal(snap.data().name, "Kari Nord");
  await assertFails(updateDoc(doc(admin, `henvendelser/${id}`), { text: "Endret" }));
  const open = env.unauthenticatedContext();
  const adminStorage = env.authenticatedContext("admin-user", { email: "e.bors@hotmail.com" });
  await assertSucceeds(uploadString(ref(open.storage(), `henvendelser/${id}/bilde.jpg`), "img", "raw", {
    contentType: "image/jpeg",
  }));
  await assertFails(getBytes(ref(open.storage(), `henvendelser/${id}/bilde.jpg`)));
  await assertSucceeds(getBytes(ref(adminStorage.storage(), `henvendelser/${id}/bilde.jpg`)));
  await assertFails(uploadString(ref(open.storage(), `henvendelser/${id}/fil.exe`), "x", "raw", {
    contentType: "application/octet-stream",
  }));
});

test("kunden kan ønske og svare, men ikke sette pris eller røre et annet prosjekt", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(context.firestore(), "projects/p2"), { name: "Annen", shareToken: "TOK999999" });
    await setDoc(doc(context.firestore(), "projects/p2/access/kunde2"), { token: "TOK999999" });
  });
  const customer = customerDb();
  await assertFails(addDoc(collection(customer, "projects/p1/requests"), {
    status: "ny",
    text: "Ekstra drenering",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
    unitPrice: 1,
  }));
  await assertFails(addDoc(collection(customer, "projects/p2/requests"), {
    status: "ny",
    text: "Ikke mitt prosjekt",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  const created = await assertSucceeds(addDoc(collection(customer, "projects/p1/requests"), {
    status: "ny",
    text: "Ekstra drenering langs garasjen",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(created, {
    status: "godkjent",
    decidedAt: serverTimestamp(),
    decidedBy: "kunde1",
  }));
  await assertSucceeds(updateDoc(doc(adminDb(), created.path), {
    status: "besvart",
    answer: "Jeg kan legge ni meter til.",
    postName: "Drenering (meter)",
    postId: "dren",
    unit: "meter",
    quantity: 9,
    unitPrice: 180,
  }));
  await assertFails(updateDoc(created, {
    status: "godkjent",
    decidedAt: serverTimestamp(),
    decidedBy: "kunde1",
    unitPrice: 1,
  }));
  await assertFails(updateDoc(doc(customerDb("kunde2"), created.path), {
    status: "godkjent",
    decidedAt: serverTimestamp(),
    decidedBy: "kunde2",
  }));
  await assertSucceeds(updateDoc(created, {
    status: "godkjent",
    decidedAt: serverTimestamp(),
    decidedBy: "kunde1",
  }));
  const snap = await assertSucceeds(getDoc(created));
  assert.equal(snap.data().status, "godkjent");
  assert.equal(snap.data().unitPrice, 180);
  await assertFails(getDoc(doc(customerDb("kunde2"), created.path)));
});

test("kunden skriver bare egne forespørsler, og bare admin leser alle", async () => {
  await seedProject();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "projects/p1/access/kunde1"), { token: "TOK123456" });
    await setDoc(doc(db, "projects/p2"), { name: "Annen", shareToken: "TOK999999" });
    await setDoc(doc(db, "projects/p1/jobRequests/annens"), {
      kind: "pris",
      text: "Fra en annen",
      status: "ny",
      createdBy: "kunde2",
      createdAt: new Date(),
    });
  });
  const customer = customerDb();
  const base = {
    kind: "pris",
    text: "Ni meter ekstra drenering",
    status: "ny",
    createdBy: "kunde1",
    createdAt: serverTimestamp(),
  };
  await assertFails(addDoc(collection(customer, "projects/p2/jobRequests"), base));
  await assertFails(addDoc(collection(customer, "projects/p1/jobRequests"), { ...base, unitPrice: 180 }));
  await assertFails(addDoc(collection(customer, "projects/p1/jobRequests"), { ...base, status: "tillegg" }));
  const created = await assertSucceeds(addDoc(collection(customer, "projects/p1/jobRequests"), base));
  await assertSucceeds(addDoc(collection(customer, "projects/p1/jobRequests"), { ...base, kind: "bestilling", quantity: 9 }));
  await assertFails(updateDoc(created, { status: "besvart" }));
  await assertSucceeds(getDoc(created));
  await assertFails(getDoc(doc(customer, "projects/p1/jobRequests/annens")));
  const own = await assertSucceeds(getDocs(query(
    collection(customer, "projects/p1/jobRequests"),
    where("createdBy", "==", "kunde1"),
  )));
  assert.equal(own.size, 2);
  const admin = adminDb();
  const all = await assertSucceeds(getDocs(collection(admin, "projects/p1/jobRequests")));
  assert.equal(all.size, 3);
  await assertSucceeds(updateDoc(doc(admin, created.path), { status: "besvart" }));
  await assertFails(getDocs(collection(customerDb("kunde2"), "projects/p1/jobRequests")));
});

test("regelfilene slipper ikke gjennom åpen skriving", () => {
  const firestore = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  assert.equal(/allow\s+write\s*:\s*if\s+true/.test(firestore), false);
  assert.equal(/allow\s+write\s*:\s*if\s+true/.test(storage), false);
  assert.match(firestore, /e\.bors@hotmail\.com/);
  assert.match(firestore, /references\/\{projectId\}/);
});
