const { setGlobalOptions } = require("firebase-functions/v2");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

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

exports.onLegacyCustomerPhoto = onDocumentCreated("projects/{projectId}/photos/{photoId}", async (event) => {
  const data = event.data?.data() || {};
  if (data.approved !== false) return;
  await notifyAdmin("Nytt bilde fra kunde", data.caption || "Bilde i prosjektet", event.params.projectId);
});
