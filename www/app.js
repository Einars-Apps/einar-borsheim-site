import { firebaseConfig, FROST_CLIENT_ID } from "./firebase-config.js";
import { COMPANY } from "./js/company.js";
import {
  DEFAULT_TEMPLATES,
  KIND_META,
  TRASH_DAYS,
  approvalLine,
  buildLocalDraft,
  buildReferenceDoc,
  daysSince,
  backAction,
  dueReminderCount,
  formatDay,
  formatWhen,
  isCompleted,
  isTrashed,
  missingTemplateSteps,
  phaseLabel,
  portalPreviewUrl,
  portalUrl,
  previewOpenMode,
  projectShareText,
  randomToken,
  reminderPlan,
  reminderShareText,
  reminderWhenLabel,
  toDate,
  trashDaysLeft,
} from "./js/logic.js";
import { canSpeak, dictate } from "./js/speech.js";
import { AI_DRAFT_URL, requestAiDraft } from "./js/ai.js";
import { blobToDataUrl, exifBackfillPatch, fileTimeCandidate, preparePhoto, readExifMeta } from "./js/image.js";
import { readDevicePosition } from "./js/geo.js";
import { formatCapture, gpsLabel, photoWhen, placeFields, showGpsInReport, withDevicePosition } from "./js/place.js";
import { addToQueue, getQueueItem, listQueue, removeQueue, updateQueue } from "./js/queue.js";
import {
  MAX_PHOTOS,
  UPLOAD_CONCURRENCY,
  UPLOAD_TIMEOUT_MS,
  canAttempt,
  failureReason,
  needsPrepare,
  queueBanner,
  retryDelay,
  runUploadPool,
  showRetryButton,
  withTimeout,
} from "./js/upload-queue.js";
import { generatePdfBlob } from "./js/pdf.js";
import {
  DEFAULT_BYGGFORSK_REFERENCE,
  assessDrainage,
  documentFromForm,
  drainageReportText,
  emptyDrainageForm,
  fikenDraftLines,
  formFromDoc,
  pricesFromLines,
  pricesFromSettings,
  resolveFrostClientId,
} from "./js/drainage.js";
import { renderDrainageForm, renderDrainageList } from "./js/drainage-view.js";
import {
  addressFromGeonorge,
  approvedChoiceSum,
  blankOfferFields,
  drainageOfferFields,
  formatOfferSum,
  isOfferItem,
  offerDecisionText,
  offerShareText,
  offerStatus,
  offerTypeLabel,
  quickOfferFields,
  quickProjectName,
  shareTargets,
} from "./js/offers.js";
import { renderFikenProjectBox, renderOfferEditor, renderOfferList, renderQuickOrder } from "./js/offers-view.js";
import { renderFikenPicker } from "./js/fiken-import-view.js";
import { fieldsFromFiken, fikenUnreachableMessage, isFikenLinked, unimportedFikenProjects } from "./js/fiken-import.js";
import { firestoreReadMessage, firestoreTransportSettings, readDocWithRetry } from "./js/firestore-read.js";
import { fikenQuoteRecord, mergeFikenLines, quotesFromFikenResult } from "./js/fiken-offers.js";
import { renderFikenQuoteList } from "./js/fiken-quote-view.js";
import { changeText, costChanges, costReportText, customerSeesCost, liveCost, newExtraId, patchCost, persistableCost } from "./js/cost.js";
import { renderCostOverview } from "./js/cost-view.js";
import { fetchFrostRain } from "./js/frost.js";
import { button, el, field, icon, sheet, toast } from "./js/dom.js";
import {
  annotatePhotos,
  groupPhotos,
  isTrashedPhoto,
  newGroupId,
  needsExifBackfill,
  photoKey,
  publishedPhotoKeys,
  redundantPhotoItem,
  sortPhotos,
  uploadTimestamps,
} from "./js/photos.js";
import { mapAnchor, mountPhotoBoard } from "./js/photo-view.js";
import {
  HMS_ACCEPT,
  HMS_MAX_BYTES,
  activeHmsDocs,
  hmsContentType,
  hmsCountLabel,
  hmsStoragePath,
  isHmsFileName,
  newHmsDoc,
} from "./js/hms.js";
import { renderHmsBoard } from "./js/hms-view.js";

const ROUTES = new Set(["projects", "reminders", "capture", "project", "section", "item", "review", "form", "report", "done", "trash", "messages", "documents", "templates", "drainage", "offers", "order", "hms"]);

const main = document.getElementById("main");
const topbar = document.getElementById("topbar");
const backBtn = document.getElementById("back-btn");
const topTitle = document.getElementById("top-title");
const topKicker = document.getElementById("top-kicker");
const topAction = document.getElementById("top-action");
const tabbar = document.getElementById("tabbar");
const netBanner = document.getElementById("net-banner");
const netBannerText = document.getElementById("net-banner-text");
const netRetry = document.getElementById("net-retry");

let auth;
let db;
let storage;
let user = null;
let projects = [];
let queueItems = [];
let stack = [{ name: "login" }];
let online = navigator.onLine;
let syncing = false;
let syncGeneration = 0;
let retryQueued = false;
let retryTimer = 0;
let uploadWatch = { active: false, done: 0, total: 0, phase: "" };
let captureKind = "bilde";
let captureStep = "";
let templates = [];
let stopProjects = null;
let stopTemplates = null;
let pushReady = false;
const purging = new Set();
let toldDenied = false;
let skipReviewSave = false;
let navReady = false;
const subs = [];
const queueWatchers = new Set();
let refresh = () => {};

function stamp() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function current() {
  return stack[stack.length - 1] || { name: "projects" };
}

function snapshotStack() {
  return stack.map((entry) => ({ ...entry, ids: entry.ids ? [...entry.ids] : undefined }));
}

function persistStack() {
  sessionStorage.setItem("nav", JSON.stringify(snapshotStack()));
}

function restoreStack() {
  if (navReady) return;
  navReady = true;
  let saved = [{ name: "projects" }];
  try {
    const parsed = JSON.parse(sessionStorage.getItem("nav") || "");
    if (Array.isArray(parsed) && parsed.length && parsed.every((entry) => entry && ROUTES.has(entry.name))) {
      saved = parsed;
    }
  } catch {
    /* behold standard */
  }
  stack = [saved[0]];
  history.replaceState({ stack: snapshotStack() }, "");
  for (let index = 1; index < saved.length; index += 1) {
    stack.push(saved[index]);
    history.pushState({ stack: snapshotStack() }, "");
  }
}

function clearSubs() {
  for (const stop of subs) stop();
  subs.length = 0;
  refresh = () => {};
}

function push(entry) {
  stack.push(entry);
  history.pushState({ stack: snapshotStack() }, "");
  persistStack();
  render();
}

function reset(entry) {
  stack = [entry];
  history.replaceState({ stack: snapshotStack() }, "");
  persistStack();
  render();
}

function replaceTop(entry) {
  stack[stack.length - 1] = entry;
  history.replaceState({ stack: snapshotStack() }, "");
  persistStack();
  render();
}

function projectById(id) {
  return projects.find((project) => project.id === id) || null;
}

function projectName(id) {
  return projectById(id)?.name || "";
}

function captureTitle() {
  if (captureKind === "endring") return "Ny endring";
  if (captureKind === "avvik") return "Nytt avvik";
  return "Nytt bilde";
}

function updateChrome() {
  const route = current();
  const loggedIn = !!user && route.name !== "login";
  topbar.hidden = !loggedIn;
  tabbar.hidden = !loggedIn || route.name === "review";
  document.body.classList.toggle("no-top", !loggedIn);
  document.body.classList.toggle("no-tab", !loggedIn || route.name === "review");
  backBtn.hidden = !loggedIn || stack.length < 2;

  const titles = {
    projects: ["Prosjekter", ""],
    reminders: ["Påminnelser", ""],
    capture: [captureTitle(), projectName(route.projectId)],
    project: [projectName(route.projectId) || "Prosjekt", "Oversikt"],
    section: [KIND_META[route.kind]?.label || "Innhold", projectName(route.projectId)],
    item: ["Notat", projectName(route.projectId)],
    review: ["Kommentar", projectName(route.projectId)],
    form: [route.projectId ? "Rediger prosjekt" : "Nytt prosjekt", ""],
    report: ["Rapport", projectName(route.projectId)],
    done: ["Fullførte", ""],
    trash: ["Papirkurv", ""],
    messages: ["Meldinger", projectName(route.projectId)],
    documents: ["Dokumenter", projectName(route.projectId)],
    hms: ["HMS", projectName(route.projectId)],
    templates: ["Bildemaler", ""],
    drainage: [route.docId ? "Strekk" : "Drenering", projectName(route.projectId)],
    offers: ["Tilbud og endringer", projectName(route.projectId)],
    order: ["Ny bestilling", ""],
  };
  const [title, kicker] = titles[route.name] || ["Internkontroll", ""];
  topTitle.textContent = title || "Internkontroll";
  topKicker.textContent = kicker || "";
  topKicker.hidden = !kicker;

  topAction.hidden = !loggedIn;
  topAction.replaceChildren();
  if (route.name === "projects" || route.name === "reminders") {
    topAction.append(icon("account"));
    topAction.setAttribute("aria-label", "Konto");
    topAction.onclick = openAccount;
  } else if (route.name === "project" || route.name === "report" || route.name === "section") {
    topAction.append(icon("share"));
    topAction.setAttribute("aria-label", "Del med kunde");
    topAction.onclick = () => {
      const project = projectById(route.projectId);
      if (project) shareProject(project);
    };
  } else {
    topAction.hidden = true;
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    const on = tab.dataset.tab === "reminders"
      ? route.name === "reminders"
      : tab.dataset.tab === "capture"
        ? route.name === "capture" || route.name === "review"
        : route.name !== "reminders" && route.name !== "capture" && route.name !== "review";
    tab.classList.toggle("active", on);
  });

  const due = dueReminderCount(projects);
  const badge = document.getElementById("due-badge");
  if (badge) {
    badge.hidden = due === 0;
    badge.textContent = String(due);
  }

  const waiting = queueItems.filter((item) => !item.held);
  const failed = waiting.filter((item) => item.error);
  const banner = queueBanner({
    online,
    active: uploadWatch.active,
    phase: uploadWatch.phase,
    done: uploadWatch.done,
    total: uploadWatch.total,
    waiting: waiting.length,
    failed: failed.length,
  });
  netBanner.hidden = !banner;
  if (netBannerText) netBannerText.textContent = banner;
  if (netRetry) {
    netRetry.hidden = !showRetryButton({
      online,
      active: uploadWatch.active,
      waiting: waiting.length,
      failed: failed.length,
    });
  }
  document.body.classList.toggle("has-banner", !!banner);
  const widePhotos = route.name === "item" || (route.name === "section" && route.kind === "bilde");
  document.body.classList.toggle("photo-wide", widePhotos);
}

function render() {
  clearSubs();
  main.replaceChildren();
  updateChrome();
  const route = current();
  const mounts = {
    login: mountLogin,
    projects: mountProjects,
    reminders: mountReminders,
    capture: mountCapture,
    project: mountProject,
    section: mountSection,
    item: mountItem,
    review: mountReview,
    form: mountForm,
    report: mountReport,
    done: mountDone,
    trash: mountTrash,
    messages: mountMessages,
    documents: mountDocuments,
    hms: mountHms,
    templates: mountTemplates,
    drainage: mountDrainage,
    offers: mountOffers,
    order: mountOrder,
  };
  (mounts[route.name] || mountProjects)(route);
}

function watchQueue(fn) {
  queueWatchers.add(fn);
  subs.push(() => queueWatchers.delete(fn));
  fn(queueItems);
}

async function refreshQueue() {
  queueItems = await listQueue();
  for (const fn of queueWatchers) fn(queueItems);
  updateChrome();
}

function openAccount() {
  sheet(
    "Konto",
    el("div", { class: "stack" }, [
      el("p", { class: "account-email" }, user?.email || ""),
      el("p", { class: "meta" }, `${COMPANY.name}. Testversjon for feltnotater. Si fra hva som bør justeres.`),
      button("Logg ut", { class: "btn btn-danger btn-block", onClick: () => auth.signOut() }),
    ])
  );
}

function isCancel(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("cancel") || text.includes("abort") || text.includes("dismiss");
}

async function shareText(title, text, url) {
  const Share = window.Capacitor?.Plugins?.Share;
  if (Share?.share) {
    try {
      await Share.share({ title, text, url, dialogTitle: title });
      return "shared";
    } catch (error) {
      if (isCancel(error)) return "cancel";
    }
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text: [text, url].filter(Boolean).join("\n"), url });
      return "shared";
    } catch (error) {
      if (isCancel(error)) return "cancel";
    }
  }
  return "fallback";
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast("Lenke kopiert");
  } catch {
    window.prompt("Kopier lenken:", url);
  }
}

function openShareSheet({ title, text, url, phone, email }) {
  const targets = shareTargets({ phone, email, text, url, subject: title });
  sheet(title, el("div", { class: "stack" }, [
    el("p", { class: "meta" }, "Lenken er klar. Del den på SMS eller e-post, eller kopier den."),
    ...targets.map((target) => el("a", { class: "btn btn-primary btn-block", href: target.href }, target.label)),
    button("Kopier lenke", { class: "btn btn-ghost btn-block", onClick: () => copyLink(url) }),
  ]));
}

const tokenJobs = new Map();

async function ensureToken(project) {
  if (project.shareToken) return project.shareToken;
  if (tokenJobs.has(project.id)) return tokenJobs.get(project.id);
  const job = (async () => {
    const shareToken = randomToken(12);
    await db.collection("projects").doc(project.id).update({ shareToken, updatedAt: stamp() });
    project.shareToken = shareToken;
    return shareToken;
  })();
  tokenJobs.set(project.id, job);
  try {
    return await job;
  } finally {
    if (tokenJobs.get(project.id) === job) tokenJobs.delete(project.id);
  }
}

async function openPreviewUrl(url) {
  const native = !!window.Capacitor?.isNativePlatform?.();
  const hasBrowser = !!window.Capacitor?.Plugins?.Browser?.open;
  const mode = previewOpenMode({ native, hasBrowser });
  if (mode === "in-app") {
    await window.Capacitor.Plugins.Browser.open({ url });
    return;
  }
  if (mode === "tab") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  }
  await copyLink(url);
  toast(mode === "copy"
    ? "Forhåndsvisningen er kopiert. Åpne den i nettleseren på telefonen."
    : "Nettleseren blokkerte vinduet. Forhåndsvisningen er kopiert.");
}

async function previewAsCustomer(project) {
  try {
    const hadLink = !!project.shareToken;
    const token = await ensureToken(project);
    if (!hadLink) toast("Kundelenken er opprettet");
    await openPreviewUrl(portalPreviewUrl(project.id, token));
  } catch (error) {
    console.error(error);
    toast("Kunne ikke åpne forhåndsvisningen");
  }
}

async function shareProject(project, year) {
  try {
    const token = await ensureToken(project);
    const url = portalUrl(project.id, token);
    const text = year ? reminderShareText(project, year, url) : projectShareText(project, url);
    const result = await shareText(year ? "Påminnelse til kunde" : "Del med kunde", text, url);
    if (result === "fallback") await copyLink(url);
    return result !== "cancel";
  } catch (error) {
    console.error(error);
    toast("Kunne ikke dele lenken");
    return false;
  }
}

function chooseFiles({ capture = false, multiple = false, accept = "image/*" } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    if (multiple) input.multiple = true;
    const finish = (files) => {
      input.remove();
      if (!files?.length) reject(Object.assign(new Error("cancel"), { code: "cancel" }));
      else resolve(files);
    };
    input.addEventListener("change", () => finish([...input.files]));
    input.addEventListener("cancel", () => finish([]));
    document.body.append(input);
    input.click();
  });
}

async function cameraRefs(source) {
  const Camera = window.Capacitor?.Plugins?.Camera;
  if (!Camera) return chooseFiles({ capture: source === "camera", multiple: source !== "camera" });
  if (source === "camera") {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: "uri",
      source: "CAMERA",
      saveToGallery: true,
      correctOrientation: true,
    });
    return [photo];
  }
  const result = await Camera.pickImages({ quality: 85, limit: 0 });
  return result.photos || [];
}

async function blobFromRef(ref) {
  if (ref instanceof Blob) return ref;
  if (!ref?.webPath) throw new Error("Bildet mangler på telefonen");
  return (await fetch(ref.webPath)).blob();
}

async function prepareRef(ref) {
  return preparePhoto(await blobFromRef(ref), {
    exif: ref instanceof Blob ? null : ref?.exif || null,
    lastModified: fileTimeCandidate(ref),
  });
}

async function collectPrepared(source) {
  const positionTask = source === "camera" ? readDevicePosition() : Promise.resolve(null);
  let refs = await cameraRefs(source);
  if (refs.length > MAX_PHOTOS) {
    toast(`De ${MAX_PHOTOS} første bildene blir med`);
    refs = refs.slice(0, MAX_PHOTOS);
  }
  const prepared = [];
  let skipped = 0;
  uploadWatch = { active: true, done: 0, total: refs.length, phase: "prepare" };
  updateChrome();
  try {
    for (let index = 0; index < refs.length; index += 1) {
      uploadWatch.done = index;
      updateChrome();
      try {
        prepared.push(await prepareRef(refs[index]));
      } catch (error) {
        console.error(error);
        skipped += 1;
      }
    }
  } finally {
    uploadWatch = { active: false, done: 0, total: 0, phase: "" };
    updateChrome();
  }
  const position = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    positionTask.then((value) => {
      clearTimeout(timer);
      resolve(value || null);
    }, () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  if (position) {
    for (let index = 0; index < prepared.length; index += 1) {
      prepared[index] = withDevicePosition(prepared[index], position);
    }
  }
  if (skipped) toast(skipped === 1 ? "Ett bilde ble hoppet over" : `${skipped} bilder ble hoppet over`);
  return prepared;
}

function queuePlace(prepared) {
  const place = placeFields(prepared);
  return {
    takenAt: prepared?.takenAt || null,
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    accuracyM: place?.accuracyM ?? null,
  };
}

async function ingestBlobs(projectId, kind, photos, { title = "", text = "", step = "", mode = "create", itemId = "" } = {}) {
  const ids = [];
  let skipped = 0;
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    let prepared = photo;
    if (!(photo?.blob instanceof Blob) || !("takenAt" in (photo || {}))) {
      try {
        prepared = await prepareRef(photo);
      } catch (error) {
        console.error(error);
        skipped += 1;
        continue;
      }
    }
    const id = crypto.randomUUID();
    await addToQueue({
      id,
      projectId,
      kind,
      mode,
      itemId: mode === "attach" ? itemId : crypto.randomUUID(),
      photoId: crypto.randomUUID(),
      title: title || step || "",
      text,
      step: step || "",
      blob: prepared.blob,
      thumb: prepared.thumb || null,
      prepared: true,
      filename: `${Date.now()}-${index}-${id.slice(0, 8)}.jpg`,
      ...queuePlace(prepared),
      ...uploadTimestamps(Date.now(), prepared.takenAt),
      held: mode !== "attach",
      error: "",
      attempts: 0,
      nextAttemptAt: 0,
    });
    ids.push(id);
  }
  await refreshQueue();
  if (skipped) toast(skipped === 1 ? "Ett bilde ble hoppet over" : `${skipped} bilder ble hoppet over`);
  if (!ids.length) return;
  if (mode === "attach") {
    toast(ids.length === 1 ? "Bildet er lagret på telefonen" : `${ids.length} bilder er lagret på telefonen`);
    syncQueue();
    return;
  }
  push({ name: "review", projectId, ids });
}

