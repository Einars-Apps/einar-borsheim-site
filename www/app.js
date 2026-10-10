import { firebaseConfig } from "./firebase-config.js";
import { COMPANY } from "./js/company.js";
import {
  KIND_META,
  buildLocalDraft,
  buildReferenceDoc,
  dueReminderCount,
  formatDay,
  formatWhen,
  portalUrl,
  projectShareText,
  randomToken,
  reminderPlan,
  reminderShareText,
  reminderWhenLabel,
  toDate,
} from "./js/logic.js";
import { AI_DRAFT_URL, requestAiDraft } from "./js/ai.js";
import { compressImage, blobToDataUrl } from "./js/image.js";
import { addToQueue, getQueueItem, listQueue, removeQueue, updateQueue } from "./js/queue.js";
import { generatePdfBlob } from "./js/pdf.js";
import { button, el, field, icon, sheet, toast } from "./js/dom.js";

const ROUTES = new Set(["projects", "reminders", "capture", "project", "section", "item", "review", "form", "report"]);

const main = document.getElementById("main");
const topbar = document.getElementById("topbar");
const backBtn = document.getElementById("back-btn");
const topTitle = document.getElementById("top-title");
const topKicker = document.getElementById("top-kicker");
const topAction = document.getElementById("top-action");
const tabbar = document.getElementById("tabbar");
const netBanner = document.getElementById("net-banner");

let auth;
let db;
let storage;
let user = null;
let projects = [];
let queueItems = [];
let stack = [{ name: "login" }];
let online = navigator.onLine;
let syncing = false;
let captureKind = "bilde";
let stopProjects = null;
let toldDenied = false;
let skipReviewSave = false;
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
  try {
    const saved = JSON.parse(sessionStorage.getItem("nav") || "");
    if (Array.isArray(saved) && saved.length && saved.every((entry) => entry && ROUTES.has(entry.name))) {
      stack = saved;
      return;
    }
  } catch {
    /* behold standard */
  }
  stack = [{ name: "projects" }];
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
  let banner = "";
  if (!online) {
    banner = waiting.length
      ? `Ingen nett. ${waiting.length} ${waiting.length === 1 ? "bilde ligger" : "bilder ligger"} på telefonen.`
      : "Ingen nett. Notater lagres på telefonen og sendes når du er tilkoblet.";
  } else if (syncing) banner = "Sender bilder…";
  else if (failed.length) banner = `${failed.length} ble ikke sendt. Trykk for å prøve igjen.`;
  else if (waiting.length) banner = `Venter på å sende ${waiting.length}…`;
  netBanner.hidden = !banner;
  netBanner.textContent = banner;
  document.body.classList.toggle("has-banner", !!banner);
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
  if (Share) {
    try {
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    } catch (error) {
      if (isCancel(error)) return false;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Lenke kopiert");
    return true;
  } catch {
    window.prompt("Kopier lenken:", url);
    return true;
  }
}

async function ensureToken(project) {
  if (project.shareToken) return project.shareToken;
  const shareToken = randomToken(12);
  await db.collection("projects").doc(project.id).update({ shareToken, updatedAt: stamp() });
  project.shareToken = shareToken;
  return shareToken;
}

async function shareProject(project, year) {
  try {
    const token = await ensureToken(project);
    const url = portalUrl(project.id, token);
    const text = year ? reminderShareText(project, year, url) : projectShareText(project, url);
    return await shareText(year ? "Påminnelse til kunde" : "Del med kunde", text, url);
  } catch (error) {
    console.error(error);
    toast("Kunne ikke dele lenken");
    return false;
  }
}

function chooseFiles({ capture = false, multiple = false } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
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

async function blobsFromCamera(source) {
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
    return [await (await fetch(photo.webPath)).blob()];
  }
  const result = await Camera.pickImages({ quality: 85, limit: 12 });
  return Promise.all(result.photos.map(async (photo) => (await fetch(photo.webPath)).blob()));
}

