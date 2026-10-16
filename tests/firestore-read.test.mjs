import test from "node:test";
import assert from "node:assert/strict";
import {
  firestoreReadMessage,
  firestoreTransportSettings,
  isFirestoreDeniedError,
  isFirestoreOfflineError,
  readDocWithRetry,
} from "../www/js/firestore-read.js";

const offline = Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" });
const denied = Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
const cached = new Error('Failed to get document from server. (However, this document does exist in the local cache. Run again without setting source to "server" to retrieve the cached document.)');

test("Android-appen tvinger long polling, nettleseren beholder standard", () => {
  assert.deepEqual(firestoreTransportSettings({ isNativePlatform: () => true }), { experimentalForceLongPolling: true });
  assert.deepEqual(firestoreTransportSettings({ getPlatform: () => "android" }), { experimentalForceLongPolling: true });
  assert.deepEqual(firestoreTransportSettings({ isNativePlatform: () => false, getPlatform: () => "web" }), {});
  assert.deepEqual(firestoreTransportSettings(undefined), {});
  assert.equal(firestoreTransportSettings({ isNativePlatform: () => true }).experimentalAutoDetectLongPolling, undefined);
});

test("offline og avvist lesing får hver sin norske melding", () => {
  assert.equal(isFirestoreOfflineError(offline), true);
  assert.equal(isFirestoreDeniedError(denied), true);
  assert.equal(firestoreReadMessage(offline), "Fikk ikke kontakt med databasen. Prøv igjen om litt.");
  assert.equal(firestoreReadMessage(denied), "Fikk ikke lese dokumentet. Logg inn på nytt.");
  assert.equal(firestoreReadMessage(offline).includes("client is offline"), false);
});

test("lesing prøver server etter offline og faller tilbake til hurtiglager", async () => {
  const calls = [];
  const snap = await readDocWithRetry(async (options) => {
    calls.push(options?.source || "default");
    if (calls.length === 1) throw offline;
    if (calls.length === 2) throw cached;
    return { exists: true, data: () => ({ agreedExVat: 10 }) };
  }, { wait: async () => {} });
  assert.deepEqual(calls, ["default", "server", "default"]);
  assert.equal(snap.exists, true);
});

test("vedvarende offline gir norsk feil etter nye forsøk", async () => {
  let calls = 0;
  await assert.rejects(
    () => readDocWithRetry(async () => {
      calls += 1;
      throw offline;
    }, { wait: async () => {} }),
    (error) => error.name === "FirestoreReadError"
      && error.message === "Fikk ikke kontakt med databasen. Prøv igjen om litt.",
  );
  assert.equal(calls, 3);
});

test("manglende tilgang prøves ikke på nytt", async () => {
  let calls = 0;
  await assert.rejects(
    () => readDocWithRetry(async () => {
      calls += 1;
      throw denied;
    }, { wait: async () => {} }),
    (error) => error.code === "permission-denied",
  );
  assert.equal(calls, 1);
});
