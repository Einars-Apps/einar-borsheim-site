import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEMPLATES,
  approvalLine,
  backAction,
  buildLocalDraft,
  buildReferenceDoc,
  dueReminderCount,
  isCompleted,
  missingTemplateSteps,
  phaseLabel,
  portalUrl,
  reminderPlan,
  reminderWhenLabel,
  trashDaysLeft,
} from "../www/js/logic.js";

const secretProject = {
  name: "Hageanlegg i skråning",
  address: "Hemmelig vei 1",
  customerName: "Kari Kundesen",
  customerEmail: "hemmelig@example.com",
  customerPhone: "99999999",
  shareToken: "HEMMELIGTOKEN",
  pdfUrl: "https://secret.example/rapport.pdf",
  reportText: "Internt notat som ikke skal ut",
  publicSummary: "Støttemur og beplantning i Asker.",
  publicLocation: "Asker",
  completedAt: "2024-06-01T12:00:00.000Z",
};

test("offentlig referanse tar ikke med kundekontakt, token eller PDF", () => {
  const doc = buildReferenceDoc(
    secretProject,
    [
      {
        id: "a",
        kind: "bilde",
        title: "",
        text: "Ferdig bed",
        approved: true,
        reference: true,
        createdAt: "2024-06-01T12:00:00.000Z",
      },
      {
        id: "b",
        kind: "bilde",
        text: "Ikke offentlig",
        approved: true,
        reference: false,
      },
      {
        id: "c",
        kind: "vurdering",
        stars: 5,
        text: "Ble veldig fint",
        approved: true,
        reference: true,
      },
      {
        id: "d",
        kind: "vurdering",
        stars: 1,
        text: "Ikke godkjent",
        approved: false,
        reference: true,
      },
    ],
    {
      a: [{ url: "https://cdn.example/a.jpg", caption: "Beddet", approved: true, lat: 59.8335, lon: 10.4352, accuracyM: 5 }],
      b: [{ url: "https://cdn.example/hemmelig.jpg", caption: "Skal ikke med", approved: true }],
      a2: [{ url: "http://usikker.example/a.jpg", approved: true }],
    }
  );

  const raw = JSON.stringify(doc);
  for (const secret of ["Hemmelig vei", "hemmelig@example.com", "99999999", "HEMMELIGTOKEN", "secret.example", "Internt notat", "Ikke offentlig", "hemmelig.jpg", "Ikke godkjent"]) {
    assert.equal(raw.includes(secret), false, secret);
  }
  assert.equal(doc.name, "Hageanlegg i skråning");
  assert.equal(doc.location, "Asker");
  assert.equal(doc.summary, "Støttemur og beplantning i Asker.");
  assert.equal(doc.photos.length, 1);
  assert.equal(doc.photos[0].url, "https://cdn.example/a.jpg");
  assert.equal(doc.ratingCount, 1);
  assert.equal(doc.ratingAvg, 5);
  assert.equal(Object.hasOwn(doc, "shareToken"), false);
  assert.equal(Object.hasOwn(doc, "customerEmail"), false);
  assert.equal(Object.hasOwn(doc, "pdfUrl"), false);
  assert.equal(raw.includes("59.8335"), false);
  assert.equal(raw.includes("10.4352"), false);
});

test("offentlig referanse og utkast viser bare beste bilde", () => {
  const item = {
    id: "a",
    kind: "bilde",
    title: "",
    text: "Grøft",
    step: "Grøft",
    approved: true,
    reference: true,
    createdAt: "2024-06-01T12:00:00.000Z",
  };
  const photos = {
    a: [
      { id: "1", url: "https://cdn.example/skjevt.jpg", caption: "skjevt", approved: true, createdAt: "2024-06-01T12:00:00.000Z" },
      { id: "2", url: "https://cdn.example/beste.jpg", caption: "Grøft", approved: true, best: true, createdAt: "2024-06-01T12:00:20.000Z" },
      { id: "3", url: "https://cdn.example/slettet.jpg", caption: "borte", approved: true, trashed: true, best: true, createdAt: "2024-06-01T12:00:30.000Z" },
    ],
  };
  const doc = buildReferenceDoc(secretProject, [item], photos);
  assert.deepEqual(doc.photos.map((photo) => photo.url), ["https://cdn.example/beste.jpg"]);
  const onlyAlternate = buildReferenceDoc(secretProject, [
    item,
    { id: "b", kind: "bilde", text: "Grøft", step: "Grøft", approved: true, reference: false },
  ], {
    a: [{ id: "1", url: "https://cdn.example/skjevt.jpg", caption: "Grøft", approved: true, createdAt: "2024-06-01T12:00:00.000Z" }],
    b: [{ id: "2", url: "https://cdn.example/beste.jpg", caption: "Grøft", approved: true, best: true, createdAt: "2024-06-01T12:00:10.000Z" }],
  });
  assert.equal(onlyAlternate.photos.length, 0);
  const draft = buildLocalDraft({ name: "Grøft" }, [item], { photosByItem: photos });
  assert.match(draft, /Bilder: 1/);
  assert.equal(draft.includes("skjevt"), false);
  assert.equal(draft.includes("borte"), false);
  assert.equal(draft.includes("slettet.jpg"), false);
});

