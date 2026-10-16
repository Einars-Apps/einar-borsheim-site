import test from "node:test";
import assert from "node:assert/strict";
import {
  cardFromFikenProject,
  contactNeedsFetch,
  formatFikenAddress,
} from "../functions/fiken-import.js";
import {
  fieldsFromFiken,
  fikenUnreachableMessage,
  filterFikenProjects,
  isFikenLinked,
  linkedFikenIds,
  unimportedFikenProjects,
} from "../www/js/fiken-import.js";

const embedded = {
  projectId: 42,
  name: "Støttemur Asker",
  number: "P-42",
  contact: {
    contactId: 7,
    name: "Kari Nordmann",
    email: "kari@example.com",
    phoneNumber: "900 00 000",
    address: { streetAddress: "Eriksvei 13", postCode: "1386", city: "Asker" },
  },
};

test("adresse fra Fiken settes sammen av gate, postnummer og sted", () => {
  assert.equal(formatFikenAddress({ streetAddress: "Eriksvei 13", postCode: "1386", city: "Asker" }), "Eriksvei 13, 1386 Asker");
  assert.equal(formatFikenAddress({ street: "Eriksvei 13" }), "Eriksvei 13");
  assert.equal(formatFikenAddress(null), "");
});

test("innebygd kontakt brukes uten ekstra henting", () => {
  assert.equal(contactNeedsFetch(embedded), null);
  const card = cardFromFikenProject(embedded);
  assert.equal(card.customerName, "Kari Nordmann");
  assert.equal(card.customerEmail, "kari@example.com");
  assert.equal(card.customerPhone, "900 00 000");
  assert.equal(card.address, "Eriksvei 13, 1386 Asker");
  assert.equal(card.contactName, "Kari Nordmann");
  assert.equal(card.contactId, 7);
});

test("prosjekt med bare contactId henter kontakten og fyller kortet", () => {
  const project = { projectId: 9, name: "Drenering", number: "9", contactId: 15 };
  assert.equal(contactNeedsFetch(project), 15);
  assert.equal(contactNeedsFetch({ projectId: 9, contact: { contactId: 15, name: "Ola" } }), 15);
  const card = cardFromFikenProject(project, {
    contactId: 15,
    name: "Ola Nordmann",
    email: "ola@example.com",
    phoneNumber: "400 00 000",
    address: { streetAddress: "Hageveien 2", postCode: "1384", city: "Asker" },
  });
  assert.deepEqual(fieldsFromFiken(card), {
    name: "Drenering",
    customerName: "Ola Nordmann",
    customerEmail: "ola@example.com",
    customerPhone: "400 00 000",
    address: "Hageveien 2, 1384 Asker",
    fikenProjectId: 9,
    fikenProjectName: "Drenering",
    fikenProjectNumber: "9",
  });
});

test("gammel liste med bare contactName kan fortsatt fylle kundenavn", () => {
  const fields = fieldsFromFiken({ projectId: 3, name: "Tak", number: "3", contactName: "Per" });
  assert.equal(fields.customerName, "Per");
  assert.equal(fields.customerEmail, "");
  assert.equal(fields.fikenProjectId, 3);
});

test("samme fikenProjectId importeres ikke på nytt, heller ikke fra fullførte", () => {
  const local = [
    { id: "a", status: "aktiv", fikenProjectId: 42 },
    { id: "b", status: "fullfort", fikenProjectId: "9" },
    { id: "c", status: "slettet", fikenProjectId: 0 },
    { id: "d", status: "tilbud" },
  ];
  assert.deepEqual([...linkedFikenIds(local)], [42, 9]);
  assert.equal(isFikenLinked(local, 9), true);
  assert.equal(isFikenLinked(local, "42"), true);
  const cards = [
    { projectId: 42, name: "Allerede inne" },
    { projectId: 9, name: "Fullført" },
    { projectId: 11, name: "Ny" },
  ];
  assert.deepEqual(unimportedFikenProjects(cards, local).map((card) => card.projectId), [11]);
});

test("søk treffer navn, nummer og kunde", () => {
  const cards = [
    { name: "Støttemur", number: "P-1", customerName: "Kari", address: "Asker" },
    { name: "Drenering", number: "P-2", contactName: "Ola", address: "Oslo" },
  ];
  assert.equal(filterFikenProjects(cards, "  ola ").length, 1);
  assert.equal(filterFikenProjects(cards, "p-1")[0].name, "Støttemur");
  assert.equal(filterFikenProjects(cards, "asker").length, 1);
  assert.equal(filterFikenProjects(cards, "").length, 2);
});

test("utilgjengelig Fiken får en rolig feilmelding", () => {
  assert.equal(fikenUnreachableMessage(new TypeError("Failed to fetch")), "Fikk ikke kontakt med Fiken. Prøv igjen om litt.");
  assert.equal(fikenUnreachableMessage(new Error("Fiken-funksjonen er ikke tilgjengelig")), "Fikk ikke kontakt med Fiken. Prøv igjen om litt.");
  assert.equal(fikenUnreachableMessage(new Error("Bare admin kan bruke Fiken.")), "Bare admin kan bruke Fiken.");
});
