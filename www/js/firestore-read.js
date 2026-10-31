export function firestoreTransportSettings(cap) {
  const platform = typeof cap?.getPlatform === "function" ? cap.getPlatform() : "";
  const native = cap?.isNativePlatform?.() === true || platform === "android" || platform === "ios";
  if (!native) return {};
  // WebChannel feiler i Android WebView. Da tror Firestore at telefonen er offline
  // selv om nettverket er oppe, og get() på et dokument som ikke er i hurtiglageret kaster.
  // Automatisk oppdaging er allerede standard i SDK-et og er ikke nok her.
  return { experimentalForceLongPolling: true };
}

export function isFirestoreOfflineError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return code === "unavailable"
    || message.includes("client is offline")
    || message.includes("failed to get document from server")
    || message.includes("could not reach cloud firestore backend")
    || message.includes("backend didn't respond");
}

export function isFirestoreDeniedError(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return code === "permission-denied"
    || message.includes("insufficient permissions")
    || message.includes("permission denied")
    || message.includes("permission-denied");
}

export function firestoreReadMessage(error) {
  if (isFirestoreDeniedError(error)) return "Fikk ikke lese dokumentet. Logg inn på nytt.";
  if (isFirestoreOfflineError(error)) return "Fikk ikke kontakt med databasen. Prøv igjen om litt.";
  const message = String(error?.message || error || "").trim();
  return message ? message.slice(0, 300) : "Kunne ikke hente dataene. Prøv igjen.";
}

export function firestoreWriteMessage(error, fallback) {
  const code = String(error?.code || "").replace(/^firestore\//, "").trim();
  const message = String(error?.message || "").replace(/^FirebaseError:\s*/i, "").trim();
  const short = message.length > 160 ? `${message.slice(0, 157)}…` : message;
  const detail = [code, short].filter(Boolean).join(" — ");
  return detail ? `${fallback} (${detail})` : fallback;
}

export async function readDocWithRetry(get, { attempts = 3, wait = async () => {} } = {}) {
  let source = "default";
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await get(source === "server" ? { source: "server" } : undefined);
    } catch (error) {
      last = error;
      const message = String(error?.message || "").toLowerCase();
      if (message.includes("local cache")) source = "default";
      else if (isFirestoreOfflineError(error)) source = source === "default" ? "server" : "default";
      else throw error;
      if (attempt < attempts - 1) await wait(attempt);
    }
  }
  const failure = new Error(firestoreReadMessage(last));
  failure.name = "FirestoreReadError";
  failure.cause = last;
  throw failure;
}
