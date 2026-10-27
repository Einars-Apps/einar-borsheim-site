import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { leadDocument, leadError, leadFileName, leadId, LEAD_MAX_BYTES } from "../www/js/lead.js";

const pages = [
  "index.html",
  "drenering/index.html",
  "graving/index.html",
  "sprengning/index.html",
  "personvern/index.html",
  "referanser/index.html",
];

test("henvendelsen krever navn, telefon, sted og tekst, og slipper tom e-post", () => {
  const ok = {
    name: "Kari Nord",
    phone: "905 52 065",
    email: "",
    place: "Bærum",
    text: "Fuktig kjeller etter regn.",
  };
  assert.equal(leadError(ok), "");
  assert.equal(leadError({ ...ok, name: "A" }), "Skriv navnet ditt.");
  assert.equal(leadError({ ...ok, phone: "123" }), "Skriv et telefonnummer.");
  assert.equal(leadError({ ...ok, email: "ikke-epost" }), "E-postadressen ser ikke riktig ut.");
  assert.equal(leadError({ ...ok, place: " " }), "Skriv sted eller kommune.");
  assert.equal(leadError({ ...ok, text: "He" }), "Skriv en kort beskrivelse.");
  assert.equal(leadError({ ...ok, file: { type: "image/gif", size: 10 } }), "Bildet må være JPEG, PNG eller WebP.");
  assert.equal(leadError({ ...ok, file: { type: "image/jpeg", size: LEAD_MAX_BYTES + 1 } }), "Bildet er for stort. Maks 8 MB.");
  const doc = leadDocument({ id: "abcdefghij1234567890", ...ok, email: "kari@example.com" });
  assert.equal(doc.email, "kari@example.com");
  assert.equal(Object.hasOwn(leadDocument({ id: "abcdefghij1234567890", ...ok }), "email"), false);
  assert.equal(Object.hasOwn(doc, "storagePath"), false);
  const withPhoto = leadDocument({
    id: "abcdefghij1234567890",
    ...ok,
    fileName: "bilde.jpg",
    contentType: "image/jpeg",
  });
  assert.equal(withPhoto.storagePath, "henvendelser/abcdefghij1234567890/bilde.jpg");
  assert.equal(leadFileName("Mitt bilde.PNG", "image/png"), "Mittbilde.PNG");
  assert.equal(leadFileName("", "image/webp"), "bilde.webp");
  assert.match(leadId(), /^[A-Za-z0-9]{20}$/);
});

test("reglene lar hvem som helst opprette henvendelse, og bare admin lese", () => {
  const firestore = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  const fireStart = firestore.indexOf("match /henvendelser/{id}");
  const fireBlock = firestore.slice(fireStart, fireStart + 280);
  assert.match(fireBlock, /allow create: if id\.matches\('\^\[A-Za-z0-9\]\{16,32\}\$'\) && validHenvendelse\(id\)/);
  assert.match(fireBlock, /allow read: if isAdmin\(\)/);
  assert.match(fireBlock, /allow update, delete: if false/);
  assert.match(firestore, /e\.bors@hotmail\.com/);
  assert.match(firestore, /createdAt == request\.time/);
  assert.match(firestore, /image\/\(jpeg\|png\|webp\)/);
  const storageBlock = storage.slice(storage.indexOf("match /henvendelser/{id}/{fileName}"));
  assert.match(storageBlock, /allow read: if isAdmin\(\)/);
  assert.match(storageBlock, /request\.resource\.size < 8 \* 1024 \* 1024/);
  assert.match(storageBlock, /allow update, delete: if false/);
  assert.equal(/allow\s+write\s*:\s*if\s+true/.test(firestore), false);
  assert.equal(/allow\s+read\s*:\s*if\s+true/.test(storageBlock), false);
});

test("nettsiden har tjenestesider, skjema, samtykke og området", () => {
  const html = Object.fromEntries(pages.map((path) => [path, readFileSync(path, "utf8")]));
  const home = html["index.html"];
  assert.match(home, /href="drenering\/"/);
  assert.match(home, /href="graving\/"/);
  assert.match(home, /href="sprengning\/"/);
  assert.match(home, /href="tel:\+4790552065"/);
  assert.match(home, /Ring 905 52 065/);
  assert.match(home, /class="call-bar"/);
  assert.match(home, /id="henvendelse"/);
  assert.match(home, /name="place"/);
  assert.match(home, /Asker, Bærum, Lier og Oslo/);
  assert.match(home, /"@type": "LocalBusiness"/);
  assert.match(home, /G-XCQTBQVK7C/);
  assert.equal(home.includes("Asker og omegn"), false);
  for (const path of ["drenering/index.html", "graving/index.html", "sprengning/index.html"]) {
    assert.match(html[path], /Be om tilbud/);
    assert.match(html[path], /id="henvendelse"/);
    assert.match(html[path], /Asker, Bærum, Lier og Oslo/);
    assert.match(html[path], /"@type": "LocalBusiness"/);
    assert.match(html[path], /<title>[^<]+ \| Einar A Børsheim<\/title>/);
    assert.match(html[path], /name="description"/);
  }
  assert.match(html["drenering/index.html"], /Slik jobber vi/);
  assert.match(html["personvern/index.html"], /G-XCQTBQVK7C/);
  assert.match(html["personvern/index.html"], /henvendelser/);
  const samtykke = readFileSync("samtykke.js", "utf8");
  assert.match(samtykke, /ad_storage: "denied"/);
  assert.match(samtykke, /analytics_storage: "denied"/);
  assert.match(samtykke, /G-XCQTBQVK7C/);
  assert.match(samtykke, /AW-18535455222/);
  const script = readFileSync("script.js", "utf8");
  assert.match(script, /klikk_telefon/);
  assert.match(script, /klikk_epost/);
  assert.match(script, /consentChoice/);
  assert.equal(script.includes("let stored"), false);
  assert.match(readFileSync("henvendelse.js", "utf8"), /generate_lead/);
  const joined = Object.values(html).join("\n") + samtykke;
  assert.equal(joined.includes("1000 kr"), false);
  assert.equal(/kr per meter/i.test(joined), false);
  const app = readFileSync("www/app.js", "utf8");
  assert.match(app, /collection\("henvendelser"\)\.orderBy\("createdAt", "desc"\)/);
  assert.match(app, /henvendelser: mountHenvendelser/);
});
