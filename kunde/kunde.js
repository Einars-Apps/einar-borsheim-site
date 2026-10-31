import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import {
  PORTAL_PREVIEW_APP,
  PORTAL_PREVIEW_BANNER,
  applyPortalPreviewLock,
  approvalLine,
  customerOwnPending,
  customerVisibleContent,
  customerVisibleDocument,
  formatDay,
  formatWhen,
  isCompleted,
  isPortalPreview,
  normalizedCustomerName,
  portalAccessStep,
} from "../www/js/logic.js";
import {
  alternativeHeading,
  alternativePriceText,
  chosenAlternative,
  customerDecisionError,
  customerDecisionPatch,
  isOfferItem,
  offerStatus,
  offerStatusLabel,
  offerTypeLabel,
} from "../www/js/offers.js";
import { changeText, customerSeesCost, liveCost } from "../www/js/cost.js";
import { renderCostOverview, renderCustomerHistory, renderPaymentSummary } from "../www/js/cost-view.js";
import { renderCustomerRequests } from "../www/js/requests-view.js";
import { canSpeak, dictate } from "../www/js/speech.js";
import { isTrashedPhoto, photoKey, publicPhotos, redundantPhotoItem, sortPhotos } from "../www/js/photos.js";
import { gpsLabel, photoWhen, showGpsInReport } from "../www/js/place.js";
import { mapAnchor, openPhotoViewer } from "../www/js/photo-view.js";
import { renderCustomerHms } from "../www/js/hms-view.js";

const params = new URLSearchParams(window.location.search);
const projectId = params.get("p");
const token = params.get("t");
const previewMode = isPortalPreview(params);
const app = previewMode ? initializeApp(firebaseConfig, PORTAL_PREVIEW_APP) : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const viewLoading = document.getElementById("view-loading");
const viewError = document.getElementById("view-error");
const viewProject = document.getElementById("view-project");

let uid = "";
let project = null;
let approvedItems = [];
let ownItems = [];
let legacyPhotos = [];
let approvedDocs = [];
let ownDocs = [];
let hmsDocs = [];
let thread = [];
let costState = null;
let costHistory = [];
let payments = [];
let requests = [];
let stopCost = null;
let stopCostLog = null;
let stopPayments = null;

function watchPayments() {
  if (stopPayments) return;
  stopPayments = onSnapshot(collection(db, "projects", projectId, "payments"), (snap) => {
    payments = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    if (document.getElementById("cost-slot")) paintCost();
    else paintPayments();
  }, (error) => console.error(error));
}

function watchCost() {
  if (!customerSeesCost(project)) {
    if (stopCost) stopCost();
    if (stopCostLog) stopCostLog();
    stopCost = null;
    stopCostLog = null;
    costState = null;
    costHistory = [];
    return;
  }
  if (!stopCost) {
    stopCost = onSnapshot(doc(db, "projects", projectId, "quantities", "live"), (snap) => {
      costState = snap.exists() ? snap.data() : null;
      if (document.getElementById("cost-slot")) paintCost();
    }, (error) => console.error(error));
  }
  if (!stopCostLog) {
    stopCostLog = onSnapshot(query(collection(db, "projects", projectId, "costLog"), orderBy("at", "desc")), (snap) => {
      costHistory = snap.docs.map((docSnap) => docSnap.data());
      if (document.getElementById("cost-slot")) paintCost();
    }, (error) => console.error(error));
  }
}
let previewChoices = {};