async function ingestBlobs(projectId, kind, blobs, { title = "", text = "", mode = "create", itemId = "" } = {}) {
  const limited = blobs.slice(0, 12);
  if (blobs.length > 12) toast("De 12 første bildene blir med");
  const ids = [];
  for (let index = 0; index < limited.length; index++) {
    const compressed = await compressImage(limited[index]);
    const id = crypto.randomUUID();
    await addToQueue({
      id,
      projectId,
      kind,
      mode,
      itemId: mode === "attach" ? itemId : crypto.randomUUID(),
      photoId: crypto.randomUUID(),
      title,
      text,
      blob: compressed,
      filename: `${Date.now()}-${index}-${id.slice(0, 8)}.jpg`,
      createdAt: Date.now(),
      held: mode !== "attach",
      error: "",
    });
    ids.push(id);
  }
  await refreshQueue();
  if (mode === "attach") {
    toast("Bildet er lagret på telefonen");
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
    const blobs = await blobsFromCamera(source);
    await ingestBlobs(projectId, captureKind, blobs);
  } catch (error) {
    if (isCancel(error) || error?.code === "cancel") return;
    console.error(error);
    toast("Kunne ikke hente bildet. Prøv et annet bilde, eller ta det på nytt.");
  }
}

async function uploadQueueItem(item) {
  let url = item.url || "";
  let storagePath = item.storagePath || "";
  if (item.blob && !url) {
    storagePath = `projects/${item.projectId}/media/${item.filename}`;
    const ref = storage.ref(storagePath);
    await ref.put(item.blob, { contentType: "image/jpeg" });
    url = await ref.getDownloadURL();
    await updateQueue(item.id, { url, storagePath });
  }
  const itemRef = db.collection("projects").doc(item.projectId).collection("items").doc(item.itemId);
  if (item.mode === "attach") {
    const existing = await itemRef.get();
    if (!existing.exists) throw new Error("Notatet finnes ikke ennå");
    if (url && !existing.data().coverUrl) {
      await itemRef.set({ coverUrl: url, updatedAt: stamp() }, { merge: true });
    }
  } else {
    const existing = await itemRef.get();
    if (!existing.exists) {
      await itemRef.set({
        kind: item.kind || "bilde",
        title: item.title || "",
        text: item.text || "",
        stars: null,
        approved: true,
        reference: false,
        source: "admin",
        createdBy: user?.uid || "",
        authorName: "Einar",
        coverUrl: url || "",
        createdAt: firebase.firestore.Timestamp.fromDate(new Date(item.createdAt || Date.now())),
        updatedAt: stamp(),
      });
    } else if (url && !existing.data().coverUrl) {
      await itemRef.set({ coverUrl: url, updatedAt: stamp() }, { merge: true });
    }
  }
  if (url) {
    const photoRef = itemRef.collection("photos").doc(item.photoId);
    const photo = await photoRef.get();
    if (!photo.exists) {
      await photoRef.set({
        url,
        storagePath,
        caption: item.text || "",
        approved: true,
        source: "admin",
        createdBy: user?.uid || "",
        createdAt: firebase.firestore.Timestamp.fromDate(new Date(item.createdAt || Date.now())),
      });
    }
  }
}

