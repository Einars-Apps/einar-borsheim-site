const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const billable = require("./fiken-billable");

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

exports.onCustomerDecision = onDocumentUpdated({
  document: "projects/{projectId}/items/{itemId}",
  secrets: [fikenToken, fikenCompany],
}, async (event) => {
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};
  if (before.approvalStatus === after.approvalStatus) return;
  if (after.approvalStatus !== "godkjent" && after.approvalStatus !== "avslatt") return;
  const choice = (after.alternatives || []).find((alternative) => alternative.id === after.selectedAlternativeId);
  const title = after.approvalStatus === "godkjent" ? "Godkjent av kunde" : "Avslått av kunde";
  const body = `${after.title || "Post"}${choice?.name ? `: ${choice.name}` : ""}`;
  await notifyAdmin(title, body, event.params.projectId);
  if (!billable.decisionBecameApproved(before, after)) return;
  try {
    await syncApprovedOffer(event.params.projectId, event.params.itemId);
  } catch (error) {
    console.error("Fiken-synk", error?.message || error);
  }
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
    throw new HttpsError("failed-precondition", fikenErrorMessage(body, response.status), { fikenStatus: response.status });
  }
  return {
    body,
    location: response.headers.get("location") || "",
    pageCount: Number(response.headers.get("fiken-api-page-count") || 0),
  };
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

function assertFikenAdmin(request) {
  const email = String(request.auth?.token?.email || "").toLowerCase();
  if (email !== FIKEN_ADMIN) {
    throw new HttpsError("permission-denied", "Bare admin kan bruke Fiken.");
  }
}

function fikenSecrets() {
  const token = fikenToken.value();
  const slug = String(fikenCompany.value() || "").trim();
  if (!token || !slug) {
    throw new HttpsError("failed-precondition", "Fiken-token eller firmaslug mangler.");
  }
  return { token, slug };
}

async function readIncomeAccount() {
  try {
    const snap = await getFirestore().collection("settings").doc("app").get();
    const value = String(snap.get("fikenIncomeAccount") || "");
    return /^\d{3,6}$/.test(value) ? value : "3000";
  } catch (error) {
    return "3000";
  }
}

async function readInvoiceDraft(token, slug, draftId) {
  try {
    const found = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/invoices/drafts/${draftId}`);
    return found.body;
  } catch (error) {
    if (error.details?.fikenStatus === 404) return null;
    throw error;
  }
}

async function listOpenProjects(token, slug) {
  const all = [];
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ completed: "false", pageSize: "100", page: String(page) });
    const found = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/projects?${query}`);
    const list = Array.isArray(found.body) ? found.body : [];
    all.push(...list);
    if (!found.pageCount || page + 1 >= found.pageCount || list.length < 100) break;
  }
  return all;
}

async function withFikenLock(projectRef, work) {
  const db = getFirestore();
  const lockRef = projectRef.collection("_meta").doc("fikenLock");
  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  let claimed = false;
  while (Date.now() - started < 15000) {
    claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const data = snap.data() || {};
      if (data.token && Date.now() - Number(data.at || 0) < 25000) return false;
      tx.set(lockRef, { token: lockToken, at: Date.now() });
      return true;
    });
    if (claimed) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!claimed) throw new HttpsError("aborted", "Fiken-prosjektet er opptatt. Prøv igjen om litt.");
  try {
    return await work();
  } finally {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      if (snap.data()?.token === lockToken) tx.delete(lockRef);
    }).catch(() => {});
  }
}

async function rememberDraft(projectRef, draftId) {
  await projectRef.set({ fikenInvoiceDraftId: draftId }, { merge: true });
}

async function upsertProjectInvoice({ token, slug, projectRef, project, itemId, line }) {
  const fikenProjectId = Number(project.fikenProjectId);
  let draftId = Number(project.fikenInvoiceDraftId) || null;
  let draft = draftId ? await readInvoiceDraft(token, slug, draftId) : null;
  if (!draft || Number(draft.projectId) !== fikenProjectId || (draft.type && draft.type !== "invoice")) {
    draft = null;
    draftId = null;
  }
  const merged = billable.appendBillableLine(draft?.lines || [], line, itemId);
  if (draft && !merged.added) return Number(draft.draftId || draftId);

  if (!draft) {
    const contact = await customerId(token, slug, {
      name: project.customerName,
      email: project.customerEmail,
      address: project.address,
    });
    const created = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/invoices/drafts`, {
      method: "POST",
      body: JSON.stringify(billable.invoiceDraftBody({
        customerId: contact,
        projectId: fikenProjectId,
        internProjectId: project.id,
        lines: merged.lines,
        issueDate: billable.osloDate(new Date()),
      })),
    });
    const createdId = idFromLocation(created.location, "drafts");
    if (!createdId) throw new HttpsError("internal", "Fiken opprettet utkastet uten å gi tilbake en id.");
    await rememberDraft(projectRef, createdId);
    return createdId;
  }

  const existingId = Number(draft.draftId || draftId);
  let contact = billable.customerIdFromDraft(draft);
  if (!contact) {
    contact = await customerId(token, slug, {
      name: project.customerName,
      email: project.customerEmail,
      address: project.address,
    });
  }
  await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/invoices/drafts/${existingId}`, {
    method: "PUT",
    body: JSON.stringify(billable.invoiceDraftBody({
      draft,
      customerId: contact,
      projectId: fikenProjectId,
      internProjectId: project.id,
      lines: merged.lines,
    })),
  });
  if (Number(project.fikenInvoiceDraftId) !== existingId) await rememberDraft(projectRef, existingId);
  return existingId;
}