function show(view) {
  for (const node of [viewLoading, viewError, viewProject]) node.classList.add("hidden");
  view.classList.remove("hidden");
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function field(label, input) {
  return el("label", { class: "field" }, [label, input]);
}

async function compressImage(file, maxDimension = 1600, quality = 0.75) {
  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    if (width > height && width > maxDimension) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else if (height > maxDimension) {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("tomt bilde");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

function displayUrl(value) {
  const url = String(value || "");
  if (!url || url.length > 2000) return "";
  if (url.startsWith("https://")) return url;
  if (url.startsWith("http://127.0.0.1:9199/") || url.startsWith("http://localhost:9199/")) return url;
  return "";
}

function mergedItems() {
  const map = new Map();
  for (const item of approvedItems) map.set(item.id, item);
  for (const item of ownItems) map.set(item.id, item);
  return [...map.values()]
    .filter((item) => customerVisibleContent(item, uid))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

let renderAfterBlur = false;
let portalGeneration = 0;
const portalPhotos = new Map();
let gpsById = new Map();
let stopGps = null;

function annotatePortalPhoto(photo, item) {
  return {
    ...photo,
    itemId: item?.id || photo.itemId || "",
    step: photo.step || item?.step || "",
    comment: photo.caption || item?.text || "",
    itemText: item?.text || "",
    itemTitle: item?.title || "",
  };
}

function legacyAnnotated() {
  return legacyPhotos
    .filter((photo) => !isTrashedPhoto(photo))
    .map((photo) => annotatePortalPhoto(photo, { id: `legacy-${photo.id}`, text: photo.caption || "", step: "" }));
}

function portalFlat() {
  return [...portalPhotos.values()].flat().concat(legacyAnnotated());
}
let notice = "";

function paintCost() {
  const slot = document.getElementById("cost-slot");
  if (!slot) return;
  const items = mergedItems();
  for (const item of items) {
    if (offerStatus(item) !== "sendt") delete previewChoices[item.id];
  }
  const summary = liveCost({
    cost: costState,
    prices: {},
    items,
    previewChoices,
  });
  slot.replaceChildren(renderCostOverview({
    summary,
    history: costHistory.map((entry) => ({
      at: entry.at,
      when: formatWhen(entry.at),
      byName: entry.byName || "Einar",
      text: entry.text || changeText(entry),
      field: entry.field,
      from: entry.from,
      to: entry.to,
      unit: entry.unit || "",
      label: entry.label || "",
      lineId: entry.lineId || "",
    })),
    items,
    audience: "kunde",
    editable: false,
    showPreview: true,
    payments,
  }));
}

function paintPayments() {
  const slot = document.getElementById("payment-slot");
  if (!slot) return;
  slot.replaceChildren(renderPaymentSummary({
    payments,
    showBalance: false,
    editable: false,
  }));
}

function paintRequests() {
  const slot = document.getElementById("request-slot");
  if (!slot) return;
  slot.replaceChildren(renderCustomerRequests({
    requests,
    onCreate: async (text) => {
      if (previewMode) return;
      await addDoc(collection(db, "projects", projectId, "requests"), {
        status: "ny",
        text: String(text || "").trim().slice(0, 1999),
        createdBy: uid,
        createdAt: serverTimestamp(),
      });
    },
    onDecide: async (request, status) => {
      if (previewMode || !request?.id) return;
      await updateDoc(doc(db, "projects", projectId, "requests", request.id), {
        status,
        decidedAt: serverTimestamp(),
        decidedBy: uid,
      });
    },
  }));
  if (previewMode) applyPortalPreviewLock(slot);
}

function render() {
  if (!project) return;
  const active = document.activeElement;
  const typing = active && viewProject.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (typing) {
    paintCost();
    paintPayments();
    paintRequests();
    if (!renderAfterBlur) {
      renderAfterBlur = true;
      active.addEventListener("blur", () => {
        renderAfterBlur = false;
        render();
      }, { once: true });
    }
    return;
  }
  portalGeneration += 1;
  portalPhotos.clear();
  const items = mergedItems();
  const finished = isCompleted(project);
  const pdfSlot = el("p", { class: "muted" }, "Sluttrapporten legges her når den er klar.");
  const pdfPath = `projects/${projectId}/rapport/sluttrapport.pdf`;
  viewProject.replaceChildren();
  if (previewMode) {
    viewProject.append(el("p", { class: "preview-banner", role: "status" }, PORTAL_PREVIEW_BANNER));
  }
  const customerName = normalizedCustomerName(project.customerName);
  viewProject.append(el("section", { class: "k-card k-stack" }, [
    el("p", { class: "muted" }, "Ditt prosjekt"),
    el("h1", {}, project.name || "Prosjekt"),
    customerName ? el("p", { class: "customer-name" }, customerName) : null,
    project.description ? el("p", { class: "pre" }, project.description) : null,
    project.address ? el("p", { class: "muted" }, project.address) : null,
    finished ? el("p", { class: "muted" }, `Ferdig ${formatDay(project.completedAt) || ""}`.trim()) : null,
    finished ? pdfSlot : el("p", { class: "muted" }, "Sluttrapporten kan lastes ned når oppdraget er ferdig og godkjent."),
  ]));
  const knownPdf = displayUrl(project.pdfUrl);
  if (finished && project.pdfPath === pdfPath) {
    getDownloadURL(ref(storage, pdfPath)).then((url) => {
      const href = displayUrl(url);
      if (!href || !pdfSlot.isConnected) return;
      pdfSlot.replaceWith(el("a", { class: "pdf-link", href, target: "_blank", rel: "noopener" }, "Last ned sluttrapport (PDF)"));
    }).catch(() => {});
  } else if (finished && knownPdf) {
    pdfSlot.replaceWith(el("a", { class: "pdf-link", href: knownPdf, target: "_blank", rel: "noopener" }, "Last ned sluttrapport (PDF)"));
  }

  if (project.reportText && project.reportText.trim()) {
    viewProject.append(el("section", { class: "k-card" }, [
      el("h2", {}, "Arbeid utført"),
      el("p", { class: "pre" }, project.reportText.trim()),
    ]));
  }
  viewProject.append(el("section", { id: "report-photos", class: "k-card k-stack", hidden: true }, [
    el("h2", {}, "Bilder"),
  ]));

  const offerPosts = items.filter((item) => isOfferItem(item) && item.fikenBase !== true && item.approved === true && item.approvalRequested === true);
  if (!customerSeesCost(project)) {
    viewProject.append(el("section", { class: "k-card k-stack", id: "payment-card" }, [
      el("div", { id: "payment-slot" }),
    ]));
  }
  if (offerPosts.length || customerSeesCost(project)) {
    const box = el("section", { class: "k-card k-stack", id: "offers" }, [
      el("h2", {}, "Tilbud og endringer"),
    ]);
    if (offerPosts.length) {
      box.append(el("p", { class: "muted" }, "Velg ett alternativ og trykk Godkjenn valgt løsning. Tidspunkt og navn lagres. Pris kr 0,00 er inkludert."));
      for (const item of offerPosts) box.append(offerCard(item));
    }
    if (customerSeesCost(project)) box.append(el("div", { id: "cost-slot" }));
    else {
      const story = renderCustomerHistory({ items: offerPosts, audience: "kunde" });
      if (story) box.append(story);
    }
    viewProject.append(box);
  }

  const requestSlot = el("div", { id: "request-slot" });
  viewProject.append(requestSlot);
  paintRequests();

  const groups = [
    ["tilbud", "Tilbud"],
    ["endring", "Endringer"],
    ["avvik", "Avvik"],
  ];
  for (const [kind, title] of groups) {
    const rows = items.filter((item) => item.kind === kind && item.approved === true && !isOfferItem(item));
    const section = el("section", { class: "k-card k-stack" }, [el("h2", {}, title)]);
    if (!rows.length) section.append(el("p", { class: "muted" }, "Ingenting er lagt ut her ennå."));
    for (const item of rows) section.append(itemCard(item));
    viewProject.append(section);
  }

  const mine = items.filter((item) => item.kind === "kunde" && item.createdBy === uid);
  const inbox = el("section", { class: "k-card k-stack" }, [
    el("h2", {}, "Grunnlag fra deg"),
    el("p", { class: "muted" }, "Send bilder og info som grunnlag for arbeidet. Einar godkjenner før det kommer med i rapporten."),
    notice ? el("p", { class: "notice" }, notice) : null,
    submissionForm(),
    ...mine.map((item) => itemCard(item, true)),
  ]);
  viewProject.append(inbox);
  viewProject.append(messageSection());
  viewProject.append(documentSection());
  const hms = renderCustomerHms(hmsDocs);
  if (hms) viewProject.append(hms);

  const rate = el("section", { class: "k-card k-stack" }, [el("h2", {}, "Vurdering")]);
  const ratings = items.filter((item) => item.kind === "vurdering" && item.createdBy === uid);
  if (!finished) {
    rate.append(el("p", { class: "muted" }, "Du kan legge igjen stjerner og en kommentar når oppdraget er markert ferdig."));
  } else {
    for (const item of ratings) rate.append(itemCard(item, true));
    rate.append(ratingForm());
  }
  viewProject.append(rate);
  paintCost();
  paintPayments();

  paintPortalPhotos();
  for (const item of items) hydrate(item);
  applyPortalPreviewLock(previewMode ? viewProject : null);
}

function itemCard(item, showStatus = false) {
  const card = el("article", { class: "k-card", id: `item-${item.id}` }, [
    el("h3", {}, item.title || (item.kind === "vurdering" ? `${item.stars || "–"} av 5` : "Notat")),
    showStatus ? el("p", {}, item.approved ? el("span", { class: "pill pill-ok" }, "Godkjent") : el("span", { class: "pill" }, "Venter på godkjenning")) : null,
    item.kind === "vurdering" && item.title ? el("p", {}, `${item.stars || "–"} av 5`) : null,
    item.text ? el("p", { class: "pre" }, item.text) : null,
    el("p", { class: "muted" }, formatWhen(item.createdAt)),
    approvalNote(item),
    el("div", { class: "k-stack", id: `media-${item.id}` }),
    el("div", { id: `comments-${item.id}` }),
    commentForm(item.id),
  ]);
  return card;
}

function commentForm(itemId) {
  const input = el("textarea", { rows: "2", maxlength: "2000", placeholder: "Legg til en kommentar" });
  const form = el("form", { class: "k-stack" }, [
    input,
    mic(input),
    el("button", { type: "submit", class: "btn btn-ghost" }, "Send kommentar"),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (previewMode) return;
    const text = input.value.trim();
    if (!text) return;
    form.querySelector("button").disabled = true;
    try {
      await addDoc(collection(db, "projects", projectId, "items", itemId, "comments"), {
        text,
        source: "kunde",
        authorName: "Kunde",
        approved: false,
        createdBy: uid,
        createdAt: serverTimestamp(),
      });
      input.value = "";
    } catch (error) {
      console.error(error);
      alert("Kommentaren ble ikke sendt. Prøv igjen.");
    } finally {
      form.querySelector("button").disabled = false;
    }
  });
  return form;
}

function withPortalPlace(photo) {
  if (!showGpsInReport(project)) return photo;
  const place = gpsById.get(photo.id);
  return place ? { ...photo, ...place } : photo;
}

function portalFigures(photos) {
  const usable = photos
    .map((photo) => withPortalPlace({ ...photo, url: displayUrl(photo.url) }))
    .filter((photo) => photo.url);
  if (!usable.length) return null;
  const grid = el("div", { class: usable.length > 1 ? "k-grid" : "k-stack" });
  usable.forEach((photo, index) => {
    const image = el("img", { class: "k-photo", src: photo.url, alt: photo.caption || "Bilde", loading: "lazy" });
    image.addEventListener("click", () => openPhotoViewer(usable, index));
    const when = photoWhen(photo);
    const caption = photo.caption || photo.comment || "";
    const place = showGpsInReport(project) ? gpsLabel(photo) : null;
    const text = [when, caption].filter(Boolean).join(" · ");
    grid.append(el("figure", {}, [
      image,
      text || place ? el("figcaption", { class: "muted photo-meta" }, [
        text || null,
        text && place ? " · " : null,
        place ? mapAnchor(place) : null,
      ]) : null,
    ]));
  });
  return grid;
}

function reportGalleryPhotos() {
  const flat = portalFlat().filter((photo) => photo.approved !== false && !isTrashedPhoto(photo));
  return sortPhotos(publicPhotos(flat), "oldest");
}

function paintPortalPhotos() {
  const flat = portalFlat();
  const gallery = reportGalleryPhotos();
  const galleryKeys = new Set(gallery.map(photoKey));
  const host = document.getElementById("report-photos");
  if (host) {
    host.hidden = gallery.length === 0;
    host.replaceChildren(el("h2", {}, "Bilder"));
    const figures = portalFigures(gallery);
    if (figures) host.append(figures);
  }
  const shown = new Set(publicPhotos(flat).map(photoKey));
  for (const [itemId, photos] of portalPhotos) {
    const media = document.getElementById(`media-${itemId}`);
    const card = document.getElementById(`item-${itemId}`);
    if (!media) continue;
    const item = mergedItems().find((entry) => entry.id === itemId);
    const keep = photos.filter((photo) => (
      !galleryKeys.has(photoKey(photo))
      && (shown.has(photoKey(photo)) || customerOwnPending(photo, uid))
    ));
    media.replaceChildren();
    const figures = portalFigures(keep);
    if (figures) media.append(figures);
    if (card && item) card.hidden = redundantPhotoItem(item, flat);
  }
}

async function hydrate(item) {
  const generation = portalGeneration;
  const media = document.getElementById(`media-${item.id}`);
  const comments = document.getElementById(`comments-${item.id}`);
  if (!media || media.dataset.loaded) return;
  media.dataset.loaded = "1";
  try {
    const photos = await loadVisible(collection(db, "projects", projectId, "items", item.id, "photos"));
    if (generation !== portalGeneration) return;
    portalPhotos.set(item.id, photos.filter((photo) => !isTrashedPhoto(photo)).map((photo) => annotatePortalPhoto(photo, item)));
    paintPortalPhotos();
    const thread = await loadVisible(collection(db, "projects", projectId, "items", item.id, "comments"));
    if (generation !== portalGeneration || !comments) return;
    for (const comment of thread.filter((entry) => customerVisibleContent(entry, uid))) {
      comments.append(el("div", { class: "comment" }, [
        el("small", {}, `${comment.source === "kunde" ? "Deg" : "Einar"} · ${formatWhen(comment.createdAt)}${comment.approved === false ? " · venter" : ""}`),
        el("p", { class: "pre" }, comment.text || ""),
      ]));
    }
  } catch (error) {
    console.error(error);
  }
}

async function loadVisible(col) {
  const [open, mine] = await Promise.all([
    getDocs(query(col, where("approved", "==", true))),
    getDocs(query(col, where("createdBy", "==", uid))),
  ]);
  const map = new Map();
  open.forEach((docSnap) => map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
  mine.forEach((docSnap) => map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
  return [...map.values()].filter((record) => customerVisibleContent(record, uid));
}

function submissionForm() {
  const name = el("input", { type: "text", maxlength: "80", placeholder: "Ditt navn" });
  const title = el("input", { type: "text", maxlength: "140", placeholder: "F.eks. ønske om beplantning" });
  const text = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Beskriv hva du vil vi skal ta hensyn til" });
  const files = el("input", { type: "file", accept: "image/*", multiple: true });
  const status = el("p", { class: "muted", hidden: true });
  const submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, "Send inn");
  const form = el("form", { class: "k-stack" }, [
    field("Navn", name),
    field("Overskrift", title),
    field("Beskrivelse", text),
    mic(text),
    field("Bilder", files),
    submit,
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (previewMode) return;
    const chosen = [...(files.files || [])].slice(0, 8);
    if (!text.value.trim() && !title.value.trim() && !chosen.length) {
      status.hidden = false;
      status.textContent = "Skriv en tekst eller legg ved et bilde.";
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = "Sender…";
    try {
      const refItem = await addDoc(collection(db, "projects", projectId, "items"), {
        kind: "kunde",
        title: title.value.trim(),
        text: text.value.trim(),
        approved: false,
        source: "kunde",
        createdBy: uid,
        authorName: name.value.trim() || "Kunde",
        createdAt: serverTimestamp(),
      });
      for (let index = 0; index < chosen.length; index++) {
        status.textContent = `Laster opp bilde ${index + 1} av ${chosen.length}…`;
        await uploadPhoto(refItem.id, chosen[index], index);
      }
      form.reset();
      notice = "Takk. Det vises her med en gang, og i rapporten når Einar har godkjent det.";
      document.activeElement?.blur?.();
      render();
    } catch (error) {
      console.error(error);
      status.textContent = "Noe ble ikke sendt. Prøv igjen.";
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

function ratingForm() {
  let stars = 0;
  const starRow = el("div", { class: "stars" });
  for (let value = 1; value <= 5; value++) {
    const button = el("button", { type: "button", "aria-label": `${value} av 5` }, "★");
    button.addEventListener("click", () => {
      stars = value;
      [...starRow.children].forEach((node, index) => node.setAttribute("aria-pressed", index < value ? "true" : "false"));
    });
    starRow.append(button);
  }
  const text = el("textarea", { rows: "3", maxlength: "2000", placeholder: "Hvordan ble resultatet?" });
  const files = el("input", { type: "file", accept: "image/*", multiple: true });
  const status = el("p", { class: "muted", hidden: true });
  const submit = el("button", { class: "btn btn-primary btn-block", type: "submit" }, "Send vurdering");
  const form = el("form", { class: "k-stack" }, [
    el("p", {}, "Hvor fornøyd er du?"),
    starRow,
    field("Kommentar", text),
    mic(text),
    field("Bilder av resultatet, hvis du vil", files),
    submit,
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (previewMode) return;
    if (!stars) {
      status.hidden = false;
      status.textContent = "Velg antall stjerner.";
      return;
    }
    submit.disabled = true;
    status.hidden = false;
    status.textContent = "Sender…";
    try {
      const chosen = [...(files.files || [])].slice(0, 6);
      const refItem = await addDoc(collection(db, "projects", projectId, "items"), {
        kind: "vurdering",
        title: "",
        text: text.value.trim(),
        stars,
        approved: false,
        source: "kunde",
        createdBy: uid,
        authorName: "Kunde",
        createdAt: serverTimestamp(),
      });
      for (let index = 0; index < chosen.length; index++) await uploadPhoto(refItem.id, chosen[index], index);
      form.reset();
      stars = 0;
      [...starRow.children].forEach((node) => node.setAttribute("aria-pressed", "false"));
      notice = "Takk. Vurderingen vises offentlig først når Einar har godkjent den.";
      document.activeElement?.blur?.();
      render();
    } catch (error) {
      console.error(error);
      status.textContent = "Vurderingen ble ikke sendt. Prøv igjen.";
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}

async function uploadPhoto(itemId, file, index) {
  if (previewMode) return;
  const blob = await compressImage(file);
  const filename = `kunde-${Date.now()}-${index}.jpg`;
  const storagePath = `projects/${projectId}/media/${filename}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);
  await addDoc(collection(db, "projects", projectId, "items", itemId, "photos"), {
    url,
    storagePath,
    caption: "",
    approved: false,
    source: "kunde",
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
}

function mic(textarea) {
  if (!canSpeak()) return null;
  const button = el("button", { type: "button", class: "btn btn-ghost" }, "Tale");
  button.addEventListener("click", async () => {
    try {
      await dictate((spoken) => {
        const base = textarea.value || "";
        const spacer = base && !/\s$/.test(base) ? " " : "";
        textarea.value = `${base}${spacer}${spoken}`;
      });
    } catch (error) {
      console.error(error);
      alert("Tale til tekst virket ikke. Sjekk mikrofontillatelse.");
    }
  });
  return button;
}

function approvalNote(item) {
  if (!item.approvalRequested) return null;
  if (item.approvalStatus !== "godkjent" && item.approvalStatus !== "avslatt") return null;
  return el("p", { class: "notice" }, approvalLine(item));
}

function decisionButtons(item) {
  return el("div", { class: "k-actions" }, [
    el("button", {
      type: "button",
      class: "btn btn-primary",
      onclick: () => decide(item, "godkjent"),
    }, item.kind === "tilbud" ? "Godkjenn tilbudet" : "Godkjenn endringen"),
    el("button", {
      type: "button",
      class: "btn btn-ghost",
      onclick: () => decide(item, "avslatt"),
    }, "Avslå"),
  ]);
}

function offerCard(item) {
  const status = offerStatus(item);
  const alternatives = item.alternatives || [];
  const chosen = chosenAlternative(item);
  let selected = "";
  const body = [
    el("h3", {}, item.title || offerTypeLabel(item.kind)),
    el("p", { class: "muted" }, `${offerTypeLabel(item.kind)} · ${offerStatusLabel(status)}`),
    item.text ? el("p", { class: "pre" }, item.text) : null,
  ];
  if (status === "sendt" && alternatives.length) {
    const choices = el("div", { class: "choices" });
    selected = previewChoices[item.id] || "";
    for (const alternative of alternatives) {
      const input = el("input", { type: "radio", name: `alt-${item.id}`, value: alternative.id });
      if (selected === alternative.id) input.checked = true;
      input.addEventListener("change", () => {
        selected = alternative.id;
        previewChoices[item.id] = alternative.id;
        paintCost();
      });
      choices.append(el("label", { class: "choice" }, [
        input,
        el("span", {}, [
          el("strong", {}, alternativeHeading(alternative)),
          alternative.description ? el("span", { class: "muted" }, alternative.description) : null,
          el("span", {}, alternativePriceText(alternative)),
        ]),
      ]));
    }
    body.push(choices, el("div", { class: "k-actions" }, [
      el("button", {
        type: "button",
        class: "btn btn-primary",
        onclick: () => {
          const error = customerDecisionError(item, "godkjent", selected);
          if (error) {
            alert(error);
            return;
          }
          decide(item, "godkjent", selected);
        },
      }, "Godkjenn valgt løsning"),
      el("button", {
        type: "button",
        class: "btn btn-ghost",
        onclick: () => decide(item, "avslatt"),
      }, "Avslå"),
    ]));
  } else if (status === "sendt") {
    body.push(decisionButtons(item));
  } else if (chosen) {
    body.push(el("p", {}, `Valgt løsning: ${alternativeHeading(chosen)}. ${alternativePriceText(chosen)}`));
    body.push(approvalNote(item));
  } else {
    body.push(approvalNote(item));
  }
  const card = el("article", { class: "k-card", id: `item-${item.id}` }, body);
  card.append(el("div", { class: "k-stack", id: `media-${item.id}` }), el("div", { id: `comments-${item.id}` }));
  return card;
}

async function decide(item, status, alternativeId = "") {
  if (previewMode) return;
  const name = String(project?.customerName || "Kunde").trim().slice(0, 79) || "Kunde";
  const error = customerDecisionError(item, status, alternativeId);
  if (error) {
    alert(error);
    return;
  }
  try {
    await updateDoc(doc(db, "projects", projectId, "items", item.id), {
      ...customerDecisionPatch(item, status, alternativeId),
      approvedAt: serverTimestamp(),
      approvedBy: uid,
      approvedByName: name,
    });
    notice = status === "godkjent" ? "Takk. Godkjenningen er lagret." : "Svaret er lagret.";
    document.activeElement?.blur?.();
    render();
  } catch (error) {
    console.error(error);
    alert("Kunne ikke lagre svaret. Prøv igjen.");
  }
}

function mergedDocs() {
  const map = new Map();
  for (const item of approvedDocs) map.set(item.id, item);
  for (const item of ownDocs) map.set(item.id, item);
  return [...map.values()]
    .filter((item) => customerVisibleDocument(item))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

function messageSection() {
  const list = el("div", { class: "thread" });
  if (!thread.length) list.append(el("p", { class: "muted" }, "Ingen meldinger ennå."));
  for (const message of thread) {
    const mine = message.sender === "customer";
    const src = displayUrl(message.imageUrl);
    list.append(el("article", { class: `bubble ${mine ? "bubble-customer" : "bubble-admin"}` }, [
      src ? el("img", { src, alt: "Bilde i meldingen" }) : null,
      message.text ? el("p", { class: "pre" }, message.text) : null,
      el("p", { class: "muted" }, `${mine ? "Deg" : "Einar A Børsheim"} · ${formatWhen(message.createdAt)}`),
    ]));
  }
  const input = el("textarea", { rows: "3", maxlength: "4000", placeholder: "Skriv til Einar" });
  const file = el("input", { type: "file", accept: "image/*" });
  const status = el("p", { class: "muted", hidden: true });
  const form = el("form", { class: "k-stack" }, [
    input,
    mic(input),
    field("Bilde, hvis du vil", file),
    el("button", { type: "submit", class: "btn btn-primary" }, "Send melding"),
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (previewMode) return;
    const text = input.value.trim();
    const chosen = file.files?.[0];
    if (!text && !chosen) return;
    form.querySelector("button").disabled = true;
    status.hidden = false;
    status.textContent = "Sender…";
    try {
      const payload = { text, sender: "customer", createdAt: serverTimestamp() };
      if (chosen) {
        const blob = await compressImage(chosen);
        const imagePath = `projects/${projectId}/media/melding-${Date.now()}.jpg`;
        const storageRef = ref(storage, imagePath);
        await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
        payload.imageUrl = await getDownloadURL(storageRef);
        payload.imagePath = imagePath;
      }
      await addDoc(collection(db, "projects", projectId, "messages"), payload);
      input.value = "";
      file.value = "";
      input.blur();
      status.textContent = "Sendt.";
    } catch (error) {
      console.error(error);
      status.textContent = "Meldingen ble ikke sendt.";
    } finally {
      form.querySelector("button").disabled = false;
    }
  });
  return el("section", { class: "k-card k-stack" }, [
    el("h2", {}, "Meldinger"),
    el("p", { class: "muted" }, "Skriv direkte til Einar. Svar vises her."),
    list,
    form,
  ]);
}

function documentSection() {
  const docs = mergedDocs();
  const list = el("div", { class: "k-stack" });
  if (!docs.length) list.append(el("p", { class: "muted" }, "Ingen dokumenter ennå."));
  for (const item of docs) {
    const href = displayUrl(item.url);
    list.append(el("article", {}, [
      href ? el("a", { href, target: "_blank", rel: "noopener" }, item.name || "Dokument") : el("p", {}, item.name || "Dokument"),
      el("p", { class: "muted" }, [
        item.source === "customer" ? "Deg" : "Einar A Børsheim",
        formatWhen(item.createdAt),
        item.approved === false ? "Venter på godkjenning" : "",
      ].filter(Boolean).join(" · ")),
    ]));
  }
  const file = el("input", { type: "file", multiple: true });
  const status = el("p", { class: "muted", hidden: true });
  const form = el("form", { class: "k-stack" }, [
    field("Last opp tegning, tilbud eller annet", file),
    el("button", { type: "submit", class: "btn btn-ghost" }, "Send dokument"),
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (previewMode) return;
    const files = [...(file.files || [])];
    if (!files.length) return;
    form.querySelector("button").disabled = true;
    status.hidden = false;
    try {
      for (let index = 0; index < files.length; index += 1) {
        status.textContent = `Laster opp ${index + 1} av ${files.length}…`;
        const current = files[index];
        const safeName = String(current.name || "dokument").replace(/[\\/]/g, "-");
        const storagePath = `projects/${projectId}/documents/${Date.now()}-${index}-${safeName}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, current, { contentType: current.type || "application/octet-stream" });
        const url = await getDownloadURL(storageRef);
        await addDoc(collection(db, "projects", projectId, "documents"), {
          name: current.name || "Dokument",
          url,
          storagePath,
          approved: false,
          source: "customer",
          uploadedBy: uid,
          createdAt: serverTimestamp(),
        });
      }
      file.value = "";
      status.textContent = "Sendt. Einar godkjenner før det vises som klart.";
    } catch (error) {
      console.error(error);
      status.textContent = "Dokumentet ble ikke sendt.";
    } finally {
      form.querySelector("button").disabled = false;
    }
  });
  return el("section", { class: "k-card k-stack" }, [
    el("h2", {}, "Dokumenter"),
    el("p", { class: "muted" }, "Tegninger, oppdateringer og tilbud. Det du laster opp venter til Einar har sett det."),
    list,
    form,
  ]);
}

function watchGps() {
  if (!showGpsInReport(project)) {
    stopGps?.();
    stopGps = null;
    if (gpsById.size) gpsById = new Map();
    return;
  }
  if (stopGps) return;
  stopGps = onSnapshot(collection(db, "projects", projectId, "photoGps"), (snap) => {
    gpsById = new Map(snap.docs.map((entry) => [entry.id, entry.data()]));
    paintPortalPhotos();
  }, (error) => console.error(error));
}

async function openPortalAccess(userId) {
  const accessRef = doc(db, "projects", projectId, "access", userId);
  const accessSnap = await getDoc(accessRef);
  if (portalAccessStep({ accessExists: accessSnap.exists(), token }) !== "create") return;
  try {
    await setDoc(accessRef, { token });
  } catch (error) {
    const again = await getDoc(accessRef);
    if (!again.exists()) throw error;
  }
}

function startPortal() {
  try {
    watchCost();
    watchPayments();
    watchGps();
    render();
    const items = collection(db, "projects", projectId, "items");
    onSnapshot(query(items, where("approved", "==", true)), (snap) => {
      approvedItems = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
    onSnapshot(query(items, where("createdBy", "==", uid)), (snap) => {
      ownItems = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
    onSnapshot(doc(db, "projects", projectId), (snap) => {
      if (!snap.exists()) return;
      project = { id: snap.id, ...snap.data() };
      watchCost();
      watchGps();
      render();
    });
    watchCost();
    onSnapshot(query(collection(db, "projects", projectId, "photos"), where("approved", "==", true)), (snap) => {
      legacyPhotos = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
    onSnapshot(query(collection(db, "projects", projectId, "documents"), where("approved", "==", true)), (snap) => {
      approvedDocs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
    onSnapshot(query(collection(db, "projects", projectId, "documents"), where("source", "==", "customer")), (snap) => {
      ownDocs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
    onSnapshot(query(
      collection(db, "projects", projectId, "hmsDocs"),
      where("visibleToCustomer", "==", true),
      where("trashed", "==", false),
    ), (snap) => {
      hmsDocs = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    }, (error) => console.error(error));
    onSnapshot(query(collection(db, "projects", projectId, "requests"), where("createdBy", "==", uid)), (snap) => {
      requests = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      requests.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      if (document.getElementById("request-slot")) paintRequests();
    }, (error) => console.error(error));
    onSnapshot(query(collection(db, "projects", projectId, "messages"), orderBy("createdAt", "asc")), (snap) => {
      thread = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      render();
    });
  } catch (error) {
    console.error(error);
  }
}

async function init() {
  if (!projectId || !token || portalAccessStep({ token }) === "missing") {
    show(viewError);
    return;
  }
  try {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    await openPortalAccess(uid);
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) {
      show(viewError);
      return;
    }
    project = { id: snap.id, ...snap.data() };
    document.title = `${project.name || "Prosjekt"} | Einar A Børsheim`;
    show(viewProject);
  } catch (error) {
    console.error(error);
    show(viewError);
    return;
  }
  startPortal();
}

init();
