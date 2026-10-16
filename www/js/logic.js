import { PORTAL_BASE } from "./company.js";
import { isOfferItem, offerDecisionText } from "./offers.js";
import { isTrashedPhoto, photoKey, publishedPhotoKeys, representativeKeys } from "./photos.js";

export const KIND_META = {
  bilde: {
    label: "Bilder",
    singular: "Bilde",
    empty: "Ingen dokumentasjonsbilder ennå. Ta et bilde, så ligger det her.",
  },
  kunde: {
    label: "Fra kunde",
    singular: "Fra kunde",
    empty: "Kunden har ikke sendt inn noe ennå. Del prosjektlenken, så kan de laste opp grunnlag.",
  },
  endring: {
    label: "Endringer",
    singular: "Endring",
    empty: "Ingen endringer registrert.",
  },
  avvik: {
    label: "Avvik",
    singular: "Avvik",
    empty: "Ingen avvik registrert.",
  },
  tilbud: {
    label: "Tilbud",
    singular: "Tilbud",
    empty: "Ingen tilbud eller endringsforslag ennå.",
  },
  tillegg: {
    label: "Tillegg",
    singular: "Tillegg",
    empty: "Ingen tillegg registrert.",
  },
};

export const TRASH_DAYS = 90;

export const DEFAULT_TEMPLATES = [
  { id: "drenering", name: "Drenering", steps: ["Før", "Grøft", "Rør/duk", "Tilbakefylling", "Ferdig"] },
  { id: "beplantning", name: "Beplantning", steps: ["Før", "Jord", "Planting", "Vanning", "Ferdig"] },
  { id: "stottemur", name: "Støttemur", steps: ["Før", "Fundament", "Mur", "Ferdig"] },
  { id: "plen", name: "Plen og jord", steps: ["Før", "Grunnarbeid", "Ferdig"] },
];

const MS_DAY = 24 * 60 * 60 * 1000;

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6));
  }
  return null;
}

export function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

