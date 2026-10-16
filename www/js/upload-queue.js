export const UPLOAD_CONCURRENCY = 2;
export const UPLOAD_TIMEOUT_MS = 90_000;
export const RETRY_BASE_MS = 4_000;
export const RETRY_MAX_MS = 5 * 60_000;
export const RECOMPRESS_BYTES = 800 * 1024;
export const MAX_PHOTOS = 100;

export function uploadProgressText(startedIndex, total) {
  const count = Math.max(0, Number(total) || 0);
  if (!count) return "";
  const current = Math.min(count, Math.max(0, Number(startedIndex) || 0) + 1);
  return `Laster opp ${current} av ${count}`;
}

export function prepareProgressText(startedIndex, total) {
  const count = Math.max(0, Number(total) || 0);
  if (!count) return "";
  const current = Math.min(count, Math.max(0, Number(startedIndex) || 0) + 1);
  return `Klargjør ${current} av ${count}`;
}

export function retryDelay(attempts) {
  const step = Math.min(8, Math.max(0, Number(attempts) || 0));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** step);
}

export function canAttempt(item, now = Date.now()) {
  if (!item || item.held) return false;
  const at = Number(item.nextAttemptAt) || 0;
  return now >= at;
}

export function needsPrepare(item) {
  if (!item?.blob || typeof item.blob.size !== "number") return false;
  if (item.prepared) return false;
  if (!item.thumb) return true;
  return item.blob.size > RECOMPRESS_BYTES;
}

export function failureReason(error) {
  const code = String(error?.code || "");
  const text = String(error?.message || error || "");
  const blob = `${code} ${text}`.toLowerCase();
  if (blob.includes("tidsavbrudd") || blob.includes("timeout")) return "Tidsavbrudd. Bildet ble ikke sendt ferdig.";
  if (blob.includes("offline") || blob.includes("network") || blob.includes("failed to fetch")) return "Ingen nett";
  if (blob.includes("unauthorized") || blob.includes("permission-denied") || blob.includes("permission")) return "Mangler tilgang til lagring";
  if (blob.includes("quota") || blob.includes("for stort") || blob.includes("object-not-found")) return "Bildet er for stort eller mangler";
  if (blob.includes("cancel")) return "Opplastingen ble avbrutt";
  if (blob.includes("mangler på telefonen")) return "Bildet mangler på telefonen";
  const clean = text.replace(/^FirebaseError:\s*/i, "").trim();
  if (!clean || clean === "[object Object]") return "Kunne ikke sende";
  return clean.slice(0, 160);
}

export function queueBanner({ online, active, phase, done, total, waiting, failed }) {
  if (!online) {
    if (!waiting) return "Ingen nett. Notater lagres på telefonen og sendes når du er tilkoblet.";
    const noun = waiting === 1 ? "bilde ligger" : "bilder ligger";
    return `Ingen nett. ${waiting} ${noun} på telefonen.`;
  }
  if (active && phase === "prepare") return prepareProgressText(done, total);
  if (active && total > 0) return uploadProgressText(done, total);
  if (failed > 0) return `${failed} ble ikke sendt.`;
  if (waiting > 0) return `Venter på å sende ${waiting}…`;
  return "";
}

export function showRetryButton({ online, waiting, failed }) {
  return !!online && ((Number(waiting) || 0) > 0 || (Number(failed) || 0) > 0);
}

export function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
        /* avbrytingen er et forsøk */
      }
      reject(Object.assign(new Error("Tidsavbrudd"), { code: "timeout" }));
    }, ms);
    Promise.resolve(promise).then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function runUploadPool(items, worker, { concurrency = UPLOAD_CONCURRENCY, onStart, isCancelled } = {}) {
  const list = items.slice();
  let cursor = 0;
  async function lane() {
    while (cursor < list.length) {
      if (isCancelled?.()) return;
      const index = cursor;
      cursor += 1;
      const item = list[index];
      onStart?.(item, index);
      try {
        await worker(item, index);
      } catch (error) {
        item.lastError = error;
      }
    }
  }
  const width = Math.max(1, Math.min(concurrency, list.length || 1));
  if (!list.length) return;
  await Promise.all(Array.from({ length: width }, () => lane()));
}