async function startCapture(projectId, kind, source) {
  if (!projectId) {
    toast("Velg et prosjekt først");
    return;
  }
  captureKind = kind || captureKind;
  localStorage.setItem("lastProjectId", projectId);
  try {
    const photos = await collectPrepared(source);
    await ingestBlobs(projectId, captureKind, photos, { step: captureStep, title: captureStep || "" });
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    console.error(error);
    toast("Kunne ikke hente bildet. Prøv et annet bilde, eller ta det på nytt.");
  }
}

function putBlob(ref, blob) {
  const task = ref.put(blob, { contentType: "image/jpeg" });
  return withTimeout(task, UPLOAD_TIMEOUT_MS, () => {
    try { task.cancel(); } catch { /* oppgaven kan allerede være ferdig */ }
  });
}

async function uploadQueueItem(item) {
  let url = item.url || "";
  let storagePath = item.storagePath || "";
  let thumbUrl = item.thumbUrl || "";
  if (!item.blob && !url) throw new Error("Bildet mangler på telefonen");
  if (item.blob && !url) {
    storagePath = storagePath || `projects/${item.projectId}/media/${item.filename}`;
    const ref = storage.ref(storagePath);
    await putBlob(ref, item.blob);
    url = await withTimeout(ref.getDownloadURL(), UPLOAD_TIMEOUT_MS);
    await updateQueue(item.id, { url, storagePath });
  }
  if (item.thumb && !thumbUrl) {
    try {
      const thumbPath = item.thumbPath || `projects/${item.projectId}/media/thumb-${item.filename}`;
      const thumbRef = storage.ref(thumbPath);
      await putBlob(thumbRef, item.thumb);
      thumbUrl = await withTimeout(thumbRef.getDownloadURL(), UPLOAD_TIMEOUT_MS);
      await updateQueue(item.id, { thumbUrl, thumbPath });
    } catch (error) {
      console.error(error);
    }
  }
  const cover = thumbUrl || url;
  const itemRef = db.collection("projects").doc(item.projectId).collection("items").doc(item.itemId);
  if (item.mode === "attach") {
    const existing = await withTimeout(itemRef.get(), UPLOAD_TIMEOUT_MS);
    if (!existing.exists) throw new Error("Notatet finnes ikke ennå");
    if (cover && !existing.data().coverUrl) {
      await withTimeout(itemRef.set({ coverUrl: cover, updatedAt: stamp() }, { merge: true }), UPLOAD_TIMEOUT_MS);
    }
  } else {
    const existing = await withTimeout(itemRef.get(), UPLOAD_TIMEOUT_MS);
    if (!existing.exists) {
      await withTimeout(itemRef.set({
        kind: item.kind || "bilde",
        title: item.title || item.step || "",
        text: item.text || "",
        step: item.step || "",
        stars: null,
        approved: true,
        reference: false,
        source: "admin",
        createdBy: user?.uid || "",
        authorName: "Einar",
        coverUrl: cover || "",
        createdAt: firebase.firestore.Timestamp.fromDate(new Date(item.uploadedAt || item.createdAt || Date.now())),
        updatedAt: stamp(),
      }), UPLOAD_TIMEOUT_MS);
    } else if (cover && !existing.data().coverUrl) {
      await withTimeout(itemRef.set({ coverUrl: cover, updatedAt: stamp() }, { merge: true }), UPLOAD_TIMEOUT_MS);
    }
  }
  if (url) {
    const photoRef = itemRef.collection("photos").doc(item.photoId);
    const photo = await withTimeout(photoRef.get(), UPLOAD_TIMEOUT_MS);
    const times = uploadTimestamps(item.uploadedAt || item.createdAt || Date.now(), item.takenAt);
    const uploadedAt = firebase.firestore.Timestamp.fromDate(new Date(times.uploadedAt));
    const takenAt = times.takenAt ? firebase.firestore.Timestamp.fromDate(new Date(times.takenAt)) : null;
    if (!photo.exists) {
      await withTimeout(photoRef.set({
        url,
        storagePath,
        thumbUrl: thumbUrl || "",
        caption: item.text || "",
        approved: true,
        source: "admin",
        createdBy: user?.uid || "",
        createdAt: uploadedAt,
        uploadedAt,
        exifChecked: true,
        ...(takenAt ? { takenAt } : {}),
      }), UPLOAD_TIMEOUT_MS);
    } else if (takenAt && !photo.data()?.takenAt) {
      await withTimeout(photoRef.set({ takenAt, exifChecked: true }, { merge: true }), UPLOAD_TIMEOUT_MS);
    }
  }
  const place = placeFields(item);
  if (place && item.photoId) {
    await withTimeout(
      db.collection("projects").doc(item.projectId).collection("photoGps").doc(item.photoId).set(place),
      UPLOAD_TIMEOUT_MS,
    );
  }
}

async function prepareStuckBlobs() {
  const items = (await listQueue()).filter((item) => needsPrepare(item) && canAttempt(item));
  if (!items.length) return;
  uploadWatch = { active: true, done: 0, total: items.length, phase: "prepare" };
  updateChrome();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    uploadWatch.done = index;
    updateChrome();
    try {
      const prepared = await preparePhoto(item.blob);
      const place = queuePlace({
        takenAt: item.takenAt || prepared.takenAt || null,
        lat: item.lat ?? prepared.lat,
        lon: item.lon ?? prepared.lon,
        accuracyM: item.accuracyM ?? prepared.accuracyM,
      });
      await updateQueue(item.id, {
        blob: prepared.blob,
        thumb: prepared.thumb,
        prepared: true,
        error: "",
        createdAt: item.createdAt || Date.now(),
        uploadedAt: item.uploadedAt || item.createdAt || Date.now(),
        ...place,
      });
    } catch (error) {
      console.error(error);
      await updateQueue(item.id, {
        error: failureReason(error),
        attempts: (item.attempts || 0) + 1,
        nextAttemptAt: Date.now() + retryDelay((item.attempts || 0) + 1),
      });
    }
  }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!user || !online) return;
  const times = queueItems
    .filter((item) => !item.held && Number(item.nextAttemptAt) > Date.now())
    .map((item) => Number(item.nextAttemptAt));
  if (!times.length) return;
  const wait = Math.max(250, Math.min(...times) - Date.now());
  retryTimer = setTimeout(() => syncQueue(), wait);
}

async function syncQueue() {
  if (!user || !online) {
    updateChrome();
    return;
  }
  if (syncing) {
    retryQueued = true;
    updateChrome();
    return;
  }
  const generation = ++syncGeneration;
  syncing = true;
  uploadWatch = { active: false, done: 0, total: 0, phase: "" };
  updateChrome();
  try {
    await prepareStuckBlobs();
    if (generation !== syncGeneration) return;
    const items = (await listQueue()).filter((item) => canAttempt(item));
    uploadWatch = { active: true, done: 0, total: items.length, phase: "upload" };
    updateChrome();
    await runUploadPool(items, async (item) => {
      if (generation !== syncGeneration) return;
      try {
        const latest = await getQueueItem(item.id);
        if (!latest || latest.held) return;
        await uploadQueueItem(latest);
        await removeQueue(item.id);
      } catch (error) {
        console.error(error);
        const attempts = (item.attempts || 0) + 1;
        await updateQueue(item.id, {
          error: failureReason(error),
          attempts,
          nextAttemptAt: Date.now() + retryDelay(attempts),
        });
      }
    }, {
      concurrency: UPLOAD_CONCURRENCY,
      isCancelled: () => generation !== syncGeneration,
      onStart: (_item, index) => {
        uploadWatch.done = index;
        uploadWatch.active = true;
        updateChrome();
      },
    });
  } finally {
    if (generation === syncGeneration) {
      syncing = false;
      uploadWatch = { active: false, done: 0, total: 0, phase: "" };
      await refreshQueue();
      scheduleRetry();
      if (retryQueued) {
        retryQueued = false;
        syncQueue();
      }
    }
  }
}

async function retryQueuedItems(id) {
  const items = await listQueue();
  for (const item of items) {
    if (item.held) continue;
    if (id && item.id !== id) continue;
    await updateQueue(item.id, { nextAttemptAt: 0 });
  }
  await refreshQueue();
  syncQueue();
}

async function migrateLegacyQueue() {
  const raw = localStorage.getItem("pendingPhotoUploads");
  if (!raw) return;
  let parsed = [];
  try {
    parsed = JSON.parse(raw) || [];
  } catch {
    parsed = [];
  }
  const remaining = [];
  for (const item of parsed) {
    try {
      const blob = await (await fetch(item.dataUrl)).blob();
      await addToQueue({
        id: crypto.randomUUID(),
        projectId: item.projectId,
        kind: "bilde",
        mode: "create",
        itemId: crypto.randomUUID(),
        photoId: crypto.randomUUID(),
        title: "",
        text: "",
        blob,
        filename: item.filename || `${Date.now()}.jpg`,
        createdAt: item.createdAt || Date.now(),
        held: false,
        error: "",
      });
    } catch (error) {
      console.error(error);
      remaining.push(item);
    }
  }
  if (remaining.length) localStorage.setItem("pendingPhotoUploads", JSON.stringify(remaining));
  else localStorage.removeItem("pendingPhotoUploads");
}

async function releaseStaleHolds() {
  const reviewing = new Set();
  for (const entry of stack) {
    if (entry.name === "review") (entry.ids || []).forEach((id) => reviewing.add(id));
  }
  const items = await listQueue();
  for (const item of items) {
    if (item.held && !reviewing.has(item.id)) await updateQueue(item.id, { held: false });
  }
}

async function persistReview(ids, { discard = false } = {}) {
  if (discard) {
    for (const id of ids || []) await removeQueue(id);
    await refreshQueue();
    return;
  }
  const texts = new Map();
  document.querySelectorAll("[data-queue-id]").forEach((input) => {
    texts.set(input.dataset.queueId, input.value.trim());
  });
  for (const id of ids || []) {
    const patch = { held: false, error: "" };
    if (texts.has(id)) patch.text = texts.get(id);
    await updateQueue(id, patch);
  }
  await refreshQueue();
  syncQueue();
}

async function collectContent(projectId) {
  const root = db.collection("projects").doc(projectId);
  const itemsSnap = await root.collection("items").get();
  const items = itemsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const photosByItem = {};
  const commentsByItem = {};
  for (const item of items) {
    const [photos, comments] = await Promise.all([
      root.collection("items").doc(item.id).collection("photos").get(),
      root.collection("items").doc(item.id).collection("comments").get(),
    ]);
    photosByItem[item.id] = photos.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    commentsByItem[item.id] = comments.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }
  const legacy = await root.collection("photos").get();
  for (const doc of legacy.docs) {
    const data = doc.data();
    const id = `legacy-${doc.id}`;
    items.push({
      id,
      legacyId: doc.id,
      legacy: true,
      kind: "bilde",
      title: "",
      text: data.caption || "",
      approved: data.approved !== false,
      reference: data.reference === true,
      createdAt: data.createdAt || null,
    });
    photosByItem[id] = [{ id: doc.id, url: data.url, caption: data.caption || "", approved: data.approved !== false, createdAt: data.createdAt || null, uploadedAt: data.uploadedAt || null, takenAt: data.takenAt || null }];
    const comments = await root.collection("photos").doc(doc.id).collection("comments").get();
    commentsByItem[id] = comments.docs.map((entry) => entry.data());
  }
  const gpsSnap = await root.collection("photoGps").get();
  const gps = new Map(gpsSnap.docs.map((doc) => [doc.id, doc.data()]));
  for (const id of Object.keys(photosByItem)) {
    photosByItem[id] = photosByItem[id].map((photo) => {
      const place = gps.get(photo.id);
      return place ? { ...photo, ...place } : photo;
    });
  }
  return { items, photosByItem, commentsByItem };
}

async function publishReference(projectId) {
  const snap = await db.collection("projects").doc(projectId).get();
  if (!snap.exists) return;
  const project = { id: projectId, ...snap.data() };
  const refDoc = db.collection("references").doc(projectId);
  if (!project.public) {
    await refDoc.delete().catch(() => {});
    return;
  }
  const { items, photosByItem } = await collectContent(projectId);
  const body = buildReferenceDoc(project, items, photosByItem);
  body.updatedAt = stamp();
  await refDoc.set(body);
}

async function saveReportPdf(project, reportText) {
  const { items, photosByItem, commentsByItem } = await collectContent(project.id);
  const approved = items.filter((item) => item.approved !== false && item.kind !== "vurdering");
  const ratings = items.filter((item) => item.kind === "vurdering" && item.approved === true);
  const groups = [
    ["bilde", "Bilder"],
    ["tilbud", "Tilbud"],
    ["endring", "Endringer"],
    ["tillegg", "Tillegg"],
    ["avvik", "Avvik"],
    ["kunde", "Grunnlag fra kunde"],
  ];
  const sections = [];
  let skipped = 0;
  const annotated = annotatePhotos(items, photosByItem);
  const visibleKeys = publishedPhotoKeys(items, photosByItem);
  const reportShots = [];
  const seenShots = new Set();
  const includeGps = showGpsInReport(project);
  async function keepShot(photo) {
    const key = photoKey(photo);
    if (!photo?.url || seenShots.has(key)) return;
    seenShots.add(key);
    const shot = {
      id: photo.id || key,
      url: photo.url,
      caption: photo.caption || "",
      when: photoWhen(photo),
      place: includeGps ? gpsLabel(photo) : null,
      takenAt: photo.takenAt || null,
      createdAt: photo.createdAt || null,
    };
    try {
      shot.dataUrl = await fetchWithRetry(photo.url);
    } catch (error) {
      console.error(error);
      skipped += 1;
      shot.caption = photo.caption ? `${photo.caption} (bildet mangler)` : "Bildet kunne ikke hentes inn i PDF-en.";
    }
    reportShots.push(shot);
  }
  async function photosForPdf(item) {
    for (const photo of photosByItem[item.id] || []) {
      const marked = {
        ...photo,
        itemId: item.id,
        step: photo.step || item.step || "",
        comment: photo.caption || item.text || "",
        itemText: item.text || "",
        itemTitle: item.title || "",
      };
      if (!photo.url || photo.approved === false || isTrashedPhoto(photo) || !visibleKeys.has(photoKey(marked))) continue;
      await keepShot(marked);
    }
    return [];
  }
  const template = templateFor(project);
  if (template?.steps?.length) {
    const missing = missingTemplateSteps(template.steps, items);
    const doneSteps = template.steps.filter((step) => !missing.includes(step));
    sections.push({
      title: `Bildemal: ${template.name}`,
      items: [
        { title: "Fotografert", text: doneSteps.join(", ") || "Ingen trinn er fotografert ennå.", photos: [], comments: [] },
        missing.length
          ? { title: "Mangler", text: missing.join(", "), photos: [], comments: [] }
          : { title: "Mangler", text: "Alle trinn i malen er fotografert.", photos: [], comments: [] },
      ],
    });
  }
  const drainageSnap = await db.collection("projects").doc(project.id).collection("drainage").get();
  if (!drainageSnap.empty) {
    const drainageItems = [];
    for (const doc of drainageSnap.docs) {
      const data = doc.data();
      for (const photo of data.photos || []) {
        if (!photo.url) continue;
        await keepShot({
          ...photo,
          id: photo.id || photo.url,
          caption: photo.caption || data.name || "",
          createdAt: photo.createdAt || data.updatedAt || data.createdAt,
        });
      }
      drainageItems.push({
        title: data.name || "Strekk",
        text: drainageReportText(data),
        createdAt: data.updatedAt || data.createdAt,
        photos: [],
        comments: [],
      });
    }
    sections.push({ title: "Drenering – dokumentasjon og vurdering", items: drainageItems });
  }
  if (customerSeesCost(project)) {
    const costSnap = await db.collection("projects").doc(project.id).collection("quantities").doc("live").get();
    const logSnap = await db.collection("projects").doc(project.id).collection("costLog").orderBy("at", "desc").limit(80).get();
    const costSettings = await readAppSettings();
    const costSummary = liveCost({ cost: costSnap.data() || null, prices: costSettings.prices, items });
    const costHistory = logSnap.docs.map((entry) => entry.data()).reverse();
    sections.push({
      title: "Nåværende kostnad",
      items: [{
        title: "Oversikt",
        text: costReportText(costSummary, costHistory.map((entry) => ({
          when: formatWhen(entry.at),
          byName: entry.byName || "Einar",
          text: entry.text || changeText(entry),
        }))),
        photos: [],
        comments: [],
      }],
    });
  }
  const approvedOffers = approved.filter((item) => isOfferItem(item) && item.fikenBase !== true && offerStatus(item) === "godkjent");
  if (approvedOffers.length) {
    const offerItems = [{
      title: "Sum godkjent",
      text: formatOfferSum(approvedChoiceSum(approvedOffers)),
      photos: [],
      comments: [],
    }];
    for (const item of approvedOffers) {
      const photos = await photosForPdf(item);
      offerItems.push({
        title: `${offerTypeLabel(item.kind)}: ${item.title || "Post"}`,
        text: [item.text || "", offerDecisionText(item), approvalLine(item)].filter(Boolean).join("\n"),
        createdAt: item.approvedAt || item.createdAt,
        photos,
        comments: (commentsByItem[item.id] || []).filter((comment) => comment.approved !== false && comment.text),
      });
    }
    sections.push({ title: "Tilbud og endringer", items: offerItems });
  }
  for (const [kind, title] of groups) {
    const group = [];
    for (const item of approved.filter((entry) => entry.kind === kind && !(isOfferItem(entry) && offerStatus(entry) === "godkjent"))) {
      const comments = (commentsByItem[item.id] || []).filter((comment) => comment.approved !== false && comment.text);
      if (redundantPhotoItem(item, annotated, { hasComments: comments.length > 0 })) continue;
      const photos = await photosForPdf(item);
      const decision = approvalLine(item);
      group.push({
        title: item.title || item.step || "",
        text: [item.text || "", decision].filter(Boolean).join("\n"),
        createdAt: item.createdAt,
        photos,
        comments,
      });
    }
    if (group.length) sections.push({ title, items: group });
  }
  if (ratings.length) {
    sections.push({
      title: "Kundevurdering",
      items: ratings.map((item) => ({
        title: item.authorName || "Kunde",
        text: item.text || "",
        stars: item.stars,
        createdAt: item.createdAt,
        photos: [],
        comments: [],
      })),
    });
  }
  const result = await generatePdfBlob({
    project,
    reportText,
    sections,
    photos: sortPhotos(reportShots, "oldest"),
  });
  const path = `projects/${project.id}/rapport/sluttrapport.pdf`;
  await storage.ref(path).put(result.blob, { contentType: "application/pdf" });
  const pdfUrl = await storage.ref(path).getDownloadURL();
  const saved = { ...project, pdfUrl, pdfPath: path, reportText };
  await db.collection("projects").doc(project.id).update({
    pdfUrl,
    pdfPath: path,
    pdfUpdatedAt: stamp(),
    updatedAt: stamp(),
  });
  await maybeQueueReportMail(saved);
  try {
    await deliverPdf(result.blob, result.filename);
  } catch (error) {
    if (!isCancel(error)) throw error;
  }
  return { skipped };
}