export function formatWhen(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDay(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function addYears(date, years) {
  const next = new Date(date.getTime());
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export function reminderPlan(project, now = new Date()) {
  const completed = toDate(project?.completedAt);
  if (!completed) return [];
  return [1, 2].map((year) => {
    const due = addYears(completed, year);
    const done = year === 1 ? !!project.reminder1Done : !!project.reminder2Done;
    const daysUntil = Math.ceil((due.getTime() - now.getTime()) / MS_DAY);
    let state = "scheduled";
    if (done) state = "done";
    else if (now.getTime() >= due.getTime()) state = "due";
    return { year, due, done, state, daysUntil };
  });
}

export function dueReminderCount(projects, now = new Date()) {
  return (projects || []).reduce(
    (sum, project) => sum + reminderPlan(project, now).filter((entry) => entry.state === "due").length,
    0
  );
}

export function reminderWhenLabel(entry) {
  if (entry.state === "due") {
    const late = Math.abs(Math.min(entry.daysUntil, 0));
    if (late <= 0) return "Forfalt i dag";
    if (late === 1) return "1 dag på overtid";
    return `${late} dager på overtid`;
  }
  if (entry.daysUntil <= 1) return "Forfaller i morgen eller i dag";
  return `Om ${entry.daysUntil} dager`;
}

export function randomToken(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function portalUrl(projectId, token, base = PORTAL_BASE) {
  const url = new URL(base);
  url.searchParams.set("p", projectId);
  url.searchParams.set("t", token);
  return url.toString();
}

export const PORTAL_PREVIEW_APP = "kunde-forhandsvisning";
export const PORTAL_PREVIEW_BANNER = "Forhåndsvisning – slik ser kunden det";

export function isPortalPreview(search) {
  const params = typeof search === "string"
    ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
    : search;
  if (!params || typeof params.get !== "function") return false;
  return params.get("vis") === "forhandsvisning";
}

export function portalPreviewUrl(projectId, token, base = PORTAL_BASE) {
  const url = new URL(portalUrl(projectId, token, base));
  url.searchParams.set("vis", "forhandsvisning");
  return url.toString();
}

export function previewOpenMode({ native = false, hasBrowser = false } = {}) {
  if (native && hasBrowser) return "in-app";
  if (native) return "copy";
  return "tab";
}

function customerSource(record) {
  const source = record?.source;
  return source === "kunde" || source === "customer";
}

export function customerOwnPending(record, uid) {
  if (!record || isTrashedPhoto(record) || record.approved === true) return false;
  if (!uid || record.createdBy !== uid) return false;
  return customerSource(record);
}

export function customerVisibleContent(record, uid) {
  if (!record || isTrashedPhoto(record)) return false;
  if (record.approved === true) return true;
  return customerOwnPending(record, uid);
}

export function customerVisibleDocument(record) {
  if (!record) return false;
  if (record.approved === true) return true;
  return record.source === "customer";
}

export function applyPortalPreviewLock(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("button, textarea, select").forEach((node) => {
    node.disabled = true;
  });
  root.querySelectorAll("input").forEach((node) => {
    if (node.type === "radio") return;
    node.disabled = true;
  });
}

export function reminderShareText(project, year, url) {
  return `Hei! Det er omtrent ${year} år siden vi avsluttet «${project.name}». Hvis du vil, setter jeg pris på en kort vurdering av hvordan det ble: ${url}`;
}

export function projectShareText(project, url) {
  return `Hei! Her kan du følge prosjektet «${project.name}», se rapporten og sende inn bilder og info: ${url}`;
}

// Ett steg tilbake i appen. Overlegg lukkes først. Bare prosjektlisten og innlogging minimerer.
export function backAction({ route, depth, overlay, native }) {
  if (overlay) return "overlay";
  const atStart = (route === "projects" || route === "login") && depth <= 1;
  if (atStart) return native ? "minimize" : "leave";
  if (depth <= 1) return "root";
  return "pop";
}

export function isCompleted(project) {
  const status = project?.status;
  return status === "fullfort" || status === "done";
}

export function isTrashed(project) {
  return project?.trashed === true;
}

export function isOffer(project) {
  return project?.status === "tilbud" && !isTrashed(project) && !isCompleted(project);
}

export function phaseLabel(project) {
  if (isTrashed(project)) return "I papirkurven";
  if (isCompleted(project)) return "Fullført";
  if (project?.status === "tilbud") return "Tilbud";
  return "Pågår";
}

export function daysSince(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / MS_DAY);
}

export function trashDaysLeft(project, now = new Date()) {
  if (!isTrashed(project)) return null;
  const age = daysSince(project.trashedAt, now);
  if (age == null) return TRASH_DAYS;
  return Math.max(0, TRASH_DAYS - age);
}

export function missingTemplateSteps(steps, items) {
  const have = new Set(
    (items || [])
      .filter((item) => item && item.kind === "bilde" && item.approved !== false && item.step)
      .map((item) => item.step)
  );
  return (steps || []).filter((step) => step && !have.has(step));
}

export function approvalLine(item) {
  if (!item || (!item.approvalRequested && !item.approvalStatus)) return "";
  const status = item.approvalStatus || "venter";
  const label = status === "godkjent"
    ? "Godkjent av kunde"
    : status === "avslatt"
      ? "Avslått av kunde"
      : "Venter på kundens godkjenning";
  const who = item.approvedByName ? ` (${item.approvedByName})` : "";
  const when = formatWhen(item.approvedAt);
  return [label + who, when].filter(Boolean).join(" · ");
}

function clip(value, max) {
  return String(value || "").trim().slice(0, max);
}

function httpsUrl(value) {
  const url = String(value || "");
  if (!url.startsWith("https://") || url.length > 2000) return "";
  return url;
}

// Kun felter som skal kunne ligge åpent på nettsiden.
// Delingskode, kundekontakt, adresse og PDF-lenke skal aldri med.
export function buildReferenceDoc(project, items, photosByItem = {}) {
  const chosen = (items || []).filter((item) => item && item.approved === true && item.reference === true);
  const visiblePhotos = publishedPhotoKeys(items, photosByItem);
  const photos = [];
  const tasks = [];
  const ratings = [];

  for (const item of chosen) {
    const text = clip(item.text, 800);
    const title = clip(item.title, 140);
    if (item.kind === "vurdering") {
      const stars = Number(item.stars);
      if (Number.isInteger(stars) && stars >= 1 && stars <= 5) {
        ratings.push({ stars, text, createdAt: toIso(item.createdAt) });
      }
      continue;
    }
    if (title || text) {
      if (["bilde", "endring", "avvik", "kunde", "tilbud", "tillegg"].includes(item.kind)) {
        tasks.push({ kind: item.kind, title, text, createdAt: toIso(item.createdAt) });
      }
    }
    const ownPhotos = photosByItem[item.id] || [];
    for (const photo of ownPhotos) {
      if (photos.length >= 24) break;
      if (!photo || photo.approved === false) continue;
      const marked = {
        ...photo,
        itemId: item.id,
        step: photo.step || item.step || "",
        comment: photo.caption || item.text || "",
      };
      if (!visiblePhotos.has(photoKey(marked))) continue;
      const url = httpsUrl(photo.url);
      if (!url) continue;
      photos.push({
        url,
        caption: clip(photo.caption || text, 300),
        kind: item.kind || "bilde",
      });
    }
  }

  const ratingAvg = ratings.length
    ? Math.round((ratings.reduce((sum, rating) => sum + rating.stars, 0) / ratings.length) * 10) / 10
    : 0;

  return {
    name: clip(project?.name, 140),
    summary: clip(project?.publicSummary, 1200),
    location: clip(project?.publicLocation, 80),
    completedAt: toIso(project?.completedAt),
    photos: photos.slice(0, 24),
    tasks: tasks.slice(0, 40),
    ratings: ratings.slice(0, 10),
    ratingAvg,
    ratingCount: ratings.length,
  };
}

export function buildLocalDraft(project, items, extras = {}) {
  const photosByItem = extras.photosByItem || {};
  const commentsByItem = extras.commentsByItem || {};
  const shownPhotos = representativeKeys(items, photosByItem);
  const lines = [];
  lines.push(`Oppdrag: ${project?.name || "Uten navn"}`);
  if (project?.address) lines.push(`Adresse: ${project.address}`);
  if (project?.customerName) lines.push(`Kunde: ${project.customerName}`);
  lines.push("");
  lines.push("Arbeid utført");
  lines.push("Skriv om hva som ble gjort. Punktene under er hentet fra notatene i prosjektet og kan redigeres.");
  lines.push("");

  const groups = [
    ["bilde", "Dokumentasjon"],
    ["endring", "Endringer"],
    ["tillegg", "Tillegg"],
    ["avvik", "Avvik"],
    ["kunde", "Grunnlag fra kunde"],
    ["tilbud", "Tilbud"],
  ];

  for (const [kind, heading] of groups) {
    const list = (items || []).filter((item) => item.kind === kind && item.approved !== false && item.fikenBase !== true);
    if (!list.length) continue;
    lines.push(heading);
    for (const item of list) {
      const when = formatWhen(item.createdAt);
      const title = clip(item.title, 200);
      const text = clip(item.text, 2000);
      const head = [when, title].filter(Boolean).join(" — ");
      lines.push(head ? `- ${head}` : "- Notat");
      if (text) lines.push(`  ${text}`);
      const approval = approvalLine(item);
      if (approval) lines.push(`  ${approval}`);
      if (isOfferItem(item)) {
        for (const line of offerDecisionText(item).split("\n")) lines.push(`  ${line}`);
      }
      const photos = (photosByItem[item.id] || []).filter((photo) => shownPhotos.has(photoKey({
        ...photo,
        itemId: item.id,
        step: photo.step || item.step || "",
        comment: photo.caption || item.text || "",
      })));
      if (photos.length) {
        const captions = photos.map((photo) => clip(photo.caption, 180)).filter(Boolean);
        lines.push(`  Bilder: ${photos.length}${captions.length ? ` (${captions.join("; ")})` : ""}`);
      }
      const comments = (commentsByItem[item.id] || []).filter((comment) => comment.approved !== false);
      for (const comment of comments) {
        const textValue = clip(comment.text, 500);
        if (!textValue) continue;
        lines.push(`  Kommentar (${formatWhen(comment.createdAt)}): ${textValue}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}