async function syncQueue() {
  if (syncing || !user || !online) {
    updateChrome();
    return;
  }
  syncing = true;
  updateChrome();
  try {
    const items = await listQueue();
    for (const item of items) {
      if (item.held) continue;
      try {
        await uploadQueueItem(item);
        await removeQueue(item.id);
      } catch (error) {
        console.error(error);
        await updateQueue(item.id, { error: "Kunne ikke sende" });
      }
    }
  } finally {
    syncing = false;
    await refreshQueue();
  }
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
    photosByItem[id] = [{ url: data.url, caption: data.caption || "", approved: data.approved !== false }];
    const comments = await root.collection("photos").doc(doc.id).collection("comments").get();
    commentsByItem[id] = comments.docs.map((entry) => entry.data());
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
    ["endring", "Endringer"],
    ["avvik", "Avvik"],
    ["kunde", "Grunnlag fra kunde"],
  ];
  const sections = [];
  for (const [kind, title] of groups) {
    const group = [];
    for (const item of approved.filter((entry) => entry.kind === kind)) {
      const photos = [];
      for (const photo of photosByItem[item.id] || []) {
        if (photo.approved === false || !photo.url) continue;
        try {
          photos.push({ dataUrl: await urlToDataUrl(photo.url), caption: photo.caption || "" });
        } catch (error) {
          console.error(error);
          photos.push({ caption: "Bildet kunne ikke hentes inn i PDF-en." });
        }
      }
      group.push({
        title: item.title || "",
        text: item.text || "",
        createdAt: item.createdAt,
        photos,
        comments: (commentsByItem[item.id] || []).filter((comment) => comment.approved !== false && comment.text),
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
  const result = await generatePdfBlob({ project, reportText, sections });
  const path = `projects/${project.id}/rapport/sluttrapport.pdf`;
  await storage.ref(path).put(result.blob, { contentType: "application/pdf" });
  const pdfUrl = await storage.ref(path).getDownloadURL();
  await db.collection("projects").doc(project.id).update({
    pdfUrl,
    pdfPath: path,
    pdfUpdatedAt: stamp(),
    updatedAt: stamp(),
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(result.blob);
  link.download = result.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

async function urlToDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("bilde");
  return blobToDataUrl(await response.blob());
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
  return itemRow(item.projectId, {
    queued: true,
    kind: item.kind,
    title: "",
    text: item.text || "Bilde venter på sending",
    createdAt: item.createdAt,
    error: item.error,
    coverUrl: "",
  });
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
      el("strong", {}, COMPANY.name),
      el("h1", { class: "h-app" }, "Internkontroll"),
      el("p", { class: "lead" }, "Feltnotater for hage og anlegg. Ta bildet, skriv kommentaren, og legg til mer senere."),
    ]),
    form,
  ]));
}