async function urlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("bilde");
  return blobToDataUrl(await response.blob());
}

async function fetchWithRetry(url) {
  try {
    return await urlToDataUrl(url);
  } catch (error) {
    console.warn("Bilde forsøkes på nytt", error);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return urlToDataUrl(url);
  }
}

async function blobToBase64(blob) {
  const dataUrl = await blobToDataUrl(blob);
  const comma = String(dataUrl).indexOf(",");
  return comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl);
}

async function deliverPdf(blob, filename) {
  const Filesystem = window.Capacitor?.Plugins?.Filesystem;
  const Share = window.Capacitor?.Plugins?.Share;
  const safe = String(filename || "sluttrapport.pdf").replace(/[^\w.\-]+/g, "_");
  if (Filesystem && Share) {
    await withTimeout(Filesystem.writeFile({
      path: safe,
      data: await blobToBase64(blob),
      directory: "CACHE",
    }), 20000);
    const uri = await Filesystem.getUri({ path: safe, directory: "CACHE" });
    await withTimeout(Share.share({
      title: filename,
      files: [uri.uri],
      dialogTitle: "Del rapport",
    }), 20000);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

async function maybeQueueReportMail(project) {
  const email = String(project?.customerEmail || "").trim();
  if (!isCompleted(project) || !project?.pdfUrl || !email.includes("@")) return;
  if (project.reportMailFor === project.pdfUrl) return;
  await db.collection("mail").add({
    to: email,
    message: {
      subject: `Sluttrapport klar: ${project.name || "Prosjekt"}`,
      text: [
        `Hei${project.customerName ? ` ${project.customerName}` : ""}!`,
        "",
        `Sluttrapporten for «${project.name || "prosjektet"}» er klar.`,
        "Åpne prosjektlenken du fikk fra Einar A Børsheim for å laste den ned.",
        "",
        "Vennlig hilsen",
        "Einar A Børsheim",
        "Eriksvei 13",
        "1386 Asker",
      ].join("\n"),
    },
    createdAt: stamp(),
  });
  await db.collection("projects").doc(project.id).update({ reportMailFor: project.pdfUrl, updatedAt: stamp() });
}

function templateChoices() {
  return templates.length ? templates : DEFAULT_TEMPLATES;
}

function templateFor(project) {
  const id = project?.templateId;
  if (!id) return null;
  return templates.find((template) => template.id === id)
    || DEFAULT_TEMPLATES.find((template) => template.id === id)
    || null;
}

function stepsFor(project) {
  const steps = templateFor(project)?.steps;
  return Array.isArray(steps) ? steps.map((step) => String(step || "").trim()).filter(Boolean) : [];
}

function openProjects() {
  return projects.filter((project) => !isTrashed(project) && !isCompleted(project));
}

async function runDictation(textarea) {
  try {
    toast("Lytter … snakk norsk");
    await dictate((spoken) => {
      const base = textarea.value || "";
      const spacer = base && !/\s$/.test(base) ? " " : "";
      textarea.value = `${base}${spacer}${spoken}`;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  } catch (error) {
    console.error(error);
    toast("Tale til tekst virket ikke. Sjekk mikrofontillatelse.");
  }
}

function micButton(textarea) {
  if (!canSpeak()) return null;
  return button("Tale", { class: "btn btn-ghost", onClick: () => runDictation(textarea) });
}

function bindImageRetry(image, url) {
  image.addEventListener("error", () => {
    const tries = Number(image.dataset.tries || 0);
    if (!url || tries >= 3) return;
    image.dataset.tries = String(tries + 1);
    const join = String(url).includes("?") ? "&" : "?";
    image.src = `${url}${join}retry=${tries + 1}`;
  });
}

function pill(text, kind = "") {
  return el("span", { class: `pill ${kind}`.trim() }, text);
}

function itemRow(projectId, item) {
  const title = item.title || item.text || (item.legacy ? "Bilde" : KIND_META[item.kind]?.singular || "Notat");
  const preview = item.title ? item.text : "";
  const node = el("button", { type: "button", class: "row" });
  const thumb = el("span", { class: "thumb" });
  if (item.coverUrl) thumb.append(el("img", { src: item.coverUrl, alt: "" }));
  else thumb.append(icon(item.kind === "avvik" ? "alert" : item.kind === "endring" ? "edit" : item.kind === "kunde" ? "user" : "camera"));
  const body = el("span", { class: "row-body" }, [
    el("span", { class: "row-title" }, title),
    preview ? el("span", { class: "row-text" }, preview) : null,
    el("span", { class: "meta" }, formatWhen(item.createdAt) || "Uten tid"),
  ]);
  const pills = el("span", { class: "pills" });
  if (item.approved === false) pills.append(pill("Venter", "pill-warn"));
  if (item.step) pills.append(pill(item.step));
  if (item.approvalRequested && item.approvalStatus === "godkjent") pills.append(pill("Godkjent", "pill-ok"));
  else if (item.approvalRequested && item.approvalStatus === "avslatt") pills.append(pill("Avslått", "pill-warn"));
  else if (item.approvalRequested) pills.append(pill("Venter på kunde", "pill-warn"));
  if (item.reference) pills.append(pill("Referanse", "pill-ok"));
  if (item.queued) pills.append(pill(item.error ? "Ikke sendt" : "På telefonen", "pill-warn"));
  body.append(pills);
  node.append(thumb, body);
  if (!item.queued) {
    node.addEventListener("click", () => push({
      name: "item",
      projectId,
      itemId: item.legacy ? item.id : item.id,
      legacy: !!item.legacy,
    }));
  }
  return node;
}

function queueCard(item) {
  const card = el("article", { class: "card queue-card" });
  card.append(
    el("p", { class: "row-title" }, item.text || "Bilde"),
    el("p", { class: item.error ? "field-error" : "meta" }, item.error || "Venter på sending"),
    el("p", { class: "meta" }, formatWhen(item.createdAt) || ""),
  );
  if (item.error) {
    card.append(button("Prøv igjen nå", {
      class: "btn btn-ghost",
      onClick: () => retryQueuedItems(item.id),
    }));
  }
  return card;
}

function mountLogin() {
  const error = el("p", { class: "field-error", hidden: true });
  const email = el("input", { type: "email", autocomplete: "username", required: true });
  const password = el("input", { type: "password", autocomplete: "current-password", required: true });
  const form = el("form", { class: "stack" }, [
    field("E-post", email),
    field("Passord", password),
    button("Logg inn", { type: "submit", class: "btn btn-primary btn-block" }),
    error,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      await auth.signInWithEmailAndPassword(email.value.trim(), password.value);
    } catch (err) {
      const code = err?.code || "";
      error.textContent = code.includes("network")
        ? "Ingen nett. Prøv igjen når du er tilkoblet."
        : "Feil e-post eller passord.";
      error.hidden = false;
    }
  });
  main.append(el("section", { class: "screen login-screen" }, [
    el("div", { class: "brand-lockup" }, [
      el("img", { class: "login-logo", src: "assets/logo-256.png", alt: "Einar A Børsheim" }),
      el("strong", {}, COMPANY.name),
      el("h1", { class: "h-app" }, "Internkontroll"),
      el("p", { class: "lead" }, "Feltnotater for hage og anlegg. Ta bildet, skriv kommentaren, og legg til mer senere."),
    ]),
    form,
  ]));
}

async function createOfferItem(projectId, fields) {
  const ref = await db.collection("projects").doc(projectId).collection("items").add({
    kind: fields.kind || "tilbud",
    title: fields.title || "",
    text: fields.text || "",
    alternatives: fields.alternatives || [],
    selectedAlternativeId: "",
    stars: null,
    approved: true,
    reference: false,
    source: "admin",
    createdBy: user?.uid || "",
    authorName: "Einar",
    coverUrl: "",
    approvalRequested: fields.approvalRequested === true,
    approvalStatus: fields.approvalStatus || "",
    createdAt: stamp(),
    updatedAt: stamp(),
  });
  return ref.id;
}

async function sendOfferToFiken(project, item, kind) {
  const settings = await readAppSettings();
  return createFikenDraft({
    kind,
    lines: [{
      label: `${item.title || "Post"}: ${item.alternatives?.find((alternative) => alternative.id === item.selectedAlternativeId)?.name || "Løsning"}`,
      unit: "stk",
      quantity: 1,
      unitPrice: item.alternatives?.find((alternative) => alternative.id === item.selectedAlternativeId)?.priceExVat || 0,
    }],
    title: item.title || "Tilbud",
    project,
    incomeAccount: settings.fikenIncomeAccount,
  });
}

async function createDrainageOffer(project, form) {
  const stored = documentFromForm(form, assessDrainage(form), []);
  const wellExVat = (stored.wells || []).reduce((sum, well) => sum + (well.cost?.exVat || 0), 0);
  const fields = drainageOfferFields({
    name: stored.name || "Drenering",
    description: drainageReportText(stored),
    stretchExVat: stored.cost?.exVat || 0,
    wellExVat,
  });
  const itemId = await createOfferItem(project.id, fields);
  toast("Utkastet ligger i Tilbud og endringer");
  push({ name: "item", projectId: project.id, itemId });
}

function locateAddress() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Posisjon er ikke tilgjengelig i denne nettleseren."));
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      const fallback = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      try {
        const response = await fetch(`https://ws.geonorge.no/adresser/v1/punktsok?lat=${latitude}&lon=${longitude}&radius=100&treffPerSide=1`);
        if (!response.ok) throw new Error("adresse");
        resolve(addressFromGeonorge(await response.json()) || fallback);
      } catch (error) {
        console.warn(error);
        resolve(fallback);
      }
    }, () => reject(new Error("Fikk ikke posisjon. Skriv adressen selv.")), { enableHighAccuracy: true, timeout: 12000 });
  });
}

function mountOffers(route) {
  const root = el("div", { class: "screen" });
  main.append(root);
  let items = [];
  let costDoc = null;
  let costLog = [];
  let priceTable = pricesFromSettings(null);
  let costQueue = Promise.resolve();
  let toldCostRead = false;
  let costSeen = false;
  let costTimer;

  const savePatch = (patch) => {
    const projectId = route.projectId;
    costQueue = costQueue.then(async () => {
      const next = patchCost(costDoc, priceTable, patch);
      const changes = costChanges(costDoc, next, priceTable);
      const structural = patch.addExtra || patch.deleteExtraId || patch.field === "description";
      if (!changes.length && !structural) return;
      const stored = persistableCost(next);
      costDoc = { ...costDoc, ...stored };
      draw();
      await db.collection("projects").doc(projectId).collection("quantities").doc("live").set({
        ...stored,
        updatedAt: stamp(),
      }, { merge: true });
      if (!changes.length) return;
      try {
        await Promise.all(changes.map((change) => db.collection("projects").doc(projectId).collection("costLog").add({
          at: stamp(),
          by: user?.uid || "",
          byName: "Einar",
          lineId: String(change.lineId).slice(0, 39),
          label: String(change.label || "Linje").slice(0, 79),
          field: change.field,
          from: change.from,
          to: change.to,
          unit: change.unit || "",
          text: changeText(change).slice(0, 299),
        })));
      } catch (error) {
        console.error(error);
        toast("Mengden er lagret, men historikken ble ikke skrevet.");
      }
    }).catch((error) => {
      console.error(error);
      toast("Kunne ikke lagre mengden");
    });
  };

  const draw = () => {
    const active = document.activeElement;
    if (active && root.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
      return;
    }
    const project = projectById(route.projectId);
    if (!project) {
      root.replaceChildren(el("p", { class: "empty" }, "Fant ikke prosjektet."));
      return;
    }
    const summary = liveCost({ cost: costDoc, prices: priceTable, items });
    const shareCost = el("input", { type: "checkbox" });
    shareCost.checked = customerSeesCost(project);
    shareCost.addEventListener("change", async () => {
      try {
        await db.collection("projects").doc(project.id).update({
          showCostToCustomer: shareCost.checked === true,
          updatedAt: stamp(),
        });
        toast(shareCost.checked ? "Kunden kan se kostnadsoversikten" : "Kostnadsoversikten er skjult for kunden");
      } catch (error) {
        console.error(error);
        shareCost.checked = customerSeesCost(project);
        toast("Kunne ikke lagre valget");
      }
    });
    const costExtras = [
      el("label", { class: "checkline" }, [
        shareCost,
        el("span", {}, "Vis kostnad for kunden i portalen"),
      ]),
    ];
    if (project.fikenProjectId) {
      costExtras.push(button("Hent linjer fra Fiken", {
        class: "btn btn-ghost btn-block",
        onClick: () => applyFikenOfferLines(project.id, project.fikenProjectId),
      }));
    }
    root.replaceChildren(renderOfferList({
      items,
      project,
      onOpen: (itemId) => push({ name: "item", projectId: route.projectId, itemId }),
      onNew: async () => {
        try {
          const itemId = await createOfferItem(route.projectId, blankOfferFields());
          push({ name: "item", projectId: route.projectId, itemId });
        } catch (error) {
          console.error(error);
          toast("Kunne ikke opprette posten");
        }
      },
      cost: renderCostOverview({
        summary,
        history: costLog.map((entry) => ({
          when: formatWhen(entry.at),
          byName: entry.byName || "Einar",
          text: entry.text || changeText(entry),
        })),
        editable: true,
        showToCustomer: customerSeesCost(project),
        extras: costExtras,
        onAgreed: (value) => savePatch({ field: "agreedExVat", value }),
        onQuantity: (lineId, field, value) => savePatch({ lineId, field, value }),
        onAddExtra: () => savePatch({ addExtra: true, extraId: newExtraId() }),
        onDeleteExtra: (extraId) => savePatch({ deleteExtraId: extraId }),
        onExtra: (extraId, field, value) => savePatch({ extraId, field, value }),
      }),
    }));
  };

  refresh = () => draw();
  subs.push(db.collection("projects").doc(route.projectId).collection("items").onSnapshot((snap) => {
    items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    draw();
  }, (error) => console.error(error)));
  const onCostReadError = (error) => {
    console.error(error);
    clearTimeout(costTimer);
    costTimer = setTimeout(() => {
      if (costSeen || toldCostRead) return;
      toldCostRead = true;
      toast(firestoreReadMessage(error));
    }, 1500);
  };
  subs.push(db.collection("projects").doc(route.projectId).collection("quantities").doc("live").onSnapshot((snap) => {
    costSeen = true;
    clearTimeout(costTimer);
    costDoc = snap.exists ? snap.data() : null;
    draw();
  }, onCostReadError));
  subs.push(db.collection("projects").doc(route.projectId).collection("costLog").orderBy("at", "desc").limit(40).onSnapshot((snap) => {
    costSeen = true;
    clearTimeout(costTimer);
    costLog = snap.docs.map((entry) => entry.data());
    draw();
  }, onCostReadError));
  subs.push(() => clearTimeout(costTimer));
  readAppSettings().then((settings) => {
    priceTable = settings.prices;
    draw();
  });
  draw();
}

function fikenLinkPatch(fields) {
  if (!fields?.fikenProjectId) return {};
  return {
    fikenProjectId: fields.fikenProjectId,
    fikenProjectName: fields.fikenProjectName || "",
    fikenProjectNumber: fields.fikenProjectNumber || "",
  };
}

function mountOrder() {
  main.append(renderQuickOrder({
    onLocate: locateAddress,
    onPhotos: (source) => collectPrepared(source),
    onListFiken: () => callFiken("listFikenProjects", {}),
    isFikenLinked: (projectId) => isFikenLinked(projects, projectId),
    onSubmit: async (input) => {
      if (input.fiken?.fikenProjectId && isFikenLinked(projects, input.fiken.fikenProjectId)) {
        return { ok: false, message: "Det prosjektet er allerede i Internkontroll." };
      }
      const projectRef = await db.collection("projects").add({
        name: input.fiken?.fikenProjectId ? input.fiken.name : quickProjectName(input),
        address: input.address,
        customerName: input.customerName,
        customerPhone: input.phone,
        customerEmail: input.email,
        description: input.description,
        ...fikenLinkPatch(input.fiken),
        templateId: "",
        publicLocation: "",
        publicSummary: "",
        reportText: "",
        shareToken: randomToken(12),
        public: false,
        showGpsInReport: true,
        status: "tilbud",
        completedAt: null,
        pdfUrl: "",
        pdfPath: "",
        reminder1Done: false,
        reminder2Done: false,
        createdAt: stamp(),
        updatedAt: stamp(),
        createdBy: user?.email || "",
      });
      const project = { id: projectRef.id, ...(await projectRef.get()).data() };
      const fields = quickOfferFields(input);
      const itemId = await createOfferItem(project.id, fields);
      if (input.blobs?.length) {
        await ingestBlobs(project.id, "tilbud", input.blobs, { mode: "attach", itemId, title: fields.title, text: fields.text });
      }
      localStorage.setItem("lastProjectId", project.id);
      if (input.fiken?.fikenProjectId) applyFikenOfferLines(project.id, input.fiken.fikenProjectId);
      const url = portalUrl(project.id, project.shareToken);
      const text = offerShareText(project, url);
      const shared = await shareText("Tilbud til kunde", text, url);
      toast("Tilbudet er klart");
      push({ name: "item", projectId: project.id, itemId });
      if (shared === "fallback") {
        openShareSheet({
          title: "Del tilbudet",
          text,
          url,
          phone: input.phone,
          email: input.email,
        });
      }
    },
  }));
}

