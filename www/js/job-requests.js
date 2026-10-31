export const JOB_KIND_LABEL = {
  pris: "Be om pris",
  bestilling: "Bestilling",
};

export const JOB_STATUS_LABEL = {
  ny: "Ny",
  besvart: "Besvart",
  tillegg: "Lagt til som tillegg",
};

export function jobKind(value) {
  return value === "bestilling" ? "bestilling" : "pris";
}

export function jobStatus(request) {
  if (request?.status === "besvart" || request?.status === "tillegg") return request.status;
  return "ny";
}

export function jobKindLabel(request) {
  return JOB_KIND_LABEL[jobKind(request?.kind)];
}

export function jobStatusLabel(request) {
  return JOB_STATUS_LABEL[jobStatus(request)];
}

export function jobQuantity(value) {
  if (value == null || value === "") return null;
  const number = Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0 || number >= 100000000) return null;
  return Math.round(number * 100) / 100;
}

// Ingen pris. Kunden beskriver arbeidet, og kan oppgi antall og ett bilde.
export function jobRequestFields({ kind, text, quantity, photoUrl = "", photoPath = "" } = {}) {
  const data = {
    kind: jobKind(kind),
    text: String(text || "").trim().slice(0, 1999),
    status: "ny",
  };
  const qty = jobQuantity(quantity);
  if (qty != null) data.quantity = qty;
  const url = String(photoUrl || "");
  const path = String(photoPath || "");
  if (url && path) {
    data.photoUrl = url;
    data.photoPath = path;
  }
  return data;
}
