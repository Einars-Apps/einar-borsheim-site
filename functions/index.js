const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

const fikenToken = defineSecret("FIKEN_API_TOKEN");
const fikenCompany = defineSecret("FIKEN_COMPANY_SLUG");
const FIKEN_ADMIN = "e.bors@hotmail.com";

initializeApp();
setGlobalOptions({ region: "europe-west1" });

async function notifyAdmin(title, body, projectId) {
  const db = getFirestore();
  const devices = await db.collection("adminDevices").get();
  const tokens = devices.docs.map((doc) => doc.get("token")).filter(Boolean);
  if (!tokens.length) return;
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title, body: String(body || "").slice(0, 180) },
    data: { projectId: projectId || "" },
  });
  const stale = [];
  response.responses.forEach((result, index) => {
    const code = result.error?.code || "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
      stale.push(tokens[index].replace(/[^A-Za-z0-9]/g, "").slice(0, 80));
    }
  });
  await Promise.all(stale.filter(Boolean).map((id) => db.collection("adminDevices").doc(id).delete().catch(() => {})));
}

exports.onCustomerMessage = onDocumentCreated("projects/{projectId}/messages/{messageId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.sender !== "customer") return;
  await notifyAdmin("Ny melding fra kunde", data.text || "Nytt bilde i meldingen", event.params.projectId);
});

exports.onCustomerDocument = onDocumentCreated("projects/{projectId}/documents/{docId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.source !== "customer") return;
  await notifyAdmin("Nytt dokument fra kunde", data.name || "Dokument", event.params.projectId);
});

exports.onCustomerItem = onDocumentCreated("projects/{projectId}/items/{itemId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.source !== "kunde") return;
  const title = data.kind === "vurdering" ? "Ny vurdering fra kunde" : "Nytt fra kunde";
  await notifyAdmin(title, data.title || data.text || "Opplasting", event.params.projectId);
});

exports.onCustomerItemPhoto = onDocumentCreated("projects/{projectId}/items/{itemId}/photos/{photoId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.source !== "kunde") return;
  await notifyAdmin("Nytt bilde fra kunde", data.caption || "Bilde i prosjektet", event.params.projectId);
});

exports.onCustomerDecision = onDocumentUpdated("projects/{projectId}/items/{itemId}", async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  if (before.approvalStatus === after.approvalStatus) return;
  if (after.approvalStatus !== "godkjent" && after.approvalStatus !== "avslatt") return;
  const choice = (after.alternatives || []).find((alternative) => alternative.id === after.selectedAlternativeId);
  const title = after.approvalStatus === "godkjent" ? "Godkjent av kunde" : "Avslått av kunde";
  const body = `${after.title || "Post"}${choice?.name ? `: ${choice.name}` : ""}`;
  await notifyAdmin(title, body, event.params.projectId);
});

exports.onLegacyCustomerPhoto = onDocumentCreated("projects/{projectId}/photos/{photoId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.approved !== false) return;
  await notifyAdmin("Nytt bilde fra kunde", data.caption || "Bilde i prosjektet", event.params.projectId);
});

function fikenErrorMessage(body, status) {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  if (body && typeof body === "object") {
    return String(body.message || body.error_description || body.error || `Fiken svarte ${status}`).slice(0, 300);
  }
  return `Fiken svarte ${status}`;
}

async function fikenRequest(token, path, options = {}) {
  const response = await fetch(`https://api.fiken.no/api/v2${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body,
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text;
    }
  }
  if (!response.ok) {
    throw new HttpsError("failed-precondition", fikenErrorMessage(body, response.status));
  }
  return { body, location: response.headers.get("location") || "" };
}

function idFromLocation(location, marker) {
  const match = String(location || "").match(new RegExp(`${marker}/(\\d+)`));
  return match ? Number(match[1]) : null;
}

function fikenAddress(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const match = text.match(/^(.*?)[\s,]+(\d{4})\s+(.+)$/);
  if (!match) return { streetAddress: text || undefined, country: "Norway" };
  return {
    streetAddress: match[1].trim(),
    postCode: match[2],
    city: match[3].trim(),
    country: "Norway",
  };
}

function draftLines(lines, incomeAccount) {
  if (!Array.isArray(lines) || !lines.length) {
    throw new HttpsError("invalid-argument", "Det er ingen linjer med antall.");
  }
  const account = /^\d{3,6}$/.test(String(incomeAccount || "")) ? String(incomeAccount) : "3000";
  return lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpsError("invalid-argument", "Antall må være et tall over null.");
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isInteger(unitPrice)) {
      throw new HttpsError("invalid-argument", "Enhetspris må være hele øre.");
    }
    return {
      description: String(line.description || "Linje").slice(0, 200),
      quantity,
      unitPrice,
      vatType: "HIGH",
      incomeAccount: account,
    };
  });
}

async function customerId(token, slug, { name, email, address }) {
  const customerName = String(name || "").trim();
  if (!customerName) throw new HttpsError("invalid-argument", "Prosjektet mangler kundenavn.");
  const query = new URLSearchParams({ name: customerName, customer: "true" });
  const found = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/contacts?${query}`);
  const list = Array.isArray(found.body) ? found.body : [];
  const exact = list.find((item) => String(item.name || "").trim().toLowerCase() === customerName.toLowerCase());
  if (exact?.contactId) return exact.contactId;
  const created = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/contacts`, {
    method: "POST",
    body: JSON.stringify({
      name: customerName.slice(0, 200),
      customer: true,
      email: String(email || "").trim() || undefined,
      address: fikenAddress(address),
    }),
  });
  const id = idFromLocation(created.location, "contacts");
  if (!id) throw new HttpsError("internal", "Fiken opprettet kunden uten å gi tilbake en id.");
  return id;
}

exports.createFikenDraft = onCall({
  secrets: [fikenToken, fikenCompany],
  region: "europe-west1",
}, async (request) => {
  const email = String(request.auth?.token?.email || "").toLowerCase();
  if (email !== FIKEN_ADMIN) {
    throw new HttpsError("permission-denied", "Bare admin kan opprette utkast i Fiken.");
  }
  const token = fikenToken.value();
  const slug = String(fikenCompany.value() || "").trim();
  if (!token || !slug) {
    throw new HttpsError("failed-precondition", "Fiken-token eller firmaslug mangler.");
  }
  const data = request.data || {};
  const kind = data.kind === "faktura" ? "faktura" : data.kind === "tilbud" ? "tilbud" : "";
  if (!kind) throw new HttpsError("invalid-argument", "Velg tilbud eller faktura.");
  const lines = draftLines(data.lines, data.incomeAccount);
  const contact = await customerId(token, slug, data);
  const created = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/${kind === "faktura" ? "invoices" : "offers"}/drafts`, {
    method: "POST",
    body: JSON.stringify({
      type: kind === "faktura" ? "invoice" : "offer",
      customerId: contact,
      daysUntilDueDate: 14,
      issueDate: new Date().toISOString().slice(0, 10),
      currency: "NOK",
      invoiceText: String(data.title || "Drenering").slice(0, 500),
      lines,
    }),
  });
  const label = kind === "faktura" ? "Fakturautkast" : "Tilbudsutkast";
  return {
    ok: true,
    kind,
    location: created.location,
    message: `${label} er opprettet i Fiken. Det ligger som utkast og er ikke bokført.`,
  };
});