function mountProjects() {
  const root = el("div", { class: "screen" });
  const list = el("div", { class: "stack" });
  root.append(
    button("Ny bestilling", {
      class: "btn btn-primary btn-block",
      icon: "plus",
      onClick: () => push({ name: "order" }),
    }),
    button("Nytt prosjekt", {
      class: "btn btn-ghost btn-block",
      onClick: () => push({ name: "form" }),
    }),
    renderFikenPicker({
      buttonLabel: "Hent fra Fiken",
      pickLabel: "Importer",
      intro: "Disse ligger i Fiken, men ikke i Internkontroll.",
      emptyText: "Alle åpne Fiken-prosjekter ligger allerede i Internkontroll.",
      removeOnPick: true,
      onList: async () => {
        const result = await callFiken("listFikenProjects", {});
        return { projects: unimportedFikenProjects(result?.projects, projects) };
      },
      onPick: (card) => importFikenProject(card),
    }),
    el("div", { class: "action-row" }, [
      button("Fullførte", { class: "btn btn-ghost", onClick: () => push({ name: "done" }) }),
      button("Papirkurv", { class: "btn btn-ghost", onClick: () => push({ name: "trash" }) }),
      button("Bildemaler", { class: "btn btn-ghost", onClick: () => push({ name: "templates" }) }),
    ]),
    list
  );
  main.append(root);
  const draw = () => {
    list.replaceChildren();
    const visible = openProjects();
    if (!visible.length) {
      list.append(el("p", { class: "empty" }, projects.length
        ? "Ingen tilbud eller pågående prosjekter. Fullførte ligger under Fullførte."
        : "Ingen prosjekter ennå. Opprett det første, så kan du ta bilder med en gang."));
      return;
    }
    const lastId = localStorage.getItem("lastProjectId");
    const ordered = [...visible].sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : 0));
    const first = ordered[0];
    if (first) {
      const hero = el("div", { class: "card continue" }, [
        el("p", { class: "meta" }, "Fortsett"),
        el("h2", {}, first.name),
        el("p", { class: "meta" }, [first.address, first.customerName].filter(Boolean).join(" · ") || "Åpne prosjektet eller ta et bilde"),
        first.fikenProjectId ? el("div", { class: "pills" }, [pill("Fiken")]) : null,
        el("div", { class: "action-row" }, [
          button("Ta bilde", {
            class: "btn btn-primary",
            icon: "camera",
            onClick: () => {
              captureKind = "bilde";
              localStorage.setItem("lastProjectId", first.id);
              push({ name: "capture", projectId: first.id });
            },
          }),
          button("Åpne", { class: "btn btn-ghost", onClick: () => openProject(first.id) }),
        ]),
      ]);
      list.append(hero);
    }
    for (const project of ordered) {
      const waiting = queueItems.filter((item) => item.projectId === project.id && !item.held).length;
      const card = el("button", { type: "button", class: "row project-card" }, [
        el("span", { class: "icon-round" }, [icon("projects")]),
        el("span", { class: "row-body" }, [
          el("span", { class: "row-title" }, project.name || "Uten navn"),
          el("span", { class: "row-text" }, [project.customerName, project.address].filter(Boolean).join(" · ")),
          el("span", { class: "pills" }, [
            pill(phaseLabel(project), project.status === "tilbud" ? "pill-warn" : ""),
            project.fikenProjectId ? pill("Fiken") : null,
            project.public ? pill("Referanse") : null,
            waiting ? pill(`${waiting} venter`, "pill-warn") : null,
          ]),
        ]),
      ]);
      card.addEventListener("click", () => openProject(project.id));
      list.append(el("div", { class: "project-entry" }, [
        card,
        button("Se som kunde", { class: "btn btn-ghost", onClick: () => previewAsCustomer(project) }),
      ]));
    }
  };
  refresh = draw;
  watchQueue(draw);
  draw();
}

async function importFikenProject(card) {
  const fields = fieldsFromFiken(card);
  if (!fields.fikenProjectId) {
    toast("Fiken-prosjektet mangler id og kan ikke importeres.");
    return false;
  }
  if (isFikenLinked(projects, fields.fikenProjectId)) {
    toast("Det prosjektet er allerede i Internkontroll.");
    return false;
  }
  const ref = await db.collection("projects").add({
    name: fields.name,
    address: fields.address,
    customerName: fields.customerName,
    customerPhone: fields.customerPhone,
    customerEmail: fields.customerEmail,
    description: "",
    templateId: "",
    ...fikenLinkPatch(fields),
    publicLocation: "",
    publicSummary: "",
    reportText: "",
    shareToken: randomToken(12),
    public: false,
    showGpsInReport: true,
    status: "aktiv",
    completedAt: null,
    pdfUrl: "",
    pdfPath: "",
    reminder1Done: false,
    reminder2Done: false,
    createdAt: stamp(),
    updatedAt: stamp(),
    createdBy: user?.email || "",
  });
  toast("Prosjektet er hentet fra Fiken");
  applyFikenOfferLines(ref.id, fields.fikenProjectId);
  return true;
}

function openProject(projectId) {
  localStorage.setItem("lastProjectId", projectId);
  push({ name: "project", projectId });
}

function mountReminders() {
  const list = el("div", { class: "stack" });
  main.append(el("div", { class: "screen" }, [
    el("p", { class: "lead" }, "Hager trenger tid. Del lenken ca. ett og to år etter ferdigstillelse, så kan kunden legge igjen stjerner og en kommentar."),
    list,
  ]));
  const draw = () => {
    list.replaceChildren();
    const rows = [];
    for (const project of projects) {
      for (const entry of reminderPlan(project)) {
        if (entry.state === "done") continue;
        rows.push({ project, entry });
      }
    }
    rows.sort((a, b) => a.entry.due - b.entry.due);
    const due = rows.filter((row) => row.entry.state === "due");
    const later = rows.filter((row) => row.entry.state === "scheduled");
    if (!rows.length) {
      list.append(el("p", { class: "empty" }, "Ingen påminnelser ennå. Marker et prosjekt som fullført, så vises vurdering her ett og to år etterpå."));
      return;
    }
    const section = (title, items) => {
      if (!items.length) return;
      list.append(el("h2", { class: "h-app" }, title));
      for (const { project, entry } of items) {
        const card = el("article", { class: "card continue" }, [
          el("p", { class: "meta" }, `${entry.year} år · ${reminderWhenLabel(entry)}`),
          el("h2", {}, project.name),
          el("p", { class: "meta" }, [
            project.customerName,
            project.customerPhone,
            project.customerEmail,
            formatDay(entry.due),
          ].filter(Boolean).join(" · ") || "Ingen telefon eller e-post er lagret"),
          el("div", { class: "action-row" }, [
            button("Del påminnelse", {
              class: "btn btn-primary",
              icon: "share",
              onClick: async () => {
                const shared = await shareProject(project, entry.year);
                if (!shared) return;
                await db.collection("projects").doc(project.id).update({
                  [`reminder${entry.year}Done`]: true,
                  updatedAt: stamp(),
                });
                toast("Påminnelse delt og merket som fulgt opp");
              },
            }),
            button("Merk fulgt opp", {
              class: "btn btn-ghost",
              onClick: async () => {
                await db.collection("projects").doc(project.id).update({
                  [`reminder${entry.year}Done`]: true,
                  updatedAt: stamp(),
                });
                toast("Merket som fulgt opp");
              },
            }),
          ]),
        ]);
        list.append(card);
      }
    };
    section("Forfalt", due);
    section("Planlagt", later);
  };
  refresh = draw;
  draw();
}

function mountCapture(route) {
  const root = el("div", { class: "screen" });
  main.append(root);
  const draw = () => {
    const projectId = route.projectId && projectById(route.projectId) ? route.projectId : localStorage.getItem("lastProjectId");
    const project = projectById(projectId) || projects[0] || null;
    root.replaceChildren();
    if (!projects.length) {
      root.append(
        el("h1", { class: "h-app" }, "Ingen prosjekt ennå"),
        el("p", { class: "lead" }, "Opprett et prosjekt, så kan bildet lande riktig sted."),
        button("Nytt prosjekt", { class: "btn btn-primary", icon: "plus", onClick: () => push({ name: "form" }) })
      );
      return;
    }
    const active = project || openProjects()[0] || projects.find((item) => !isTrashed(item)) || projects[0];
    if (!active) {
      root.append(el("p", { class: "empty" }, "Ingen prosjekt ennå."));
      return;
    }
    if (route.projectId !== active.id) {
      route.projectId = active.id;
    }
    const chips = el("div", { class: "chip-row" });
    for (const [kind, meta] of Object.entries(KIND_META)) {
      if (kind === "kunde") continue;
      const chip = button(meta.singular, {
        class: `chip ${captureKind === kind ? "chip-on" : ""}`,
        onClick: () => {
          captureKind = kind;
          updateChrome();
          draw();
        },
      });
      chip.dataset.kind = kind;
      chips.append(chip);
    }
    const steps = stepsFor(active);
    if (captureStep && !steps.includes(captureStep)) captureStep = "";
    const stepRow = el("div", { class: "chip-row" });
    if (steps.length && captureKind === "bilde") {
      const none = button("Uten trinn", {
        class: `chip ${captureStep ? "" : "chip-on"}`,
        onClick: () => {
          captureStep = "";
          draw();
        },
      });
      stepRow.append(none);
      for (const step of steps) {
        stepRow.append(button(step, {
          class: `chip ${captureStep === step ? "chip-on" : ""}`,
          onClick: () => {
            captureStep = step;
            draw();
          },
        }));
      }
    }
    const picker = el("div", { class: "stack" });
    let open = false;
    const toggle = button("Bytt prosjekt", {
      class: "btn btn-ghost",
      onClick: () => {
        open = !open;
        picker.hidden = !open;
      },
    });
    picker.hidden = true;
    for (const item of projects.filter((entry) => !isTrashed(entry))) {
      picker.append(button(item.name, {
        class: `btn ${item.id === active.id ? "btn-primary" : "btn-ghost"} btn-block`,
        onClick: () => {
          localStorage.setItem("lastProjectId", item.id);
          replaceTop({ name: "capture", projectId: item.id });
        },
      }));
    }
    root.append(
      el("section", { class: "capture-hero" }, [
        el("div", {}, [
          el("p", {}, "Lagres i"),
          el("h1", { class: "h-app" }, active.name),
        ]),
        el("p", {}, online ? "Bildet får en kommentar nå. Flere kommentarer kan legges til senere." : "Ingen nett. Bildet blir liggende på telefonen til det kan sendes."),
      ]),
      chips,
      steps.length && captureKind === "bilde" ? el("p", { class: "meta" }, "Velg trinn i bildemalen, så blir rapporten komplett.") : null,
      stepRow,
      button("Ta bilde", {
        class: "shutter",
        icon: "camera",
        onClick: () => startCapture(active.id, captureKind, "camera"),
      }),
      button("Velg fra bilder", {
        class: "btn btn-ghost btn-block",
        icon: "image",
        onClick: () => startCapture(active.id, captureKind, "gallery"),
      }),
      toggle,
      picker
    );
  };
  refresh = draw;
  draw();
}

function mountProject(route) {
  const root = el("div", { class: "screen" });
  main.append(root);
  let items = [];
  let legacy = [];
  let drainageCount = 0;
  let hmsCount = 0;
  let fikenQuotes = [];
  const draw = () => {
    const active = document.activeElement;
    if (active && root.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
      return;
    }
    const project = projectById(route.projectId);
    root.replaceChildren();
    if (!project) {
      root.append(el("p", { class: "empty" }, "Fant ikke prosjektet."));
      return;
    }
    const count = (kind) => items.filter((item) => item.kind === kind).length + (kind === "bilde" ? legacy.length : 0);
    const pendingKunde = items.filter((item) => item.kind === "kunde" && item.approved === false).length;
    const pendingRating = items.filter((item) => item.kind === "vurdering" && item.approved === false).length;
    const queued = queueItems.filter((item) => item.projectId === project.id && !item.held).length;
    const finished = isCompleted(project);
    const actions = [
      button("Rediger", { class: "btn btn-ghost", onClick: () => push({ name: "form", projectId: project.id }) }),
      button("Del med kunde", { class: "btn btn-ghost", icon: "share", onClick: () => shareProject(project) }),
      button("Se som kunde", { class: "btn btn-ghost", onClick: () => previewAsCustomer(project) }),
      button(finished ? "Sett aktiv" : "Meld ferdig", {
        class: "btn btn-primary",
        onClick: () => toggleComplete(project),
      }),
    ];
    if (!finished && project.status !== "tilbud") {
      actions.push(button("Merk som tilbud", { class: "btn btn-ghost", onClick: () => setProjectStatus(project, "tilbud") }));
    }
    if (!finished && project.status === "tilbud") {
      actions.push(button("Sett pågår", { class: "btn btn-ghost", onClick: () => setProjectStatus(project, "aktiv") }));
    }
    if (!isTrashed(project)) {
      actions.push(button("Flytt til papirkurv", { class: "btn btn-danger", onClick: () => moveToTrash(project) }));
    }
    const info = el("section", { class: "card continue" }, [
      el("div", { class: "pills" }, [
        pill(phaseLabel(project), project.status === "tilbud" ? "pill-warn" : ""),
        project.public ? pill("Offentlig referanse") : null,
        pendingKunde ? pill(`${pendingKunde} fra kunde`, "pill-warn") : null,
        pendingRating ? pill(`${pendingRating} vurdering`, "pill-warn") : null,
      ]),
      el("h1", { class: "h-app" }, project.name),
      el("p", { class: "meta" }, [project.customerName, project.address].filter(Boolean).join(" · ") || "Legg inn kunde og adresse under Rediger"),
      project.completedAt && finished ? el("p", { class: "meta" }, `Ferdig ${formatDay(project.completedAt)}`) : null,
      el("div", { class: "action-row" }, actions),
    ]);
    const tiles = el("div", { class: "dash" });
    const offerItems = items.filter((item) => isOfferItem(item) && item.fikenBase !== true);
    const offerSum = approvedChoiceSum(offerItems);
    const offersTile = el("button", { type: "button", class: "tile tile-tilbud" }, [
      el("span", { class: "tile-ico" }, [icon("file")]),
      el("span", {}, [
        el("span", { class: "tile-label" }, "Tilbud og endringer"),
        el("span", { class: "tile-count" }, offerSum.count
          ? `${offerItems.length} poster · ${formatOfferSum(offerSum).split(".")[0]}`
          : `${offerItems.length} poster`),
      ]),
    ]);
    offersTile.addEventListener("click", () => push({ name: "offers", projectId: project.id }));
    tiles.append(offersTile);
    const drainageTile = el("button", { type: "button", class: "tile tile-drenering" }, [
      el("span", { class: "tile-ico" }, [icon("drop")]),
      el("span", {}, [
        el("span", { class: "tile-label" }, "Drenering"),
        el("span", { class: "tile-count" }, `${drainageCount} strekk`),
      ]),
    ]);
    drainageTile.addEventListener("click", () => push({ name: "drainage", projectId: project.id }));
    const tileSpec = [
      ["bilde", "camera", "Bilder", count("bilde") + queued],
      ["kunde", "user", "Fra kunde", count("kunde")],
      ["endring", "edit", "Endringer", count("endring")],
      ["avvik", "alert", "Avvik", count("avvik")],
      ["tilbud", "file", "Tilbud", fikenQuotes.length],
    ];
    for (const [kind, ic, label, total] of tileSpec) {
      const tile = el("button", { type: "button", class: kind === "bilde" ? "tile" : `tile tile-${kind}` }, [
        el("span", { class: "tile-ico" }, [icon(ic)]),
        el("span", {}, [
          el("span", { class: "tile-label" }, label),
          el("span", { class: "tile-count" }, kind === "tilbud"
            ? (total ? `${total} fra Fiken` : "Ingen fra Fiken")
            : `${total} ${total === 1 ? "punkt" : "punkter"}`),
        ]),
      ]);
      tile.addEventListener("click", () => push({ name: "section", projectId: project.id, kind }));
      tiles.append(tile);
    }
    tiles.append(drainageTile);
    const report = el("button", { type: "button", class: "tile tile-rapport" }, [
      el("span", { class: "tile-ico" }, [icon("file")]),
      el("span", { class: "tile-copy" }, [
        el("span", { class: "tile-label" }, "Rapport"),
        el("span", { class: "tile-count" }, project.pdfUrl ? "PDF lagret" : "Skriv og lag PDF"),
      ]),
    ]);
    report.addEventListener("click", () => push({ name: "report", projectId: project.id }));
    tiles.append(report);
    const hmsTile = el("button", { type: "button", class: "tile tile-hms" }, [
      el("span", { class: "tile-ico" }, [icon("file")]),
      el("span", { class: "tile-copy" }, [
        el("span", { class: "tile-label" }, "HMS"),
        el("span", { class: "tile-count" }, hmsCountLabel(hmsCount)),
      ]),
    ]);
    hmsTile.addEventListener("click", () => push({ name: "hms", projectId: project.id }));
    tiles.append(hmsTile);
    const extra = el("div", { class: "action-row" }, [
      button("Meldinger", { class: "btn btn-ghost", onClick: () => push({ name: "messages", projectId: project.id }) }),
      button("Dokumenter", { class: "btn btn-ghost", onClick: () => push({ name: "documents", projectId: project.id }) }),
    ]);
    root.append(
      info,
      renderFikenProjectBox({
        project,
        onList: () => callFiken("listFikenProjects", {}),
        onCreate: async (payload) => {
          const linked = await callFiken("linkFikenProject", { projectId: project.id, ...payload });
          const linkedId = Number(linked?.fikenProjectId || payload?.fikenProjectId);
          if (linkedId) await applyFikenOfferLines(project.id, linkedId);
          return linked;
        },
      }),
      customerBox(project),
      templateBox(project, () => setTimeout(draw, 0)),
      tiles,
      extra,
    );
  };
  refresh = () => draw();
  watchQueue(draw);
  subs.push(db.collection("projects").doc(route.projectId).collection("items").onSnapshot((snap) => {
    items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }));
  subs.push(db.collection("projects").doc(route.projectId).collection("fikenOffers").onSnapshot((snap) => {
    fikenQuotes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }, (error) => console.error(error)));
  subs.push(db.collection("projects").doc(route.projectId).collection("photos").onSnapshot((snap) => {
    legacy = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }));
  subs.push(db.collection("projects").doc(route.projectId).collection("drainage").onSnapshot((snap) => {
    drainageCount = snap.size;
    draw();
  }, (error) => console.error(error)));
  subs.push(db.collection("projects").doc(route.projectId).collection("hmsDocs").onSnapshot((snap) => {
    hmsCount = activeHmsDocs(snap.docs.map((entry) => entry.data())).length;
    draw();
  }, (error) => console.error(error)));
  draw();
}

async function loadDrainagePhotos(projectId) {
  const photos = [];
  const items = await db.collection("projects").doc(projectId).collection("items").where("kind", "==", "bilde").get();
  for (const item of items.docs) {
    const sub = await item.ref.collection("photos").get();
    for (const photo of sub.docs) {
      const data = photo.data();
      if (!data.url || isTrashedPhoto(data)) continue;
      photos.push({
        id: `${item.id}/${photo.id}`,
        itemId: item.id,
        url: data.url,
        caption: data.caption || item.data().title || item.data().text || "",
        comment: data.caption || item.data().text || "",
        step: item.data().step || "",
        createdAt: data.createdAt || item.data().createdAt,
        approved: data.approved,
        best: data.best,
        groupId: data.groupId || "",
        trashed: data.trashed === true,
      });
    }
  }
  const legacy = await db.collection("projects").doc(projectId).collection("photos").get();
  for (const doc of legacy.docs) {
    const data = doc.data();
    if (!data.url || isTrashedPhoto(data)) continue;
    photos.push({
      id: `legacy/${doc.id}`,
      itemId: `legacy-${doc.id}`,
      url: data.url,
      caption: data.caption || "",
      comment: data.caption || "",
      createdAt: data.createdAt,
      approved: data.approved,
      best: data.best,
      groupId: data.groupId || "",
      trashed: false,
    });
  }
  return photos;
}

