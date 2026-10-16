import { toDate } from "./logic.js";

export const HMS_MAX_BYTES = 25 * 1024 * 1024;
export const HMS_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*";

const TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

export function hmsExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || "").trim());
  return match ? match[1].toLowerCase() : "";
}

export function isHmsFileName(name) {
  return Object.prototype.hasOwnProperty.call(TYPES, hmsExtension(name));
}

export function hmsContentType(name) {
  return TYPES[hmsExtension(name)] || "";
}

export function hmsKindLabel(name, contentType = "") {
  const type = contentType || hmsContentType(name);
  if (type === "application/pdf") return "PDF";
  if (type === "application/msword" || type.includes("wordprocessingml")) return "Word";
  if (type.startsWith("image/")) return "Bilde";
  return "Dokument";
}

export function hmsFileName(name) {
  const ext = hmsExtension(name);
  const base = String(name || "dokument")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "dokument"}.${ext || "bin"}`;
}

export function hmsStoragePath(projectId, docId, name) {
  return `projects/${projectId}/hms/${docId}/${hmsFileName(name)}`;
}

export function isTrashedHms(doc) {
  return doc?.trashed === true;
}

export function activeHmsDocs(docs) {
  return (docs || []).filter((doc) => doc && !isTrashedHms(doc));
}

export function customerHmsDocs(docs) {
  return activeHmsDocs(docs).filter((doc) => doc.visibleToCustomer === true);
}

export function hmsCountLabel(count) {
  const total = Number(count) || 0;
  if (!total) return "Ingen dokumenter";
  return total === 1 ? "1 dokument" : `${total} dokumenter`;
}

export function sortHmsDocs(docs) {
  return (docs || []).slice().sort((a, b) => {
    const left = toDate(b?.createdAt)?.getTime() || 0;
    const right = toDate(a?.createdAt)?.getTime() || 0;
    if (left !== right) return left - right;
    return String(a?.name || "").localeCompare(String(b?.name || ""), "nb");
  });
}

export function newHmsDoc({ name, url, storagePath, contentType, uploadedBy }) {
  return {
    name: String(name || "Dokument").slice(0, 180),
    url: url || "",
    storagePath,
    contentType: contentType || hmsContentType(name),
    visibleToCustomer: false,
    trashed: false,
    source: "admin",
    uploadedBy: String(uploadedBy || "").slice(0, 120),
  };
}