async function syncApprovedOffer(projectId, itemId) {
  const db = getFirestore();
  const projectRef = db.collection("projects").doc(projectId);
  const itemRef = projectRef.collection("items").doc(itemId);
  return withFikenLock(projectRef, async () => {
    const [projectSnap, itemSnap] = await Promise.all([projectRef.get(), itemRef.get()]);
    if (!projectSnap.exists || !itemSnap.exists) {
      throw new HttpsError("not-found", "Fant ikke posten.");
    }
    const project = { id: projectId, ...projectSnap.data() };
    const item = itemSnap.data() || {};
    if (!billable.isBillableOffer(item)) {
      return { ok: false, message: "Bare godkjente tilbud, endringer og tillegg kan legges i Fiken." };
    }
    if (!(item.alternatives || []).some((alternative) => alternative.id === item.selectedAlternativeId)) {
      const message = "Posten har ingen valgt løsning.";
      await itemRef.set({ fikenSynced: false, fikenError: message }, { merge: true });
      return { ok: false, message };
    }
    if (!project.fikenProjectId) {
      const message = "Prosjektet er ikke koblet til et Fiken-prosjekt.";
      await itemRef.set({ fikenSynced: false, fikenError: message }, { merge: true });
      return { ok: false, message };
    }
    if (item.fikenSynced && item.fikenDraftId) {
      return { ok: true, fikenDraftId: item.fikenDraftId, message: billable.statusText(project.fikenProjectName) };
    }
    try {
      const { token, slug } = fikenSecrets();
      const line = billable.billableLine({
        item,
        itemId,
        projectId,
        incomeAccount: await readIncomeAccount(),
        approvedAt: item.approvedAt,
      });
      const draftId = await upsertProjectInvoice({ token, slug, projectRef, project, itemId, line });
      await itemRef.set({ fikenDraftId: draftId, fikenSynced: true, fikenError: "" }, { merge: true });
      return { ok: true, fikenDraftId: draftId, message: billable.statusText(project.fikenProjectName) };
    } catch (error) {
      const message = String(error?.message || "Kunne ikke legge posten i Fiken.").replace(/^FirebaseError:\s*/i, "").slice(0, 300);
      await itemRef.set({ fikenSynced: false, fikenError: message }, { merge: true });
      return { ok: false, message };
    }
  });
}

function fikenCallable() {
  return { secrets: [fikenToken, fikenCompany], region: "europe-west1" };
}

exports.listFikenProjects = onCall(fikenCallable(), async (request) => {
  assertFikenAdmin(request);
  const { token, slug } = fikenSecrets();
  const list = await listOpenProjects(token, slug);
  return {
    projects: list.map((project) => ({
      projectId: project.projectId,
      name: project.name || "",
      number: project.number || "",
      contactName: project.contact?.name || "",
    })).filter((project) => project.projectId),
  };
});

exports.linkFikenProject = onCall(fikenCallable(), async (request) => {
  assertFikenAdmin(request);
  const data = request.data || {};
  const projectId = String(data.projectId || "").trim();
  if (!projectId) throw new HttpsError("invalid-argument", "Mangler prosjekt.");
  const ref = getFirestore().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Fant ikke prosjektet.");
  const project = { id: projectId, ...snap.data() };
  const { token, slug } = fikenSecrets();
  let fikenProjectId = Number(data.fikenProjectId);
  let name = "";
  let number = "";
  if (data.create === true) {
    const contact = project.customerName
      ? await customerId(token, slug, {
        name: project.customerName,
        email: project.customerEmail,
        address: project.address,
      })
      : null;
    const created = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/projects`, {
      method: "POST",
      body: JSON.stringify({
        name: billable.projectName(project),
        number: billable.projectNumber(projectId),
        startDate: billable.osloDate(new Date()),
        description: billable.projectDescription(project),
        ...(contact ? { contactId: contact } : {}),
      }),
    });
    fikenProjectId = idFromLocation(created.location, "projects");
    if (!fikenProjectId) throw new HttpsError("internal", "Fiken opprettet prosjektet uten å gi tilbake en id.");
    name = billable.projectName(project);
    number = billable.projectNumber(projectId);
  } else {
    if (!Number.isInteger(fikenProjectId) || fikenProjectId <= 0) {
      throw new HttpsError("invalid-argument", "Velg et Fiken-prosjekt.");
    }
    const got = await fikenRequest(token, `/companies/${encodeURIComponent(slug)}/projects/${fikenProjectId}`);
    name = got.body?.name || String(fikenProjectId);
    number = got.body?.number || "";
  }
  await ref.set({
    fikenProjectId,
    fikenProjectName: name,
    fikenProjectNumber: number,
  }, { merge: true });
  return {
    ok: true,
    fikenProjectId,
    fikenProjectName: name,
    fikenProjectNumber: number,
    message: `Koblet til Fiken-prosjekt ${name}.`,
  };
});

exports.syncOfferToFikenProject = onCall(fikenCallable(), async (request) => {
  assertFikenAdmin(request);
  const data = request.data || {};
  const projectId = String(data.projectId || "").trim();
  const itemId = String(data.itemId || "").trim();
  if (!projectId || !itemId) throw new HttpsError("invalid-argument", "Mangler post.");
  return syncApprovedOffer(projectId, itemId);
});

exports.createFikenDraft = onCall(fikenCallable(), async (request) => {
  assertFikenAdmin(request);
  const { token, slug } = fikenSecrets();
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