async function readAppSettings() {
  try {
    const snap = await db.collection("settings").doc("app").get();
    const data = snap.data() || {};
    return {
      frostClientId: resolveFrostClientId(FROST_CLIENT_ID, data.frostClientId || ""),
      prices: pricesFromSettings(data),
      byggforskReference: String(data.byggforskReference || "").trim() || DEFAULT_BYGGFORSK_REFERENCE,
      fikenIncomeAccount: String(data.fikenIncomeAccount || "3000").trim() || "3000",
    };
  } catch (error) {
    console.warn("Innstillinger", error);
    return {
      frostClientId: resolveFrostClientId(FROST_CLIENT_ID, ""),
      prices: pricesFromSettings(null),
      byggforskReference: DEFAULT_BYGGFORSK_REFERENCE,
      fikenIncomeAccount: "3000",
    };
  }
}

async function applyFikenOfferLines(projectId, fikenProjectId) {
  const id = Number(fikenProjectId);
  if (!projectId || !Number.isInteger(id) || id <= 0) return;
  try {
    const result = await callFiken("listFikenOfferLines", { fikenProjectId: id });
    const incoming = result?.lines || [];
    const quotes = quotesFromFikenResult(result);
    if (!incoming.length && !quotes.length) {
      toast("Fiken har ingen tilbud eller ordrebekreftelser på dette prosjektet.");
      return;
    }
    const ref = db.collection("projects").doc(projectId).collection("quantities").doc("live");
    const snap = await readDocWithRetry((options) => (options ? ref.get(options) : ref.get()));
    const current = snap.exists ? snap.data() : {};
    let lineNote = "";
    if (incoming.length) {
      let overwrite = false;
      let merged = mergeFikenLines(current.fikenLines, incoming, { overwriteManual: false });
      if (merged.conflicts.length) {
        overwrite = window.confirm("Noen linjer fra Fiken er endret i Internkontroll. Vil du overskrive dem med tilbudet fra Fiken?");
        if (overwrite) merged = mergeFikenLines(current.fikenLines, incoming, { overwriteManual: true });
      }
      const next = { ...current, fikenLines: merged.lines };
      const changes = costChanges(current, next);
      if (changes.length) {
        await ref.set({ fikenLines: merged.lines, updatedAt: stamp() }, { merge: true });
        await Promise.all(changes.map((change) => ref.parent.parent.collection("costLog").add({
          at: stamp(),
          by: user?.uid || "",
          byName: "Einar",
          lineId: String(change.lineId).slice(0, 39),
          label: String(change.label || "Linje").slice(0, 79),
          field: change.field,
          from: change.from,
          to: change.to,
          unit: change.unit || "",
          text: changeText(change).slice(0, 299),
        })));
        lineNote = merged.conflicts.length && !overwrite
          ? "Nye linjer fra Fiken er fylt inn. Linjer du har endret ble beholdt."
          : "Linjene fra Fiken-tilbudet er fylt inn.";
      } else {
        lineNote = merged.conflicts.length
          ? "Linjer du har endret ble beholdt."
          : "Tilbudslinjene fra Fiken er allerede hentet.";
      }
    }
    const offerNote = quotes.length ? await saveFikenQuotes(projectId, quotes) : "";
    const note = [lineNote, offerNote].filter(Boolean).join(" ");
    toast(note || "Tilbudet fra Fiken er allerede hentet.");
  } catch (error) {
    console.error(error);
    toast(error?.name === "FirestoreReadError" ? error.message : fikenUnreachableMessage(error));
  }
}

async function saveFikenQuotes(projectId, quotes) {
  const col = db.collection("projects").doc(projectId).collection("fikenOffers");
  const records = quotes.map(fikenQuoteRecord).filter((quote) => quote.key);
  const keys = new Set(records.map((quote) => quote.key));
  const existing = await col.get();
  for (const doc of existing.docs) {
    if (!keys.has(doc.id)) await doc.ref.delete();
  }
  for (const record of records) {
    await col.doc(record.key).set({ ...record, updatedAt: stamp() });
  }
  const items = await db.collection("projects").doc(projectId).collection("items").get();
  for (const doc of items.docs) {
    if (doc.data().fikenBase === true) await doc.ref.delete();
  }
  return "Hele tilbudet ligger under Tilbud.";
}