test("påminnelser faller ett og to år etter ferdigdato", () => {
  const completed = new Date("2024-01-15T12:00:00");
  const project = { completedAt: completed, reminder1Done: false, reminder2Done: false };
  const early = reminderPlan(project, new Date("2024-06-01T12:00:00"));
  assert.equal(early[0].state, "scheduled");
  assert.equal(early[1].state, "scheduled");

  const afterOneYear = reminderPlan(project, new Date("2025-01-16T12:00:00"));
  assert.equal(afterOneYear[0].state, "due");
  assert.equal(afterOneYear[1].state, "scheduled");
  assert.match(reminderWhenLabel(afterOneYear[0]), /overtid|Forfalt/);

  const followedUp = reminderPlan({ ...project, reminder1Done: true }, new Date("2025-02-01T12:00:00"));
  assert.equal(followedUp[0].state, "done");
  assert.equal(dueReminderCount([{ ...project }, { completedAt: null }], new Date("2024-02-01T12:00:00")), 0);
  assert.equal(dueReminderCount([project], new Date("2026-02-01T12:00:00")), 2);
  assert.deepEqual(reminderPlan({ completedAt: { seconds: Math.floor(completed.getTime() / 1000) } }, new Date("2024-02-01")).length, 2);
});

test("utkast fra notater tar med godkjente punkt og hopper over ventende", () => {
  const draft = buildLocalDraft(
    { name: "Skråning", address: "Eriksvei 1", customerName: "Ola" },
    [
      { id: "1", kind: "endring", title: "Ekstra trapp", text: "Kunden ville ha ett trinn til", approved: true, createdAt: "2024-05-02T08:00:00Z" },
      { id: "2", kind: "avvik", title: "Tele i massene", text: "Måtte grave dypere", approved: true },
      { id: "3", kind: "kunde", title: "", text: "Ventende beskjed", approved: false },
    ],
    {
      photosByItem: { 1: [{ caption: "Trappen" }] },
      commentsByItem: { 2: [{ text: "Avklart med kunde", approved: true, createdAt: "2024-05-03T08:00:00Z" }] },
    }
  );
  assert.match(draft, /Ekstra trapp/);
  assert.match(draft, /Tele i massene/);
  assert.match(draft, /Trappen/);
  assert.match(draft, /Avklart med kunde/);
  assert.equal(draft.includes("Ventende beskjed"), false);
});

test("pågår, tilbud, fullført og papirkurv leser begge statusord", () => {
  assert.equal(isCompleted({ status: "fullfort" }), true);
  assert.equal(isCompleted({ status: "done" }), true);
  assert.equal(isCompleted({ status: "active" }), false);
  assert.equal(isCompleted({ status: "aktiv" }), false);
  assert.equal(phaseLabel({ status: "tilbud" }), "Tilbud");
  assert.equal(phaseLabel({ status: "active" }), "Pågår");
  assert.equal(phaseLabel({ status: "done" }), "Fullført");
  assert.equal(phaseLabel({ status: "aktiv", trashed: true }), "I papirkurven");
  const trashedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(trashDaysLeft({ trashed: true, trashedAt }, new Date("2026-01-11T00:00:00Z")), 80);
  assert.equal(trashDaysLeft({ trashed: false }), null);
});

test("bildemal og godkjenning", () => {
  const drenering = DEFAULT_TEMPLATES.find((template) => template.id === "drenering");
  assert.deepEqual(drenering.steps, ["Før", "Grøft", "Rør/duk", "Tilbakefylling", "Ferdig"]);
  const missing = missingTemplateSteps(drenering.steps, [
    { kind: "bilde", step: "Før", approved: true },
    { kind: "bilde", step: "Grøft", approved: false },
  ]);
  assert.deepEqual(missing, ["Grøft", "Rør/duk", "Tilbakefylling", "Ferdig"]);
  const line = approvalLine({
    approvalRequested: true,
    approvalStatus: "godkjent",
    approvedByName: "Kari",
    approvedAt: "2026-03-02T10:00:00Z",
  });
  assert.match(line, /Godkjent av kunde \(Kari\)/);
  assert.match(buildLocalDraft({ name: "Drenering" }, [{
    id: "1",
    kind: "tilbud",
    title: "Ekstra kummer",
    text: "To kummer til",
    approved: true,
    approvalRequested: true,
    approvalStatus: "godkjent",
    approvedByName: "Kari",
    approvedAt: "2026-03-02T10:00:00Z",
  }]), /Ekstra kummer/);
});

test("tilbake går ett steg og minimerer bare fra starten", () => {
  assert.equal(backAction({ route: "item", depth: 4, overlay: true, native: true }), "overlay");
  assert.equal(backAction({ route: "section", depth: 3, overlay: false, native: true }), "pop");
  assert.equal(backAction({ route: "project", depth: 2, overlay: false, native: true }), "pop");
  assert.equal(backAction({ route: "reminders", depth: 1, overlay: false, native: true }), "root");
  assert.equal(backAction({ route: "capture", depth: 2, overlay: false, native: true }), "pop");
  assert.equal(backAction({ route: "projects", depth: 1, overlay: false, native: true }), "minimize");
  assert.equal(backAction({ route: "login", depth: 1, overlay: false, native: true }), "minimize");
  assert.equal(backAction({ route: "projects", depth: 1, overlay: false, native: false }), "leave");
  assert.equal(backAction({ route: "projects", depth: 3, overlay: false, native: true }), "pop");
});

test("portallenke har prosjekt og token", () => {
  const url = new URL(portalUrl("abc", "tok 1"));
  assert.equal(url.searchParams.get("p"), "abc");
  assert.equal(url.searchParams.get("t"), "tok 1");
  assert.match(url.pathname, /kunde/);
});