function mountProjects() {
  const root = el("div", { class: "screen" });
  const list = el("div", { class: "stack" });
  root.append(
    button("Nytt prosjekt", {
      class: "btn btn-primary btn-block",
      icon: "plus",
      onClick: () => push({ name: "form" }),
    }),
    list
  );
  main.append(root);
  const draw = () => {
    list.replaceChildren();
    if (!projects.length) {
      list.append(el("p", { class: "empty" }, "Ingen prosjekter ennå. Opprett det første, så kan du ta bilder med en gang."));
      return;
    }
    const lastId = localStorage.getItem("lastProjectId");
    const ordered = [...projects].sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : 0));
    const first = ordered[0];
    if (first) {
      const hero = el("div", { class: "card continue" }, [
        el("p", { class: "meta" }, "Fortsett"),
        el("h2", {}, first.name),
        el("p", { class: "meta" }, [first.address, first.customerName].filter(Boolean).join(" · ") || "Åpne prosjektet eller ta et bilde"),
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
            pill(project.status === "fullfort" ? "Fullført" : "Aktiv", project.status === "fullfort" ? "pill-ok" : ""),
            project.public ? pill("Referanse") : null,
            waiting ? pill(`${waiting} venter`, "pill-warn") : null,
          ]),
        ]),
      ]);
      card.addEventListener("click", () => openProject(project.id));
      list.append(card);
    }
  };
  refresh = draw;
  watchQueue(draw);
  draw();
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
    const active = project || projects[0];
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
    for (const item of projects) {
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
  const draw = () => {
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
    const info = el("section", { class: "card continue" }, [
      el("div", { class: "pills" }, [
        pill(project.status === "fullfort" ? "Fullført" : "Aktiv"),
        project.public ? pill("Offentlig referanse") : null,
        pendingKunde ? pill(`${pendingKunde} fra kunde`, "pill-warn") : null,
        pendingRating ? pill(`${pendingRating} vurdering`, "pill-warn") : null,
      ]),
      el("h1", { class: "h-app" }, project.name),
      el("p", { class: "meta" }, [project.customerName, project.address].filter(Boolean).join(" · ") || "Legg inn kunde og adresse under Rediger"),
      project.completedAt ? el("p", { class: "meta" }, `Ferdig ${formatDay(project.completedAt)}`) : null,
      el("div", { class: "action-row" }, [
        button("Rediger", { class: "btn btn-ghost", onClick: () => push({ name: "form", projectId: project.id }) }),
        button("Del med kunde", { class: "btn btn-ghost", icon: "share", onClick: () => shareProject(project) }),
        button(project.status === "fullfort" ? "Sett aktiv" : "Fullfør i dag", {
          class: "btn btn-primary",
          onClick: () => toggleComplete(project),
        }),
      ]),
    ]);
    const tiles = el("div", { class: "dash" });
    const tileSpec = [
      ["bilde", "camera", "Bilder", count("bilde") + queued],
      ["kunde", "user", "Fra kunde", count("kunde")],
      ["endring", "edit", "Endringer", count("endring")],
      ["avvik", "alert", "Avvik", count("avvik")],
    ];
    for (const [kind, ic, label, total] of tileSpec) {
      const tile = el("button", { type: "button", class: kind === "bilde" ? "tile" : `tile tile-${kind}` }, [
        el("span", { class: "tile-ico" }, [icon(ic)]),
        el("span", {}, [
          el("span", { class: "tile-label" }, label),
          el("span", { class: "tile-count" }, `${total} ${total === 1 ? "punkt" : "punkter"}`),
        ]),
      ]);
      tile.addEventListener("click", () => push({ name: "section", projectId: project.id, kind }));
      tiles.append(tile);
    }
    const report = el("button", { type: "button", class: "tile tile-rapport" }, [
      el("span", { class: "tile-ico" }, [icon("file")]),
      el("span", { class: "tile-copy" }, [
        el("span", { class: "tile-label" }, "Rapport"),
        el("span", { class: "tile-count" }, project.pdfUrl ? "PDF lagret" : "Skriv og lag PDF"),
      ]),
    ]);
    report.addEventListener("click", () => push({ name: "report", projectId: project.id }));
    tiles.append(report);
    root.append(info, tiles);
  };
  refresh = () => draw();
  watchQueue(draw);
  subs.push(db.collection("projects").doc(route.projectId).collection("items").onSnapshot((snap) => {
    items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }));
  subs.push(db.collection("projects").doc(route.projectId).collection("photos").onSnapshot((snap) => {
    legacy = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    draw();
  }));
  draw();
}

async function toggleComplete(project) {
  try {
    if (project.status === "fullfort") {
      await db.collection("projects").doc(project.id).update({ status: "aktiv", completedAt: null, updatedAt: stamp() });
      toast("Prosjektet er aktivt igjen");
    } else {
      await db.collection("projects").doc(project.id).update({
        status: "fullfort",
        completedAt: stamp(),
        reminder1Done: false,
        reminder2Done: false,
        updatedAt: stamp(),
      });
      toast("Markert som fullført. Påminnelse vises om ca. ett år.");
    }
  } catch (error) {
    console.error(error);
    toast("Kunne ikke oppdatere status");
  }
}