async function callFiken(name, data) {
  const current = auth.currentUser;
  if (!current) throw new Error("Ikke innlogget");
  const token = await current.getIdToken();
  const response = await fetch(`https://europe-west1-einar-borsheim-internkon-ee8b6.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || "Fiken-funksjonen er ikke tilgjengelig");
  }
  return body.result || body;
}

async function createFikenDraft({ kind, lines, title, project, incomeAccount }) {
  return callFiken("createFikenDraft", {
    kind,
    customerName: project.customerName || "",
    customerEmail: project.customerEmail || "",
    address: project.address || "",
    title: title || project.name || "Drenering",
    lines: fikenDraftLines(lines),
    incomeAccount: incomeAccount || "3000",
  });
}

async function sendOfferToFikenProject(project, item) {
  if (!project?.id || !item?.id) throw new Error("Fant ikke posten.");
  return callFiken("syncOfferToFikenProject", { projectId: project.id, itemId: item.id });
}

function mountDrainage(route) {
  const root = el("div", { class: "screen" });
  main.append(root);
  let points = [];
  let photos = [];
  let clientId = FROST_CLIENT_ID || "";
  let prices = pricesFromSettings(null);
  let defaultReference = DEFAULT_BYGGFORSK_REFERENCE;
  let incomeAccount = "3000";
  const draw = () => {
    const active = document.activeElement;
    if (active && root.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
      return;
    }
    const project = projectById(route.projectId);
    root.replaceChildren();
    if (!project) {
      root.append(el("p", { class: "empty" }, "Fant ikke prosjektet."));
      return;
    }
    if (!route.docId) {
      root.append(renderDrainageList({
        points,
        onOpen: (docId) => push({ name: "drainage", projectId: project.id, docId }),
        onNew: () => push({ name: "drainage", projectId: project.id, docId: "ny" }),
      }));
      return;
    }
    const existing = route.docId === "ny" ? null : points.find((point) => point.id === route.docId);
    if (route.docId !== "ny" && !existing) {
      root.append(el("p", { class: "empty" }, "Henter strekk…"));
      return;
    }
    root.append(renderDrainageForm({
      model: existing ? formFromDoc(existing) : emptyDrainageForm(),
      photos,
      hasClient: !!clientId,
      prices,
      defaultReference,
      onCreateOffer: (form) => createDrainageOffer(project, form),
      onSavePrices: async (lines) => {
        const next = pricesFromLines(lines, prices);
        await db.collection("settings").doc("app").set({
          prices: next,
          updatedAt: stamp(),
        }, { merge: true });
        prices = next;
        toast("Standardprisene er lagret");
        return next;
      },
      onFiken: (payload) => createFikenDraft({ ...payload, project, incomeAccount }),
      onSave: async (form, assessment) => {
        try {
          const ref = existing
            ? db.collection("projects").doc(project.id).collection("drainage").doc(existing.id)
            : db.collection("projects").doc(project.id).collection("drainage").doc();
          const payload = documentFromForm(form, assessment, photos);
          payload.updatedAt = stamp();
          if (!existing) payload.createdAt = stamp();
          await ref.set(payload, { merge: true });
          toast("Strekket er lagret");
          history.back();
        } catch (error) {
          console.error(error);
          toast("Kunne ikke lagre strekket");
        }
      },
      onDelete: existing ? async () => {
        if (!window.confirm("Slette dette strekket?")) return;
        try {
          await db.collection("projects").doc(project.id).collection("drainage").doc(existing.id).delete();
          toast("Strekket er slettet");
          history.back();
        } catch (error) {
          console.error(error);
          toast("Kunne ikke slette strekket");
        }
      } : null,
      onRain: (query) => fetchFrostRain({
        clientId,
        latitude: Number(String(query.latitude).replace(",", ".")),
        longitude: Number(String(query.longitude).replace(",", ".")),
        date: query.date,
      }),
    }));
  };
  refresh = () => draw();
  readAppSettings().then((settings) => {
    clientId = settings.frostClientId;
    prices = settings.prices;
    defaultReference = settings.byggforskReference;
    incomeAccount = settings.fikenIncomeAccount;
    if (route.docId) draw();
  });
  loadDrainagePhotos(route.projectId).then((list) => {
    photos = list;
    if (route.docId) draw();
  }).catch((error) => console.error(error));
  subs.push(db.collection("projects").doc(route.projectId).collection("drainage").onSnapshot((snap) => {
    points = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    points.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    draw();
  }, (error) => console.error(error)));
  draw();
}

async function toggleComplete(project) {
  try {
    if (isCompleted(project)) {
      await db.collection("projects").doc(project.id).update({ status: "aktiv", completedAt: null, updatedAt: stamp() });
      toast("Prosjektet er aktivt igjen");
    } else {
      await db.collection("projects").doc(project.id).update({
        status: "fullfort",
        completedAt: project.completedAt || stamp(),
        reminder1Done: false,
        reminder2Done: false,
        updatedAt: stamp(),
      });
      await maybeQueueReportMail({ ...project, status: "fullfort" });
      toast("Markert som ferdig. Påminnelse vises om ca. ett år.");
    }
  } catch (error) {
    console.error(error);
    toast("Kunne ikke oppdatere status");
  }
}

async function setProjectStatus(project, status) {
  try {
    const patch = { status, updatedAt: stamp() };
    if (status !== "fullfort") patch.completedAt = null;
    await db.collection("projects").doc(project.id).update(patch);
    toast(status === "tilbud" ? "Vises som tilbud" : "Vises som pågående");
  } catch (error) {
    console.error(error);
    toast("Kunne ikke oppdatere status");
  }
}

function customerBox(project) {
  const name = el("input", { type: "text", maxlength: "120", value: project.customerName || "", placeholder: "Kundens navn" });
  let timer;
  name.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      db.collection("projects").doc(project.id).update({
        customerName: name.value.trim(),
        updatedAt: stamp(),
      }).catch((error) => {
        console.error(error);
        toast("Kunne ikke lagre kundenavnet");
      });
    }, 600);
  });
  name.addEventListener("blur", () => setTimeout(() => refresh(), 0));
  const link = el("input", { type: "text", readonly: true, value: "Henter lenke…" });
  ensureToken(project).then((token) => {
    link.value = portalUrl(project.id, token);
  }).catch(() => {
    link.value = "";
  });
  return el("section", { class: "card continue customer-box" }, [
    el("h2", { class: "h-app" }, "Kunde"),
    el("p", { class: "meta" }, "Navn og lenke kunden bruker for å se prosjektet, sende meldinger og godkjenne tilbud."),
    field("Kundenavn", name),
    field("Lenke til kunden", link),
    el("div", { class: "action-row" }, [
      button("Kopier lenke", {
        class: "btn btn-ghost",
        onClick: async () => {
          const token = await ensureToken(project);
          const url = portalUrl(project.id, token);
          link.value = url;
          try {
            await navigator.clipboard.writeText(url);
            toast("Lenken er kopiert");
          } catch (error) {
            console.error(error);
            toast("Kunne ikke kopiere. Merk lenken og kopier den selv.");
          }
        },
      }),
      button("Del lenke", {
        class: "btn btn-primary",
        icon: "share",
        onClick: () => shareProject(project),
      }),
      button("Se som kunde", {
        class: "btn btn-ghost",
        onClick: () => previewAsCustomer(project),
      }),
    ]),
  ]);
}

function templateBox(project, afterChange) {
  const select = el("select");
  select.append(el("option", { value: "" }, "Ingen bildemal"));
  for (const template of templateChoices()) {
    const option = el("option", { value: template.id }, template.name);
    if (project.templateId === template.id) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    try {
      await db.collection("projects").doc(project.id).update({ templateId: select.value, updatedAt: stamp() });
      toast(select.value ? "Bildemal valgt" : "Bildemal fjernet");
      afterChange?.();
    } catch (error) {
      console.error(error);
      toast("Kunne ikke lagre bildemalen");
    }
  });
  const template = templateFor({ ...project, templateId: select.value });
  return el("section", { class: "card continue" }, [
    field("Bildemal", select),
    template ? el("p", { class: "meta" }, template.steps.join(" · ")) : el("p", { class: "meta" }, "Velg en mal så bildene følger trinnene i rapporten."),
  ]);
}

async function moveToTrash(project) {
  if (!window.confirm("Flytte prosjektet til papirkurven? Bilder og dokumenter slettes automatisk etter 90 dager.")) return;
  try {
    await db.collection("projects").doc(project.id).update({
      trashed: true,
      trashedAt: stamp(),
      updatedAt: stamp(),
    });
    toast("Lagt i papirkurven");
    history.back();
  } catch (error) {
    console.error(error);
    toast("Kunne ikke flytte prosjektet");
  }
}

async function permanentlyDeleteProject(projectId) {
  const root = db.collection("projects").doc(projectId);
  const projectSnap = await root.get();
  const data = projectSnap.data() || {};
  const photos = await root.collection("photos").get();
  for (const photo of photos.docs) {
    const comments = await photo.ref.collection("comments").get();
    for (const comment of comments.docs) await comment.ref.delete();
    if (photo.data().storagePath) await storage.ref(photo.data().storagePath).delete().catch(() => {});
    await photo.ref.delete();
  }
  const itemSnap = await root.collection("items").get();
  for (const item of itemSnap.docs) {
    const [itemPhotos, comments] = await Promise.all([
      item.ref.collection("photos").get(),
      item.ref.collection("comments").get(),
    ]);
    for (const photo of itemPhotos.docs) {
      if (photo.data().storagePath) await storage.ref(photo.data().storagePath).delete().catch(() => {});
      await photo.ref.delete();
    }
    for (const comment of comments.docs) await comment.ref.delete();
    await item.ref.delete();
  }
  const messages = await root.collection("messages").get();
  for (const message of messages.docs) {
    if (message.data().imagePath) await storage.ref(message.data().imagePath).delete().catch(() => {});
    await message.ref.delete();
  }
  const documents = await root.collection("documents").get();
  for (const entry of documents.docs) {
    if (entry.data().storagePath) await storage.ref(entry.data().storagePath).delete().catch(() => {});
    await entry.ref.delete();
  }
  const hmsDocs = await root.collection("hmsDocs").get();
  for (const entry of hmsDocs.docs) {
    if (entry.data().storagePath) await storage.ref(entry.data().storagePath).delete().catch(() => {});
    await entry.ref.delete();
  }
  const access = await root.collection("access").get();
  for (const entry of access.docs) await entry.ref.delete();
  if (data.pdfPath) await storage.ref(data.pdfPath).delete().catch(() => {});
  await db.collection("references").doc(projectId).delete().catch(() => {});
  await root.delete();
}

function purgeOldTrash() {
  for (const project of projects) {
    if (!project.trashed || purging.has(project.id)) continue;
    const age = daysSince(project.trashedAt);
    if (age == null || age < TRASH_DAYS) continue;
    purging.add(project.id);
    permanentlyDeleteProject(project.id).catch((error) => {
      console.error(error);
      purging.delete(project.id);
    });
  }
}

function onceUnsub(stop) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stop();
  };
}

const exifSession = new Set();

function backfillPhotoTimes(photos) {
  const pending = (photos || []).filter((photo) => needsExifBackfill(photo) && !exifSession.has(photoKey(photo)));
  for (const photo of pending) exifSession.add(photoKey(photo));
  let cursor = 0;
  async function next() {
    while (cursor < pending.length) {
      const photo = pending[cursor];
      cursor += 1;
      try {
        const response = await fetch(photo.url);
        if (!response.ok) continue;
        const patch = exifBackfillPatch(readExifMeta(await response.arrayBuffer()));
        const update = { exifChecked: true };
        if (patch.takenAtMillis) update.takenAt = firebase.firestore.Timestamp.fromMillis(patch.takenAtMillis);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(photo.ref);
          if (snap.data()?.takenAt) {
            tx.update(photo.ref, { exifChecked: true });
            return;
          }
          tx.update(photo.ref, update);
        });
      } catch (error) {
        console.error(error);
      }
    }
  }
  Promise.all([next(), next()]).catch((error) => console.error(error));
}

function photoHandlers(projectId, getPhotos) {
  async function updateCovers(itemIds, photos) {
    const stacks = groupPhotos(photos);
    await Promise.all([...itemIds].map(async (itemId) => {
      if (!itemId || String(itemId).startsWith("legacy-")) return;
      const stack = stacks.find((entry) => entry.photos.some((photo) => photo.itemId === itemId && !photo.legacy));
      const coverUrl = stack?.best?.url || "";
      try {
        await db.collection("projects").doc(projectId).collection("items").doc(itemId).update({
          coverUrl,
          updatedAt: stamp(),
        });
      } catch (error) {
        console.error(error);
      }
    }));
  }

  return {
    async onBest(photo, stack) {
      try {
        const batch = db.batch();
        let writes = 0;
        for (const member of stack.photos) {
          if (!member.ref) continue;
          batch.update(member.ref, { best: photoKey(member) === photoKey(photo) });
          writes += 1;
        }
        if (writes) await batch.commit();
        const inStack = new Set(stack.photos.map(photoKey));
        const next = getPhotos().map((entry) => ({
          ...entry,
          best: inStack.has(photoKey(entry)) ? photoKey(entry) === photoKey(photo) : entry.best,
        }));
        await updateCovers(new Set(stack.photos.map((entry) => entry.itemId)), next);
        toast("Beste bilde er valgt");
      } catch (error) {
        console.error(error);
        toast("Kunne ikke velge beste bilde");
      }
    },
    async onTrash(photo) {
      if (!photo?.ref) return;
      try {
        await photo.ref.update({ trashed: true, trashedAt: stamp() });
        const next = getPhotos().map((entry) => (
          photoKey(entry) === photoKey(photo) ? { ...entry, trashed: true } : entry
        ));
        await updateCovers(new Set([photo.itemId]), next);
        toast("Bildet er lagt i papirkurven");
      } catch (error) {
        console.error(error);
        toast("Kunne ikke slette bildet");
      }
    },
    async onTrashOthers(stack) {
      try {
        const batch = db.batch();
        const drop = new Set();
        for (const member of stack.others) {
          if (!member.ref) continue;
          batch.update(member.ref, { trashed: true, trashedAt: stamp() });
          drop.add(photoKey(member));
        }
        if (drop.size) await batch.commit();
        const next = getPhotos().map((entry) => (
          drop.has(photoKey(entry)) ? { ...entry, trashed: true } : entry
        ));
        await updateCovers(new Set(stack.photos.map((entry) => entry.itemId)), next);
        toast("De andre bildene er lagt i papirkurven");
      } catch (error) {
        console.error(error);
        toast("Kunne ikke slette bildene");
      }
    },
    async onRestore(photo) {
      if (!photo?.ref) return;
      try {
        await photo.ref.update({ trashed: false, trashedAt: null });
        const next = getPhotos().map((entry) => (
          photoKey(entry) === photoKey(photo) ? { ...entry, trashed: false } : entry
        ));
        await updateCovers(new Set([photo.itemId]), next);
        toast("Bildet er tilbake");
      } catch (error) {
        console.error(error);
        toast("Kunne ikke hente bildet tilbake");
      }
    },
    async onCaption(photo, value) {
      if (!photo?.ref) return;
      try {
        await photo.ref.update({ caption: value });
      } catch (error) {
        console.error(error);
        toast("Kunne ikke lagre bildeteksten");
      }
    },
    async onTakenAt(photo, millis) {
      if (!photo?.ref || !Number.isFinite(millis)) return;
      try {
        await photo.ref.update({
          takenAt: firebase.firestore.Timestamp.fromMillis(millis),
          exifChecked: true,
        });
      } catch (error) {
        console.error(error);
        toast("Kunne ikke lagre opptakstiden");
      }
    },
    async onGroup(chosen) {
      if (!chosen || chosen.length < 2) return;
      try {
        const groupId = newGroupId();
        const batch = db.batch();
        let writes = 0;
        for (const photo of chosen) {
          if (!photo.ref) continue;
          batch.update(photo.ref, { groupId });
          writes += 1;
        }
        if (writes) await batch.commit();
        toast("Bildene er gruppert");
      } catch (error) {
        console.error(error);
        toast("Kunne ikke gruppere bildene");
      }
    },
    onOpenItem(photo) {
      if (!photo) return;
      if (photo.legacy) {
        push({ name: "item", projectId, itemId: photo.legacyId || photo.id, legacy: true });
        return;
      }
      if (photo.itemId) push({ name: "item", projectId, itemId: photo.itemId, legacy: false });
    },
  };
}

function mountPhotoSection(projectId) {
  const queueSlot = el("div", { class: "stack" });
  const photoSlot = el("div");
  const noteSlot = el("div", { class: "stack" });
  main.append(el("div", { class: "screen" }, [
    el("div", { class: "action-row" }, [
      button("Ta bilde", {
        class: "btn btn-primary",
        icon: "camera",
        onClick: () => startCapture(projectId, "bilde", "camera"),
      }),
      button("Fra bilder", {
        class: "btn btn-ghost",
        icon: "image",
        onClick: () => startCapture(projectId, "bilde", "gallery"),
      }),
    ]),
    queueSlot,
    photoSlot,
    noteSlot,
  ]));

  let items = [];
  let legacy = [];
  let itemsReady = false;
  let legacyReady = false;
  let latest = [];
  let places = new Map();
  const photosByItem = new Map();
  const seenPhotos = new Set();
  const photoUnsubs = new Map();
  subs.push(() => {
    for (const stop of photoUnsubs.values()) stop();
    photoUnsubs.clear();
  });
  const board = mountPhotoBoard(photoSlot, photoHandlers(projectId, () => latest));

  function watchItems() {
    const wanted = new Set(items.filter((item) => item.kind === "bilde").map((item) => item.id));
    for (const [id, stop] of photoUnsubs) {
      if (wanted.has(id)) continue;
      stop();
      photoUnsubs.delete(id);
      photosByItem.delete(id);
      seenPhotos.delete(id);
    }
    for (const id of wanted) {
      if (photoUnsubs.has(id)) continue;
      const stop = onceUnsub(db.collection("projects").doc(projectId).collection("items").doc(id).collection("photos").onSnapshot((snap) => {
        photosByItem.set(id, snap.docs.map((doc) => ({ ...doc.data(), id: doc.id, ref: doc.ref })));
        seenPhotos.add(id);
        draw();
      }, (error) => {
        console.error(error);
        seenPhotos.add(id);
        draw();
      }));
      photoUnsubs.set(id, stop);
    }
  }

  function pending() {
    if (!itemsReady || !legacyReady) return true;
    return items.some((item) => item.kind === "bilde" && !seenPhotos.has(item.id));
  }

  function collect() {
    const flat = [];
    for (const item of items) {
      if (item.kind !== "bilde") continue;
      for (const photo of photosByItem.get(item.id) || []) {
        flat.push(withPlace({
          ...photo,
          itemId: item.id,
          legacy: false,
          step: item.step || "",
          comment: photo.caption || item.text || "",
          itemText: item.text || "",
          itemTitle: item.title || "",
        }, places));
      }
    }
    for (const photo of legacy) {
      flat.push(withPlace({
        ...photo,
        ref: db.collection("projects").doc(projectId).collection("photos").doc(photo.id),
        itemId: `legacy-${photo.id}`,
        legacy: true,
        legacyId: photo.id,
        step: "",
        comment: photo.caption || "",
        itemText: photo.caption || "",
      }, places));
    }
    return flat;
  }

  const draw = () => {
    queueSlot.replaceChildren();
    const queued = queueItems.filter((item) => item.projectId === projectId && item.kind === "bilde" && item.mode !== "attach");
    for (const item of queued) queueSlot.append(queueCard(item));
    if (pending()) {
      photoSlot.replaceChildren(el("p", { class: "empty" }, "Henter bilder…"));
      noteSlot.replaceChildren();
      return;
    }
    latest = collect();
    backfillPhotoTimes(latest);
    const lonely = items.filter((item) => item.kind === "bilde" && !(photosByItem.get(item.id) || []).length);
    board.update(latest, {
      showNote: true,
      emptyText: queued.length || lonely.length ? "" : KIND_META.bilde.empty,
    });
    noteSlot.replaceChildren();
    for (const item of lonely) noteSlot.append(itemRow(projectId, item));
  };
  refresh = draw;
  watchQueue(draw);
  subs.push(db.collection("projects").doc(projectId).collection("items").orderBy("createdAt", "desc").onSnapshot((snap) => {
    items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    itemsReady = true;
    watchItems();
    draw();
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente bildene");
  }));
  subs.push(db.collection("projects").doc(projectId).collection("photos").onSnapshot((snap) => {
    legacy = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    legacyReady = true;
    draw();
  }, (error) => {
    console.error(error);
    legacyReady = true;
    draw();
  }));
  subs.push(db.collection("projects").doc(projectId).collection("photoGps").onSnapshot((snap) => {
    places = new Map(snap.docs.map((doc) => [doc.id, doc.data()]));
    draw();
  }, (error) => console.error(error)));
}

function withPlace(photo, places) {
  const place = places?.get(photo?.id);
  if (!place) return photo;
  return { ...photo, lat: place.lat, lon: place.lon, accuracyM: place.accuracyM };
}

function mountSection(route) {
  const { projectId, kind } = route;
  if (kind === "tilbud") {
    mountFikenQuoteSection(projectId);
    return;
  }
  if (kind === "bilde") {
    mountPhotoSection(projectId);
    return;
  }
  const meta = KIND_META[kind] || KIND_META.bilde;
  const list = el("div", { class: "stack" });
  const composer = el("form", { class: "card continue", hidden: true });
  const titleInput = el("input", { type: "text", maxlength: "140", placeholder: "Kort overskrift" });
  const textInput = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Hva skjedde?" });
  const askApproval = el("input", { type: "checkbox" });
  composer.append(
    kind === "bilde" ? null : field("Overskrift", titleInput),
    field("Tekst", textInput),
    micButton(textInput),
    kind === "endring" || kind === "tilbud"
      ? el("label", { class: "checkline" }, [askApproval, el("span", {}, "Be kunden godkjenne dette")])
      : null,
    button("Lagre notat", { type: "submit", class: "btn btn-primary btn-block" })
  );
  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    const title = titleInput.value.trim();
    if (!text && !title) return;
    try {
      await db.collection("projects").doc(projectId).collection("items").add({
        kind,
        title,
        text,
        stars: null,
        approved: true,
        reference: false,
        source: "admin",
        createdBy: user?.uid || "",
        authorName: "Einar",
        coverUrl: "",
        approvalRequested: (kind === "endring" || kind === "tilbud") && askApproval.checked,
        approvalStatus: (kind === "endring" || kind === "tilbud") && askApproval.checked ? "venter" : "",
        createdAt: stamp(),
        updatedAt: stamp(),
      });
      titleInput.value = "";
      textInput.value = "";
      composer.hidden = true;
      toast("Notatet er lagret");
    } catch (error) {
      console.error(error);
      toast("Kunne ikke lagre notatet");
    }
  });
  const actions = el("div", { class: "action-row" }, [
    button("Ta bilde", {
      class: "btn btn-primary",
      icon: "camera",
      onClick: () => startCapture(projectId, kind, "camera"),
    }),
    button("Fra bilder", {
      class: "btn btn-ghost",
      icon: "image",
      onClick: () => startCapture(projectId, kind, "gallery"),
    }),
  ]);
  if (kind !== "bilde") {
    actions.append(button("Skriv notat", {
      class: "btn btn-ghost",
      icon: "edit",
      onClick: () => {
        composer.hidden = !composer.hidden;
        if (!composer.hidden) textInput.focus();
      },
    }));
  }
  main.append(el("div", { class: "screen" }, [actions, composer, list]));
  let items = [];
  let legacy = [];
  const draw = () => {
    list.replaceChildren();
    const queued = queueItems.filter((item) => item.projectId === projectId && item.kind === kind && item.mode !== "attach");
    const rows = [
      ...items.filter((item) => item.kind === kind),
      ...(kind === "bilde"
        ? legacy.map((photo) => ({
          id: photo.id,
          legacy: true,
          kind: "bilde",
          title: "",
          text: photo.caption || "",
          approved: photo.approved !== false,
          reference: photo.reference === true,
          createdAt: photo.createdAt,
          coverUrl: photo.url,
        }))
        : []),
    ].sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
    if (!rows.length && !queued.length) list.append(el("p", { class: "empty" }, meta.empty));
    for (const item of queued) list.append(queueCard(item));
    for (const item of rows) list.append(itemRow(projectId, item));
  };
  refresh = draw;
  watchQueue(draw);
  subs.push(db.collection("projects").doc(projectId).collection("items").orderBy("createdAt", "desc").onSnapshot((snap) => {
    items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente innholdet");
  }));
  if (kind === "bilde") {
    subs.push(db.collection("projects").doc(projectId).collection("photos").onSnapshot((snap) => {
      legacy = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      draw();
    }));
  }
}

function mountFikenQuoteSection(projectId) {
  const root = el("div", { class: "screen" });
  main.append(root);
  let quotes = [];
  let notes = [];
  const draw = () => {
    const project = projectById(projectId);
    const view = renderFikenQuoteList({
      quotes,
      linked: Boolean(project?.fikenProjectId),
      onRefresh: () => applyFikenOfferLines(projectId, project?.fikenProjectId),
    });
    if (notes.length) {
      view.append(el("h2", { class: "h-app" }, "Eldre notater"));
      for (const item of notes) view.append(itemRow(projectId, item));
    }
    root.replaceChildren(view);
  };
  subs.push(db.collection("projects").doc(projectId).collection("fikenOffers").onSnapshot((snap) => {
    quotes = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    quotes.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    draw();
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente tilbudet");
  }));
  subs.push(db.collection("projects").doc(projectId).collection("items").onSnapshot((snap) => {
    notes = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.kind === "tilbud" && !isOfferItem(item) && item.fikenBase !== true);
    draw();
  }, (error) => console.error(error)));
  draw();
}

function mountItem(route) {
  const root = el("div", { class: "screen" });
  const head = el("div", { class: "stack" });
  const photosEl = el("div", { class: "stack" });
  const commentsEl = el("div", { class: "stack" });
  main.append(root);
  root.append(head, photosEl, el("h2", { class: "h-app" }, "Kommentarer"), commentsEl);
  const ref = route.legacy
    ? db.collection("projects").doc(route.projectId).collection("photos").doc(route.itemId)
    : db.collection("projects").doc(route.projectId).collection("items").doc(route.itemId);
  const commentCol = ref.collection("comments");
  const photoCol = route.legacy ? null : ref.collection("photos");
  let saveTimer;
  let shape = "";
  let titleInput = null;
  let textInput = null;
  let itemData = {};
  let latestPhotos = [];
  let itemPlaces = new Map();
  const photoBoard = mountPhotoBoard(photosEl, photoHandlers(route.projectId, () => latestPhotos));
  function showItemPhotos(list) {
    latestPhotos = list.map((photo) => withPlace(photo, itemPlaces));
    photoBoard.update(latestPhotos, { showNote: false, emptyText: "" });
    backfillPhotoTimes(latestPhotos);
  }

  subs.push(ref.onSnapshot((snap) => {
    if (!snap.exists) {
      shape = "gone";
      itemData = {};
      head.replaceChildren(el("p", { class: "empty" }, "Notatet er slettet."));
      if (route.legacy) showItemPhotos([]);
      return;
    }
    const data = snap.data();
    itemData = data;
    if (route.legacy) {
      showItemPhotos(data.url ? [{
        ...data,
        id: route.itemId,
        ref,
        itemId: `legacy-${route.itemId}`,
        legacy: true,
        legacyId: route.itemId,
        comment: data.caption || "",
        step: "",
      }] : []);
    }
    const textValue = route.legacy ? data.caption || "" : data.text || "";
    const nextShape = [data.approved, data.kind, data.reference, data.source, data.stars, data.approvalStatus, data.selectedAlternativeId, data.fikenSynced, data.fikenDraftId, data.fikenError, route.legacy].join("|");
    if (nextShape !== shape) {
      shape = nextShape;
      buildHead(data, textValue);
      return;
    }
    if (titleInput && document.activeElement !== titleInput && titleInput.value !== (data.title || "")) {
      titleInput.value = data.title || "";
    }
    if (textInput && document.activeElement !== textInput && textInput.value !== textValue) {
      textInput.value = textValue;
    }
  }));

  function buildHead(data, textValue) {
    const project = projectById(route.projectId);
    head.replaceChildren();
    titleInput = null;
    textInput = null;
    if (data.approved === false) {
      head.append(el("div", { class: "action-row" }, [
        button("Godkjenn", {
          class: "btn btn-primary",
          icon: "check",
          onClick: () => setApproved(true),
        }),
        button("Avvis", { class: "btn btn-danger", onClick: () => removeItem() }),
      ]));
    }
    if (!route.legacy && data.kind !== "bilde" && data.kind !== "vurdering") {
      titleInput = el("input", { type: "text", value: data.title || "", maxlength: "140" });
      titleInput.addEventListener("input", () => schedule(() => ref.update({
        title: titleInput.value,
        updatedAt: stamp(),
        ...(data.fikenSyncKey ? { fikenManual: true } : {}),
      })));
      head.append(field("Overskrift", titleInput));
    }
    if (data.kind === "vurdering") head.append(el("p", { class: "lead" }, `${data.stars || "–"} av 5 stjerner`));
    textInput = el("textarea", { rows: "4", maxlength: "4000" });
    textInput.value = textValue;
    textInput.addEventListener("input", () => {
      schedule(() => {
        const patch = route.legacy
          ? { caption: textInput.value }
          : {
            text: textInput.value,
            updatedAt: stamp(),
            ...(data.fikenSyncKey ? { fikenManual: true } : {}),
          };
        return ref.update(patch);
      });
    });
    head.append(field(route.legacy || data.kind === "bilde" ? "Kommentar" : "Tekst", textInput), micButton(textInput));
    if (!route.legacy && isOfferItem(data)) {
      head.append(renderOfferEditor({
        item: data,
        project,
        onSave: async ({ kind, alternatives }) => {
          await ref.update({
            kind,
            alternatives,
            updatedAt: stamp(),
            ...(data.fikenSyncKey ? { fikenManual: true } : {}),
          });
          toast("Alternativene er lagret");
        },
        onSend: async () => {
          await ref.update({ approvalRequested: true, approvalStatus: "venter", updatedAt: stamp() });
          toast("Sendt til kunden");
        },
        onWithdraw: async () => {
          await ref.update({ approvalRequested: false, approvalStatus: "", updatedAt: stamp() });
          toast("Posten er et utkast igjen");
        },
        onFiken: (fikenKind) => sendOfferToFiken(projectById(route.projectId), data, fikenKind),
        onFikenProject: () => sendOfferToFikenProject(projectById(route.projectId), { ...data, id: route.itemId }),
      }));
      if (data.approvalRequested) head.append(el("p", { class: "meta" }, approvalLine(data) || "Venter på kunden"));
    }
    if (data.approved !== false) {
      const box = el("input", { type: "checkbox" });
      box.checked = data.reference === true;
      box.addEventListener("change", async () => {
        try {
          await ref.update(route.legacy ? { reference: box.checked } : { reference: box.checked, updatedAt: stamp() });
          await publishReference(route.projectId);
          toast(box.checked ? "Tatt med i offentlig referanse" : "Fjernet fra offentlig referanse");
        } catch (error) {
          console.error(error);
          toast("Kunne ikke oppdatere referansen");
        }
      });
      head.append(el("label", { class: "checkline" }, [
        box,
        el("span", {}, project?.public
          ? "Vis offentlig på einar-borsheim.com"
          : "Ta med når prosjektet er offentlig referanse"),
      ]));
    }
    head.append(el("p", { class: "meta" }, [
      formatWhen(data.createdAt),
      data.source === "kunde" ? "Fra kunde" : "Einar",
    ].filter(Boolean).join(" · ")));
    if (!route.legacy) {
      head.append(button("Legg til bilde", {
        class: "btn btn-ghost",
        icon: "camera",
        onClick: () => attachPhoto(route.projectId, route.itemId, data.kind || "bilde"),
      }));
    }
    head.append(button("Slett", { class: "btn btn-danger", onClick: () => removeItem() }));
  }

  function renderPhotos(snap) {
    showItemPhotos(snap.docs.map((doc) => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        ref: doc.ref,
        itemId: route.itemId,
        legacy: false,
        step: itemData.step || "",
        comment: data.caption || itemData.text || "",
        itemText: itemData.text || "",
        itemTitle: itemData.title || "",
      };
    }));
  }
  if (photoCol) {
    subs.push(photoCol.orderBy("createdAt", "desc").onSnapshot((snap) => {
      renderPhotos(snap);
    }, () => {
      photoCol.get().then(renderPhotos).catch(() => {});
    }));
  }
  subs.push(db.collection("projects").doc(route.projectId).collection("photoGps").onSnapshot((snap) => {
    itemPlaces = new Map(snap.docs.map((doc) => [doc.id, doc.data()]));
    if (latestPhotos.length) showItemPhotos(latestPhotos);
  }, (error) => console.error(error)));

  subs.push(commentCol.orderBy("createdAt", "asc").onSnapshot((snap) => {
    renderComments(snap);
  }, () => {
    commentCol.get().then(renderComments).catch(() => {});
  }));

  const draft = el("textarea", { rows: "2", maxlength: "2000", placeholder: "Skriv en kommentar…" });
  commentsEl.after(el("form", {
    class: "stack",
    onsubmit: async (event) => {
      event.preventDefault();
      const text = draft.value.trim();
      if (!text) return;
      try {
        await commentCol.add({
          text,
          source: "admin",
          authorName: "Einar",
          approved: true,
          createdBy: user?.uid || "",
          createdAt: stamp(),
        });
        draft.value = "";
      } catch (error) {
        console.error(error);
        toast("Kunne ikke lagre kommentaren");
      }
    },
  }, [
    field("Ny kommentar", draft),
    micButton(draft),
    button("Legg til kommentar", { type: "submit", class: "btn btn-primary btn-block" }),
  ]));

  function renderComments(snap) {
    commentsEl.replaceChildren();
    if (snap.empty) commentsEl.append(el("p", { class: "empty" }, "Ingen flere kommentarer ennå."));
    snap.forEach((doc) => {
      const data = doc.data();
      const card = el("article", { class: "comment" }, [
        el("p", { class: "comment-meta" }, [
          data.source === "kunde" ? "Kunde" : "Einar",
          formatWhen(data.createdAt),
          data.approved === false ? "· venter" : "",
        ].filter(Boolean).join(" · ")),
        el("p", {}, data.text || ""),
      ]);
      const row = el("div", { class: "action-row" });
      if (data.approved === false) {
        row.append(button("Godkjenn", {
          class: "btn btn-ghost",
          onClick: () => doc.ref.update({ approved: true }),
        }));
      }
      row.append(button("Slett", { class: "btn btn-danger", onClick: () => doc.ref.delete() }));
      card.append(row);
      commentsEl.append(card);
    });
  }

  function schedule(run) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => run().catch((error) => {
      console.error(error);
      toast("Kunne ikke lagre");
    }), 600);
  }

  async function setApproved(approved) {
    try {
      if (route.legacy) await ref.update({ approved });
      else {
        await ref.update({ approved, updatedAt: stamp() });
        const photos = await ref.collection("photos").get();
        for (const photo of photos.docs) await photo.ref.update({ approved });
      }
      toast(approved ? "Godkjent" : "Oppdatert");
    } catch (error) {
      console.error(error);
      toast("Kunne ikke oppdatere");
    }
  }

  async function removeItem() {
    if (!window.confirm("Slette dette?")) return;
    try {
      if (!route.legacy) {
        const photos = await ref.collection("photos").get();
        for (const photo of photos.docs) {
          if (photo.data().storagePath) await storage.ref(photo.data().storagePath).delete().catch(() => {});
          await photo.ref.delete();
        }
      } else if ((await ref.get()).data()?.storagePath) {
        await storage.ref((await ref.get()).data().storagePath).delete().catch(() => {});
      }
      const comments = await commentCol.get();
      for (const comment of comments.docs) await comment.ref.delete();
      await ref.delete();
      history.back();
    } catch (error) {
      console.error(error);
      toast("Kunne ikke slette");
    }
  }
}

async function attachPhoto(projectId, itemId, kind) {
  try {
    const photos = await collectPrepared("camera").catch(async (error) => {
      if (isCancel(error)) throw error;
      return chooseFiles({ capture: true });
    });
    await ingestBlobs(projectId, kind || "bilde", photos, { mode: "attach", itemId });
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    console.error(error);
    toast("Kunne ikke legge til bildet");
  }
}

function mountReview(route) {
  const root = el("div", { class: "screen" });
  const list = el("div", { class: "stack" });
  main.append(root);
  root.append(
    el("p", { class: "lead" }, "Skriv en kommentar nå. Du kan legge til flere inne på bildet senere."),
    list,
    button("Lagre", {
      class: "btn btn-primary btn-block",
      icon: "check",
      onClick: () => {
        skipReviewSave = true;
        persistReview(route.ids).then(() => history.back());
      },
    }),
    button("Forkast", {
      class: "btn btn-danger btn-block",
      onClick: () => {
        if (!window.confirm("Forkaste bildet?")) return;
        skipReviewSave = true;
        persistReview(route.ids, { discard: true }).then(() => history.back());
      },
    })
  );
  (async () => {
    const items = [];
    for (const id of route.ids || []) {
      const item = await getQueueItem(id);
      if (item) items.push(item);
    }
    if (!items.length) {
      list.append(el("p", { class: "empty" }, "Bildet er allerede sendt eller fjernet."));
      return;
    }
    if (items.length === 1) {
      const url = URL.createObjectURL(items[0].thumb || items[0].blob);
      const input = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Kommentar til bildet" });
      input.dataset.queueId = items[0].id;
      input.value = items[0].text || "";
      list.append(
        el("img", { class: "preview-img", src: url, alt: "Nytt bilde" }),
        reviewFacts(items[0]),
        field("Kommentar", input),
        micButton(input),
      );
      return;
    }
    for (const item of items) {
      const url = URL.createObjectURL(item.thumb || item.blob);
      const input = el("textarea", { rows: "2", maxlength: "4000", placeholder: "Kommentar" });
      input.dataset.queueId = item.id;
      input.value = item.text || "";
      list.append(el("div", { class: "review-row" }, [
        el("img", { src: url, alt: "" }),
        el("div", { class: "stack" }, [reviewFacts(item), input]),
      ]), micButton(input));
    }
  })().catch((error) => {
    console.error(error);
    list.append(el("p", { class: "empty" }, "Kunne ikke vise bildet."));
  });
}

function reviewFacts(item) {
  const line = el("p", { class: "meta photo-meta" });
  const when = photoWhen(item) || formatCapture(item.createdAt);
  if (when) line.append(document.createTextNode(when));
  const place = gpsLabel(item);
  if (place) {
    if (when) line.append(document.createTextNode(" · "));
    line.append(mapAnchor(place));
  }
  return when || place ? line : null;
}

function mountForm(route) {
  const name = el("input", { type: "text", required: true, maxlength: "140", placeholder: "F.eks. Hageanlegg med støttemur" });
  const address = el("input", { type: "text", maxlength: "180", placeholder: "Kun synlig for deg og kunden" });
  const customerName = el("input", { type: "text", maxlength: "120" });
  const customerPhone = el("input", { type: "tel", maxlength: "40", autocomplete: "tel" });
  const customerEmail = el("input", { type: "email", maxlength: "120", autocomplete: "email" });
  const description = el("textarea", { rows: "3", maxlength: "2000" });
  const templateSelect = el("select");
  templateSelect.append(el("option", { value: "" }, "Ingen bildemal"));
  for (const template of templateChoices()) {
    templateSelect.append(el("option", { value: template.id }, template.name));
  }
  const publicLocation = el("input", { type: "text", maxlength: "80", placeholder: "F.eks. Asker" });
  const publicSummary = el("textarea", { rows: "4", maxlength: "1200", placeholder: "Kort omtale uten kundens navn og adresse" });
  const completed = el("input", { type: "date" });
  const isPublic = el("input", { type: "checkbox" });
  const showGps = el("input", { type: "checkbox" });
  showGps.checked = true;
  const save = button("Lagre", { type: "submit", class: "btn btn-primary btn-block" });
  if (route.projectId) save.disabled = true;
  let fikenPick = null;
  const fikenPicker = route.projectId
    ? null
    : renderFikenPicker({
      onList: () => callFiken("listFikenProjects", {}),
      pickLabel: "Bruk",
      onPick: (card) => {
        if (isFikenLinked(projects, card.projectId)) {
          toast("Det prosjektet er allerede i Internkontroll.");
          return false;
        }
        const fields = fieldsFromFiken(card);
        fikenPick = fields;
        name.value = fields.name;
        address.value = fields.address;
        customerName.value = fields.customerName;
        customerPhone.value = fields.customerPhone;
        customerEmail.value = fields.customerEmail;
        toast(`Hentet «${fields.name}» fra Fiken`);
        return true;
      },
    });
  const form = el("form", { class: "screen stack" }, [
    fikenPicker,
    field("Prosjektnavn", name),
    field("Adresse", address),
    field("Kundenavn", customerName),
    field("Telefon til kunde", customerPhone),
    field("E-post til kunde", customerEmail),
    field("Beskrivelse", description),
    field("Bildemal", templateSelect),
  ]);
  if (route.projectId) {
    form.append(
      field("Ferdigdato", completed),
      field("Område som kan vises offentlig", publicLocation),
      field("Offentlig omtale", publicSummary),
      el("label", { class: "checkline" }, [
        isPublic,
        el("span", {}, "Offentlig referanse. Bare innhold du krysser av blir synlig på nettsiden."),
      ]),
      el("label", { class: "checkline" }, [
        showGps,
        el("span", {}, "Vis GPS i rapport. Offentlige referanser viser ikke posisjon."),
      ]),
    );
  }
  form.append(save);
  main.append(form);

  let originalCompleted = "";
  if (route.projectId) {
    db.collection("projects").doc(route.projectId).get().then((snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      const fill = (input, value) => {
        if (document.activeElement === input) return;
        input.value = value || "";
      };
      fill(name, data.name);
      fill(address, data.address);
      fill(customerName, data.customerName);
      fill(customerPhone, data.customerPhone);
      fill(customerEmail, data.customerEmail);
      fill(description, data.description);
      fill(publicLocation, data.publicLocation);
      fill(publicSummary, data.publicSummary);
      if (document.activeElement !== isPublic) isPublic.checked = data.public === true;
      if (document.activeElement !== showGps) showGps.checked = data.showGpsInReport !== false;
      if (document.activeElement !== templateSelect) templateSelect.value = data.templateId || "";
      save.disabled = false;
      const day = toDate(data.completedAt);
      if (day) {
        const month = String(day.getMonth() + 1).padStart(2, "0");
        const date = String(day.getDate()).padStart(2, "0");
        completed.value = `${day.getFullYear()}-${month}-${date}`;
        originalCompleted = completed.value;
      }
    }).catch((error) => {
      console.error(error);
      toast("Kunne ikke hente prosjektet");
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trimmed = name.value.trim();
    if (!trimmed) return;
    save.disabled = true;
    const common = {
      name: trimmed,
      address: address.value.trim(),
      customerName: customerName.value.trim(),
      customerPhone: customerPhone.value.trim(),
      customerEmail: customerEmail.value.trim(),
      description: description.value.trim(),
      templateId: templateSelect.value,
      updatedAt: stamp(),
    };
    try {
      if (!route.projectId) {
        if (fikenPick?.fikenProjectId && isFikenLinked(projects, fikenPick.fikenProjectId)) {
          toast("Det prosjektet er allerede i Internkontroll.");
          save.disabled = false;
          return;
        }
        const ref = await db.collection("projects").add({
          ...common,
          ...fikenLinkPatch(fikenPick),
          publicLocation: "",
          publicSummary: "",
          reportText: "",
          shareToken: randomToken(12),
          public: false,
          showGpsInReport: true,
          status: "aktiv",
          completedAt: null,
          pdfUrl: "",
          pdfPath: "",
          reminder1Done: false,
          reminder2Done: false,
          createdAt: stamp(),
          createdBy: user?.email || "",
        });
        localStorage.setItem("lastProjectId", ref.id);
        if (fikenPick?.fikenProjectId) applyFikenOfferLines(ref.id, fikenPick.fikenProjectId);
        toast("Prosjekt opprettet");
        reset({ name: "project", projectId: ref.id });
        return;
      }
      const patch = {
        ...common,
        publicLocation: publicLocation.value.trim(),
        publicSummary: publicSummary.value.trim(),
        public: isPublic.checked,
        showGpsInReport: showGps.checked,
      };
      if (completed.value) {
        patch.completedAt = firebase.firestore.Timestamp.fromDate(new Date(`${completed.value}T12:00:00`));
        patch.status = "fullfort";
        if (completed.value !== originalCompleted) {
          patch.reminder1Done = false;
          patch.reminder2Done = false;
        }
      } else {
        patch.completedAt = null;
        patch.status = "aktiv";
      }
      await db.collection("projects").doc(route.projectId).update(patch);
      let published = true;
      try {
        await publishReference(route.projectId);
      } catch (publishError) {
        console.error(publishError);
        published = false;
      }
      toast(published ? "Lagret" : "Prosjektet er lagret, men den offentlige siden ble ikke oppdatert");
      history.back();
    } catch (error) {
      console.error(error);
      toast("Kunne ikke lagre prosjektet");
      save.disabled = false;
    }
  });
}

function mountReport(route) {
  const root = el("div", { class: "screen" });
  main.append(root);
  const text = el("textarea", { rows: "8", maxlength: "8000", placeholder: "Skriv hva som ble gjort, slik det skal stå i sluttrapporten." });
  const status = el("p", { class: "meta save-state" }, "");
  const pdfLine = el("p", { class: "meta" }, "");
  const ratings = el("div", { class: "stack" });
  const gaps = el("p", { class: "meta" }, "");
  const aiPanel = el("div", { class: "note", hidden: true }, [
    el("h2", {}, "KI-assistent"),
    el("p", {}, AI_DRAFT_URL
      ? "Lager et utkast fra notatene i prosjektet. Nøkkelen ligger ikke i appen."
      : "Ikke aktivert i denne testversjonen. Utkastet skal senere lages av en Cloud Function, slik at ingen API-nøkkel ligger i appen. Bruk «Lag utkast fra notater» så lenge."),
  ]);
  let saveTimer;
  let reportRev = 0;
  let reportDirty = false;
  const pdfButton = button("Lag PDF og lagre i prosjektet", { class: "btn btn-primary btn-block", icon: "file" });
  pdfButton.addEventListener("click", async () => {
    const project = projectById(route.projectId);
    if (!project) return;
    pdfButton.disabled = true;
    pdfButton.textContent = "Lager PDF…";
    try {
      const outcome = await saveReportPdf({ ...project, reportText: text.value }, text.value);
      toast(outcome.skipped
        ? `Rapporten er lagret. ${outcome.skipped} ${outcome.skipped === 1 ? "bilde" : "bilder"} ble hoppet over.`
        : "Rapporten er lagret i prosjektet");
    } catch (error) {
      console.error(error);
      toast(online ? "Kunne ikke lage eller lagre PDF" : "PDF trenger nett for å hente bildene og lagre filen");
    } finally {
      pdfButton.disabled = false;
      pdfButton.textContent = "Lag PDF og lagre i prosjektet";
    }
  });

  root.append(
    el("p", { class: "lead" }, "Sammendraget, endringer, avvik og godkjente bilder med kommentarer samles i én PDF. Kunden laster den ned fra portalen."),
    field("Arbeid utført", text),
    micButton(text),
    status,
    el("div", { class: "action-row" }, [
      button("Lag utkast fra notater", { class: "btn btn-ghost", onClick: () => fillDraft(false) }),
      button("KI-assistent", { class: "btn btn-ghost", onClick: () => runAi() }),
    ]),
    aiPanel,
    pdfButton,
    pdfLine,
    gaps,
    el("h2", { class: "h-app" }, "Kundevurderinger"),
    ratings
  );

  subs.push(db.collection("projects").doc(route.projectId).onSnapshot((snap) => {
    if (!snap.exists) return;
    const data = snap.data();
    if (!reportDirty && document.activeElement !== text) text.value = data.reportText || "";
    pdfLine.textContent = data.pdfUrl
      ? `Sist lagret ${formatWhen(data.pdfUpdatedAt) || ""}. Kunden kan laste den ned fra portalen.`
      : "PDF er ikke lagret i prosjektet ennå.";
  }));

  text.addEventListener("input", () => {
    reportDirty = true;
    status.textContent = "Lagrer…";
    const rev = ++reportRev;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await db.collection("projects").doc(route.projectId).update({ reportText: text.value, updatedAt: stamp() });
        if (rev !== reportRev) return;
        reportDirty = false;
        status.textContent = "Lagret";
      } catch (error) {
        console.error(error);
        if (rev === reportRev) status.textContent = "Ikke lagret";
      }
    }, 700);
  });

  subs.push(db.collection("projects").doc(route.projectId).collection("items").onSnapshot((snap) => {
    ratings.replaceChildren();
    const allItems = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const template = templateFor(projectById(route.projectId));
    if (template?.steps?.length) {
      const missing = missingTemplateSteps(template.steps, allItems);
      gaps.textContent = missing.length
        ? `Bildemal «${template.name}» mangler: ${missing.join(", ")}.`
        : `Bildemal «${template.name}» er komplett.`;
    } else {
      gaps.textContent = "";
    }
    const rows = allItems.filter((item) => item.kind === "vurdering");
    if (!rows.length) {
      ratings.append(el("p", { class: "empty" }, "Ingen vurdering ennå. Påminnelsen deler lenken der kunden kan sende den inn."));
      return;
    }
    for (const item of rows) {
      const card = el("button", { type: "button", class: "row" }, [
        el("span", { class: "icon-round" }, [icon("check")]),
        el("span", { class: "row-body" }, [
          el("span", { class: "row-title" }, `${item.stars || "–"} av 5`),
          el("span", { class: "row-text" }, item.text || "Uten kommentar"),
          el("span", { class: "pills" }, [
            item.approved === false ? pill("Venter", "pill-warn") : pill("Godkjent"),
            item.reference ? pill("Referanse") : null,
          ]),
        ]),
      ]);
      card.addEventListener("click", () => push({ name: "item", projectId: route.projectId, itemId: item.id }));
      ratings.append(card);
    }
  }));

  async function fillDraft(fromAi) {
    const project = projectById(route.projectId);
    if (!project) {
      toast("Prosjektet er ikke lastet inn ennå");
      return;
    }
    if (text.value.trim() && !window.confirm("Erstatte teksten som står der nå?")) return;
    const rev = ++reportRev;
    reportDirty = true;
    clearTimeout(saveTimer);
    try {
      status.textContent = "Lager utkast…";
      const content = await collectContent(project.id);
      if (rev !== reportRev) return;
      let draft;
      if (fromAi) {
        draft = await requestAiDraft({
          getIdToken: () => user.getIdToken(),
          project: { name: project.name, address: project.address, description: project.description },
          items: content.items.map((item) => ({
            kind: item.kind,
            title: item.title,
            text: item.text,
            approved: item.approved,
          })),
        });
      } else {
        draft = buildLocalDraft(project, content.items, content);
      }
      if (rev !== reportRev) return;
      text.value = draft;
      await db.collection("projects").doc(project.id).update({ reportText: draft, updatedAt: stamp() });
      if (rev !== reportRev) return;
      reportDirty = false;
      status.textContent = "Utkast lagret. Les gjennom før du lager PDF.";
    } catch (error) {
      console.error(error);
      if (rev === reportRev) {
        reportDirty = false;
        status.textContent = "";
      }
      if (error?.code === "KI_NOT_CONFIGURED") {
        aiPanel.hidden = false;
        return;
      }
      toast("Kunne ikke lage utkast");
    }
  }

  function runAi() {
    aiPanel.hidden = false;
    if (!AI_DRAFT_URL) return;
    fillDraft(true);
  }
}

function projectList(title, rows, emptyText, extra) {
  const list = el("div", { class: "stack" });
  main.append(el("div", { class: "screen" }, [
    el("h1", { class: "h-app" }, title),
    list,
  ]));
  const draw = () => {
    list.replaceChildren();
    if (!rows().length) {
      list.append(el("p", { class: "empty" }, emptyText));
      return;
    }
    for (const project of rows()) {
      const card = el("article", { class: "card continue" }, [
        el("h2", {}, project.name || "Uten navn"),
        el("p", { class: "meta" }, [project.customerName, project.address].filter(Boolean).join(" · ")),
        extra(project),
      ]);
      list.append(card);
    }
  };
  refresh = draw;
  draw();
}

function mountDone() {
  projectList(
    "Fullførte",
    () => projects.filter((project) => isCompleted(project) && !isTrashed(project)),
    "Ingen fullførte prosjekter ennå.",
    (project) => el("div", { class: "action-row" }, [
      button("Åpne", { class: "btn btn-primary", onClick: () => openProject(project.id) }),
      button("Se som kunde", { class: "btn btn-ghost", onClick: () => previewAsCustomer(project) }),
    ])
  );
}

function mountTrash() {
  projectList(
    "Papirkurv",
    () => projects.filter((project) => isTrashed(project)),
    "Papirkurven er tom. Prosjekter som ligger her slettes etter 90 dager, inkludert bilder.",
    (project) => {
      const left = trashDaysLeft(project);
      return el("div", { class: "stack" }, [
        el("p", { class: "meta" }, left == null ? "" : `${left} dager igjen før alt slettes`),
        el("div", { class: "action-row" }, [
          button("Se som kunde", {
            class: "btn btn-ghost",
            onClick: () => previewAsCustomer(project),
          }),
          button("Legg tilbake", {
            class: "btn btn-ghost",
            onClick: async () => {
              await db.collection("projects").doc(project.id).update({ trashed: false, trashedAt: null, updatedAt: stamp() });
              toast("Prosjektet er lagt tilbake");
            },
          }),
          button("Slett permanent", {
            class: "btn btn-danger",
            onClick: async () => {
              if (!window.confirm("Slette prosjektet og alle bilder for godt?")) return;
              try {
                await permanentlyDeleteProject(project.id);
                toast("Prosjektet er slettet");
              } catch (error) {
                console.error(error);
                toast("Kunne ikke slette prosjektet");
              }
            },
          }),
        ]),
      ]);
    }
  );
}

function mountMessages(route) {
  const list = el("div", { class: "thread" });
  const input = el("textarea", { rows: "3", maxlength: "4000", placeholder: "Skriv til kunden" });
  const send = button("Send", { type: "submit", class: "btn btn-primary" });
  const form = el("form", { class: "stack" }, [
    field("Melding", input),
    micButton(input),
    el("div", { class: "action-row" }, [
      send,
      button("Bilde", {
        class: "btn btn-ghost",
        icon: "image",
        onClick: () => sendMessageImage(route.projectId, input),
      }),
    ]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      await db.collection("projects").doc(route.projectId).collection("messages").add({
        text,
        sender: "admin",
        createdAt: stamp(),
      });
      input.value = "";
    } catch (error) {
      console.error(error);
      toast("Kunne ikke sende meldingen");
    } finally {
      send.disabled = false;
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  main.append(el("div", { class: "screen" }, [
    el("p", { class: "lead" }, "Meldinger går begge veier. Kunden ser dem i portalen."),
    list,
    form,
  ]));
  subs.push(db.collection("projects").doc(route.projectId).collection("messages").orderBy("createdAt", "asc").onSnapshot((snap) => {
    list.replaceChildren();
    if (snap.empty) list.append(el("p", { class: "empty" }, "Ingen meldinger ennå."));
    snap.forEach((docSnap) => list.append(messageBubble(docSnap.data(), true)));
    list.scrollTop = list.scrollHeight;
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente meldingene");
  }));
}

function messageBubble(data, adminView) {
  const mine = data.sender === "admin";
  const image = data.imageUrl
    ? el("img", { src: data.imageUrl, alt: "Bilde i meldingen" })
    : null;
  if (image) bindImageRetry(image, data.imageUrl);
  return el("article", { class: `bubble ${mine ? "bubble-admin" : "bubble-customer"}` }, [
    image,
    data.text ? el("p", {}, data.text) : null,
    el("p", { class: "meta" }, [
      mine ? (adminView ? "Deg" : "Einar") : "Kunde",
      formatWhen(data.createdAt),
    ].filter(Boolean).join(" · ")),
  ]);
}

async function sendMessageImage(projectId, input) {
  try {
    const photos = await collectPrepared("gallery");
    const prepared = photos[0];
    if (!prepared?.blob) return;
    const compressed = prepared.blob;
    const filename = `melding-${Date.now()}.jpg`;
    const imagePath = `projects/${projectId}/media/${filename}`;
    const ref = storage.ref(imagePath);
    await putBlob(ref, compressed);
    const imageUrl = await withTimeout(ref.getDownloadURL(), UPLOAD_TIMEOUT_MS);
    await db.collection("projects").doc(projectId).collection("messages").add({
      text: input.value.trim(),
      sender: "admin",
      imageUrl,
      imagePath,
      createdAt: stamp(),
    });
    input.value = "";
    toast("Bildet er sendt");
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    console.error(error);
    toast("Kunne ikke sende bildet");
  }
}

function openStoredFile(url) {
  const Browser = window.Capacitor?.Plugins?.Browser;
  if (Browser?.open) {
    Browser.open({ url }).catch(() => window.open(url, "_blank", "noopener"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

function mountHms(route) {
  const list = el("div", { class: "stack" });
  const status = el("p", { class: "meta" }, "");
  main.append(el("div", { class: "screen" }, [
    el("p", { class: "lead" }, "HMS-dokumenter for dette prosjektet. Kunden ser et dokument bare når «Vis for kunde» er på."),
    button("Last opp HMS", {
      class: "btn btn-primary btn-block",
      icon: "file",
      onClick: () => uploadHms(route.projectId, status),
    }),
    status,
    list,
  ]));
  const col = db.collection("projects").doc(route.projectId).collection("hmsDocs");
  subs.push(col.orderBy("createdAt", "desc").onSnapshot((snap) => {
    const docs = snap.docs.map((entry) => ({ id: entry.id, ref: entry.ref, ...entry.data() }));
    list.replaceChildren(renderHmsBoard(docs, {
      onOpen: openStoredFile,
      async onToggle(doc, visible) {
        try {
          await doc.ref.update({ visibleToCustomer: visible === true });
          toast(visible ? "Kunden kan se dokumentet" : "Skjult for kunden");
        } catch (error) {
          console.error(error);
          toast("Kunne ikke lagre valget");
        }
      },
      async onTrash(doc) {
        try {
          await doc.ref.update({ trashed: true, trashedAt: stamp() });
          toast("Lagt i papirkurven");
        } catch (error) {
          console.error(error);
          toast("Kunne ikke slette dokumentet");
        }
      },
      async onRestore(doc) {
        try {
          await doc.ref.update({ trashed: false, trashedAt: null });
          toast("Dokumentet er tilbake");
        } catch (error) {
          console.error(error);
          toast("Kunne ikke hente dokumentet tilbake");
        }
      },
    }));
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente HMS-dokumentene");
  }));
}

async function uploadHms(projectId, status) {
  let files = [];
  try {
    files = await chooseFiles({ multiple: true, accept: HMS_ACCEPT });
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    throw error;
  }
  if (!files?.length) return;
  const col = db.collection("projects").doc(projectId).collection("hmsDocs");
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    status.textContent = `Laster opp ${index + 1} av ${files.length}…`;
    if (!isHmsFileName(file.name) || file.size > HMS_MAX_BYTES) {
      toast(`${file.name || "Filen"} må være PDF, Word eller bilde under 25 MB`);
      continue;
    }
    const docRef = col.doc();
    const storagePath = hmsStoragePath(projectId, docRef.id, file.name);
    try {
      const contentType = hmsContentType(file.name);
      const stored = storage.ref(storagePath);
      await stored.put(file, { contentType });
      const url = await stored.getDownloadURL();
      await docRef.set({
        ...newHmsDoc({
          name: file.name,
          url,
          storagePath,
          contentType,
          uploadedBy: user?.email || "",
        }),
        createdAt: stamp(),
      });
    } catch (error) {
      console.error(error);
      await storage.ref(storagePath).delete().catch(() => {});
      toast(`Kunne ikke laste opp ${file.name || "filen"}`);
    }
  }
  status.textContent = "Ferdig lastet opp";
}

function mountDocuments(route) {
  const list = el("div", { class: "stack" });
  const status = el("p", { class: "meta" }, "");
  main.append(el("div", { class: "screen" }, [
    el("p", { class: "lead" }, "Tegninger, tilbud og oppdateringer. Det kunden laster opp venter til du godkjenner det."),
    button("Last opp dokument", {
      class: "btn btn-primary btn-block",
      icon: "file",
      onClick: () => uploadDocuments(route.projectId, status, true),
    }),
    status,
    list,
  ]));
  subs.push(db.collection("projects").doc(route.projectId).collection("documents").orderBy("createdAt", "desc").onSnapshot((snap) => {
    list.replaceChildren();
    if (snap.empty) list.append(el("p", { class: "empty" }, "Ingen dokumenter ennå."));
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const row = el("article", { class: "card continue" }, [
        el("h2", {}, data.name || "Dokument"),
        el("p", { class: "meta" }, [
          data.source === "customer" ? "Fra kunde" : "Deg",
          formatWhen(data.createdAt),
          data.approved === false ? "Venter" : "Godkjent",
        ].filter(Boolean).join(" · ")),
        data.url ? el("a", { href: data.url, target: "_blank", rel: "noopener" }, "Åpne") : null,
      ]);
      const actions = el("div", { class: "action-row" });
      if (data.approved === false) {
        actions.append(button("Godkjenn", {
          class: "btn btn-primary",
          onClick: () => docSnap.ref.update({ approved: true }),
        }));
      }
      actions.append(button("Slett", {
        class: "btn btn-danger",
        onClick: async () => {
          if (!window.confirm("Slette dokumentet?")) return;
          if (data.storagePath) await storage.ref(data.storagePath).delete().catch(() => {});
          await docSnap.ref.delete();
        },
      }));
      row.append(actions);
      list.append(row);
    });
  }, (error) => {
    console.error(error);
    toast("Kunne ikke hente dokumentene");
  }));
}

async function uploadDocuments(projectId, status, approved) {
  let files = [];
  try {
    files = await chooseFiles({ multiple: true, accept: "*/*" });
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    throw error;
  }
  if (!files?.length) return;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    status.textContent = `Laster opp ${index + 1} av ${files.length}…`;
    try {
      const filename = `${Date.now()}-${index}-${file.name || "dokument"}`.replace(/[\\/]/g, "-");
      const storagePath = `projects/${projectId}/documents/${filename}`;
      const ref = storage.ref(storagePath);
      await ref.put(file, { contentType: file.type || "application/octet-stream" });
      const url = await ref.getDownloadURL();
      await db.collection("projects").doc(projectId).collection("documents").add({
        name: file.name || "Dokument",
        url,
        storagePath,
        approved: approved === true,
        source: "admin",
        uploadedBy: user?.email || "",
        createdAt: stamp(),
      });
    } catch (error) {
      console.error(error);
      toast(`Kunne ikke laste opp ${file.name || "filen"}`);
    }
  }
  status.textContent = "Ferdig lastet opp";
}

function mountTemplates() {
  const list = el("div", { class: "stack" });
  main.append(el("div", { class: "screen" }, [
    el("p", { class: "lead" }, "Malene styrer hvilke bilder som bør tas, for eksempel før, grøft og ferdig. Du kan endre trinnene."),
    button("Lagre standardmaler", {
      class: "btn btn-primary btn-block",
      onClick: saveDefaultTemplates,
    }),
    list,
    templateEditor(null),
  ]));
  const draw = () => {
    if (list.contains(document.activeElement)) return;
    list.replaceChildren();
    const rows = templateChoices();
    for (const template of rows) list.append(templateEditor(template));
  };
  refresh = draw;
  draw();
}

function templateEditor(template) {
  const name = el("input", { type: "text", maxlength: "80", value: template?.name || "", placeholder: "Navn, f.eks. Drenering" });
  const steps = el("textarea", {
    rows: "4",
    maxlength: "500",
    placeholder: "Ett trinn per linje",
    value: template?.steps?.join("\n") || "",
  });
  const form = el("form", { class: "card continue stack" }, [
    el("h2", { class: "h-app" }, template ? template.name : "Ny mal"),
    field("Navn", name),
    field("Trinn", steps),
    button(template ? "Lagre mal" : "Legg til mal", { type: "submit", class: "btn btn-primary" }),
    template && templates.some((item) => item.id === template.id)
      ? button("Slett mal", {
        class: "btn btn-danger",
        onClick: async () => {
          if (!window.confirm("Slette malen?")) return;
          await db.collection("photoTemplates").doc(template.id).delete();
        },
      })
      : null,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const trimmed = name.value.trim();
    const list = steps.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (!trimmed || !list.length) {
      toast("Skriv navn og minst ett trinn");
      return;
    }
    const id = template?.id || trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || crypto.randomUUID();
    try {
      await db.collection("photoTemplates").doc(id).set({
        name: trimmed,
        steps: list,
        updatedAt: stamp(),
      }, { merge: true });
      if (!template) {
        name.value = "";
        steps.value = "";
      }
      toast("Malen er lagret");
    } catch (error) {
      console.error(error);
      toast("Kunne ikke lagre malen");
    }
  });
  return form;
}

async function saveDefaultTemplates() {
  try {
    for (const template of DEFAULT_TEMPLATES) {
      await db.collection("photoTemplates").doc(template.id).set({
        name: template.name,
        steps: template.steps,
        updatedAt: stamp(),
      }, { merge: true });
    }
    toast("Standardmalene er lagret");
  } catch (error) {
    console.error(error);
    toast("Kunne ikke lagre malene");
  }
}

function fillTabs() {
  const spec = [
    ["projects", "Prosjekter", "projects"],
    ["capture", "", "camera"],
    ["reminders", "Påminnelser", "bell"],
  ];
  for (const [name, label, ic] of spec) {
    const tab = document.querySelector(`[data-tab="${name}"]`);
    tab.replaceChildren(icon(ic));
    if (label) {
      const span = document.createElement("span");
      span.textContent = label;
      tab.append(span);
    }
    if (name === "reminders") tab.append(el("span", { class: "badge", id: "due-badge", hidden: true }, "0"));
    tab.addEventListener("click", () => {
      if (name === "capture") {
        if (current().name === "capture") return;
        captureKind = "bilde";
        const projectId = localStorage.getItem("lastProjectId") || projects[0]?.id || null;
        push({ name: "capture", projectId });
        return;
      }
      if (name === "reminders") {
        if (current().name === "reminders") return;
        push({ name: "reminders" });
        return;
      }
      if (current().name === "projects") return;
      push({ name: "projects" });
    });
  }
  backBtn.replaceChildren(icon("back"));
}

function requestBack(hardware = false) {
  const native = hardware || !!window.Capacitor?.isNativePlatform?.();
  const action = backAction({
    route: current().name,
    depth: stack.length,
    overlay: !!document.querySelector(".sheet-back, .viewer"),
    native,
  });
  if (action === "minimize") {
    window.Capacitor?.Plugins?.App?.minimizeApp?.();
    return;
  }
  if (action === "root" || (action === "pop" && stack.length <= 1)) {
    reset({ name: user ? "projects" : "login" });
    return;
  }
  history.back();
}

function bindHardwareBack() {
  const attach = () => {
    const AppPlugin = window.Capacitor?.Plugins?.App;
    if (!AppPlugin?.addListener || bindHardwareBack.done) return !!bindHardwareBack.done;
    bindHardwareBack.done = true;
    AppPlugin.addListener("backButton", () => {
      requestBack(true);
    });
    AppPlugin.addListener("appStateChange", (state) => {
      if (state?.isActive) syncQueue();
    });
    return true;
  };
  if (attach()) return;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (attach() || tries > 20) clearInterval(timer);
  }, 250);
}

function bindChrome() {
  bindHardwareBack();
  backBtn.addEventListener("click", () => requestBack(false));
  netRetry?.addEventListener("click", () => retryQueuedItems());
  window.addEventListener("popstate", async (event) => {
    if (!user) {
      if (current().name !== "login") {
        stack = [{ name: "login" }];
        persistStack();
        render();
      }
      return;
    }
    const next = event.state?.stack;
    if (!Array.isArray(next) || !next.length) return;
    if (JSON.stringify(next) === JSON.stringify(snapshotStack())) return;
    const leaving = current();
    if (leaving.name === "review" && !skipReviewSave) await persistReview(leaving.ids || []);
    skipReviewSave = false;
    stack = next.map((entry) => ({ ...entry, ids: entry.ids ? [...entry.ids] : undefined }));
    persistStack();
    render();
  });
  window.addEventListener("online", () => {
    online = true;
    updateChrome();
    syncQueue();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncQueue();
  });
  window.addEventListener("offline", () => {
    online = false;
    updateChrome();
  });
  const Network = window.Capacitor?.Plugins?.Network;
  if (Network) {
    Network.addListener("networkStatusChange", (status) => {
      online = !!status.connected;
      updateChrome();
      if (online) syncQueue();
    });
    Network.getStatus().then((status) => {
      online = !!status.connected;
      updateChrome();
      if (online) syncQueue();
    }).catch(() => {});
  }
}

function startProjects() {
  if (stopProjects) return;
  stopProjects = db.collection("projects").orderBy("createdAt", "desc").onSnapshot(
    (snap) => {
      projects = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      updateChrome();
      refresh();
      purgeOldTrash();
    },
    (error) => {
      console.error(error);
      if (!toldDenied) {
        toldDenied = true;
        toast("Kunne ikke hente prosjekter. Kontoen må være e.bors@hotmail.com.");
      }
    }
  );
}

function startTemplates() {
  if (stopTemplates) return;
  stopTemplates = db.collection("photoTemplates").onSnapshot((snap) => {
    templates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const route = current();
    if (["templates", "capture", "project", "report", "form"].includes(route.name)) refresh();
  }, (error) => console.error(error));
}

async function registerAdminPush() {
  const Push = window.Capacitor?.Plugins?.PushNotifications;
  if (!Push || !user || pushReady) return;
  pushReady = true;
  try {
    let perm = await Push.checkPermissions();
    if (perm.receive !== "granted") perm = await Push.requestPermissions();
    if (perm.receive !== "granted") return;
    await Push.addListener("registration", async (token) => {
      const value = token?.value || "";
      const id = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 80);
      if (!id) return;
      await db.collection("adminDevices").doc(id).set({
        token: value,
        platform: "android",
        updatedAt: stamp(),
      }, { merge: true });
    });
    await Push.addListener("registrationError", (error) => console.warn("Push", error));
    await Push.register();
  } catch (error) {
    console.warn("Push er ikke satt opp ennå", error);
  }
}

async function boot() {
  fillTabs();
  bindChrome();
  if (!window.firebase) {
    main.replaceChildren(el("p", { class: "screen empty" }, "Kunne ikke starte. Firebase mangler i appen."));
    return;
  }
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  const transport = firestoreTransportSettings(window.Capacitor);
  if (transport.experimentalForceLongPolling) db.settings(transport);
  storage = firebase.storage();
  try {
    await db.enablePersistence();
  } catch (error) {
    console.warn("Lokal database er ikke aktiv", error);
  }
  await migrateLegacyQueue().catch((error) => console.error(error));
  auth.onAuthStateChanged(async (next) => {
    user = next;
    if (!user) {
      stopProjects?.();
      stopProjects = null;
      stopTemplates?.();
      stopTemplates = null;
      templates = [];
      projects = [];
      stack = [{ name: "login" }];
      navReady = false;
      sessionStorage.removeItem("nav");
      history.replaceState({ stack: snapshotStack() }, "");
      render();
      return;
    }
    restoreStack();
    await releaseStaleHolds();
    queueItems = await listQueue();
    startProjects();
    startTemplates();
    registerAdminPush();
    persistStack();
    render();
    syncQueue();
  });
}

boot();