function mountSection(route) {
  const { projectId, kind } = route;
  const meta = KIND_META[kind] || KIND_META.bilde;
  const list = el("div", { class: "stack" });
  const composer = el("form", { class: "card continue", hidden: true });
  const titleInput = el("input", { type: "text", maxlength: "140", placeholder: "Kort overskrift" });
  const textInput = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Hva skjedde?" });
  composer.append(
    kind === "bilde" ? null : field("Overskrift", titleInput),
    field("Tekst", textInput),
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

  subs.push(ref.onSnapshot((snap) => {
    if (!snap.exists) {
      shape = "gone";
      head.replaceChildren(el("p", { class: "empty" }, "Notatet er slettet."));
      return;
    }
    const data = snap.data();
    const textValue = route.legacy ? data.caption || "" : data.text || "";
    const nextShape = [data.approved, data.kind, data.reference, data.source, data.stars, route.legacy].join("|");
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
      titleInput.addEventListener("input", () => schedule(() => ref.update({ title: titleInput.value, updatedAt: stamp() })));
      head.append(field("Overskrift", titleInput));
    }
    if (data.kind === "vurdering") head.append(el("p", { class: "lead" }, `${data.stars || "–"} av 5 stjerner`));
    textInput = el("textarea", { rows: "4", maxlength: "4000" });
    textInput.value = textValue;
    textInput.addEventListener("input", () => {
      schedule(() => {
        const patch = route.legacy
          ? { caption: textInput.value }
          : { text: textInput.value, updatedAt: stamp() };
        return ref.update(patch);
      });
    });
    head.append(field(route.legacy || data.kind === "bilde" ? "Kommentar" : "Tekst", textInput));
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

  if (photoCol) {
    subs.push(photoCol.orderBy("createdAt", "desc").onSnapshot((snap) => {
      photosEl.replaceChildren();
      snap.forEach((doc) => photosEl.append(photoBlock(doc, true)));
    }, () => {
      photoCol.get().then((snap) => {
        photosEl.replaceChildren();
        snap.forEach((doc) => photosEl.append(photoBlock(doc, true)));
      }).catch(() => {});
    }));
  } else {
    subs.push(ref.onSnapshot((snap) => {
      photosEl.replaceChildren();
      if (snap.exists && snap.data().url) {
        photosEl.append(el("img", { class: "preview-img", src: snap.data().url, alt: "Dokumentasjonsbilde" }));
      }
    }));
  }

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

  function photoBlock(doc, canEdit) {
    const data = doc.data();
    const caption = el("input", { type: "text", value: data.caption || "", maxlength: "300", placeholder: "Bildetekst" });
    caption.addEventListener("change", () => doc.ref.update({ caption: caption.value }));
    return el("div", { class: "photo-block" }, [
      data.url ? el("img", { src: data.url, alt: data.caption || "Bilde" }) : el("p", {}, "Bilde uten lenke"),
      data.approved === false ? pill("Venter", "pill-warn") : null,
      canEdit ? caption : null,
      button("Slett bilde", {
        class: "btn btn-danger",
        onClick: async () => {
          if (!window.confirm("Slette dette bildet?")) return;
          try {
            if (data.storagePath) await storage.ref(data.storagePath).delete().catch(() => {});
            await doc.ref.delete();
          } catch (error) {
            console.error(error);
            toast("Kunne ikke slette bildet");
          }
        },
      }),
    ]);
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
    const blobs = await blobsFromCamera("camera").catch(async (error) => {
      if (isCancel(error)) throw error;
      return chooseFiles({ capture: true });
    });
    await ingestBlobs(projectId, kind || "bilde", blobs, { mode: "attach", itemId });
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
      const url = URL.createObjectURL(items[0].blob);
      const input = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Kommentar til bildet" });
      input.dataset.queueId = items[0].id;
      input.value = items[0].text || "";
      list.append(el("img", { class: "preview-img", src: url, alt: "Nytt bilde" }), field("Kommentar", input));
      return;
    }
    for (const item of items) {
      const url = URL.createObjectURL(item.blob);
      const input = el("textarea", { rows: "2", maxlength: "4000", placeholder: "Kommentar" });
      input.dataset.queueId = item.id;
      input.value = item.text || "";
      list.append(el("div", { class: "review-row" }, [
        el("img", { src: url, alt: "" }),
        input,
      ]));
    }
  })().catch((error) => {
    console.error(error);
    list.append(el("p", { class: "empty" }, "Kunne ikke vise bildet."));
  });
}

function mountForm(route) {
  const name = el("input", { type: "text", required: true, maxlength: "140", placeholder: "F.eks. Hageanlegg med støttemur" });
  const address = el("input", { type: "text", maxlength: "180", placeholder: "Kun synlig for deg og kunden" });
  const customerName = el("input", { type: "text", maxlength: "120" });
  const customerPhone = el("input", { type: "tel", maxlength: "40", autocomplete: "tel" });
  const customerEmail = el("input", { type: "email", maxlength: "120", autocomplete: "email" });
  const description = el("textarea", { rows: "3", maxlength: "2000" });
  const publicLocation = el("input", { type: "text", maxlength: "80", placeholder: "F.eks. Asker" });
  const publicSummary = el("textarea", { rows: "4", maxlength: "1200", placeholder: "Kort omtale uten kundens navn og adresse" });
  const completed = el("input", { type: "date" });
  const isPublic = el("input", { type: "checkbox" });
  const save = button("Lagre", { type: "submit", class: "btn btn-primary btn-block" });
  if (route.projectId) save.disabled = true;
  const form = el("form", { class: "screen stack" }, [
    field("Prosjektnavn", name),
    field("Adresse", address),
    field("Kundenavn", customerName),
    field("Telefon til kunde", customerPhone),
    field("E-post til kunde", customerEmail),
    field("Beskrivelse", description),
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
      updatedAt: stamp(),
    };
    try {
      if (!route.projectId) {
        const ref = await db.collection("projects").add({
          ...common,
          publicLocation: "",
          publicSummary: "",
          reportText: "",
          shareToken: randomToken(12),
          public: false,
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
        toast("Prosjekt opprettet");
        reset({ name: "project", projectId: ref.id });
        return;
      }
      const patch = {
        ...common,
        publicLocation: publicLocation.value.trim(),
        publicSummary: publicSummary.value.trim(),
        public: isPublic.checked,
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
      await saveReportPdf({ ...project, reportText: text.value }, text.value);
      toast("Rapporten er lagret i prosjektet og lastet ned");
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
    status,
    el("div", { class: "action-row" }, [
      button("Lag utkast fra notater", { class: "btn btn-ghost", onClick: () => fillDraft(false) }),
      button("KI-assistent", { class: "btn btn-ghost", onClick: () => runAi() }),
    ]),
    aiPanel,
    pdfButton,
    pdfLine,
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
    const rows = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((item) => item.kind === "vurdering");
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
        captureKind = "bilde";
        const projectId = localStorage.getItem("lastProjectId") || projects[0]?.id || null;
        push({ name: "capture", projectId });
        return;
      }
      reset({ name });
    });
  }
  backBtn.replaceChildren(icon("back"));
}

function bindChrome() {
  backBtn.addEventListener("click", () => history.back());
  netBanner.addEventListener("click", () => syncQueue());
  window.addEventListener("popstate", async (event) => {
    const leaving = current();
    if (leaving.name === "review" && !skipReviewSave) await persistReview(leaving.ids || []);
    skipReviewSave = false;
    const next = event.state?.stack;
    stack = Array.isArray(next) && next.length ? next.map((entry) => ({ ...entry })) : [{ name: user ? "projects" : "login" }];
    persistStack();
    render();
  });
  window.addEventListener("online", () => {
    online = true;
    updateChrome();
    syncQueue();
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
      projects = [];
      stack = [{ name: "login" }];
      sessionStorage.removeItem("nav");
      history.replaceState({ stack: snapshotStack() }, "");
      render();
      return;
    }
    restoreStack();
    await releaseStaleHolds();
    queueItems = await listQueue();
    startProjects();
    history.replaceState({ stack: snapshotStack() }, "");
    persistStack();
    render();
    syncQueue();
  });
}

boot();
