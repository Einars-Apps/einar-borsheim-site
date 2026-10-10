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
  query,
  where,
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
import { formatDay, formatWhen } from "../www/js/logic.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const viewLoading = document.getElementById("view-loading");
const viewError = document.getElementById("view-error");
const viewProject = document.getElementById("view-project");

const params = new URLSearchParams(window.location.search);
const projectId = params.get("p");
const token = params.get("t");

let uid = "";
let project = null;
let approvedItems = [];
let ownItems = [];

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
  return [...map.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

let renderAfterBlur = false;
let notice = "";

function render() {
  if (!project) return;
  const active = document.activeElement;
  const typing = active && viewProject.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (typing) {
    if (!renderAfterBlur) {
      renderAfterBlur = true;
      active.addEventListener("blur", () => {
        renderAfterBlur = false;
        render();
      }, { once: true });
    }
    return;
  }
  const items = mergedItems();
  const done = project.status === "fullfort" || !!project.completedAt;
  const pdfSlot = el("p", { class: "muted" }, "Sluttrapporten legges her når den er klar.");
  const pdfPath = `projects/${projectId}/rapport/sluttrapport.pdf`;
  viewProject.replaceChildren();
  viewProject.append(el("section", { class: "k-card k-stack" }, [
    el("p", { class: "muted" }, "Ditt prosjekt"),
    el("h1", {}, project.name || "Prosjekt"),
    project.description ? el("p", { class: "pre" }, project.description) : null,
    project.address ? el("p", { class: "muted" }, project.address) : null,
    done ? el("p", { class: "muted" }, `Ferdig ${formatDay(project.completedAt) || ""}`.trim()) : null,
    pdfSlot,
  ]));
  const knownPdf = displayUrl(project.pdfUrl);
  if (project.pdfPath === pdfPath) {
    getDownloadURL(ref(storage, pdfPath)).then((url) => {
      const href = displayUrl(url);
      if (!href || !pdfSlot.isConnected) return;
      pdfSlot.replaceWith(el("a", { class: "pdf-link", href, target: "_blank", rel: "noopener" }, "Last ned sluttrapport (PDF)"));
    }).catch(() => {});
  } else if (knownPdf) {
    pdfSlot.replaceWith(el("a", { class: "pdf-link", href: knownPdf, target: "_blank", rel: "noopener" }, "Last ned sluttrapport (PDF)"));
  }

  if (project.reportText && project.reportText.trim()) {
    viewProject.append(el("section", { class: "k-card" }, [
      el("h2", {}, "Arbeid utført"),
      el("p", { class: "pre" }, project.reportText.trim()),
    ]));
  }

  const groups = [
    ["bilde", "Bilder"],
    ["endring", "Endringer"],
    ["avvik", "Avvik"],
  ];
  for (const [kind, title] of groups) {
    const rows = items.filter((item) => item.kind === kind && item.approved === true);
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

  const rate = el("section", { class: "k-card k-stack" }, [el("h2", {}, "Vurdering")]);
  const ratings = items.filter((item) => item.kind === "vurdering" && item.createdBy === uid);
  if (!done) {
    rate.append(el("p", { class: "muted" }, "Du kan legge igjen stjerner og en kommentar når oppdraget er markert ferdig."));
  } else {
    for (const item of ratings) rate.append(itemCard(item, true));
    rate.append(ratingForm());
  }
  viewProject.append(rate);

  for (const item of items) hydrate(item);
}

function itemCard(item, showStatus = false) {
  const card = el("article", { class: "k-card", id: `item-${item.id}` }, [
    el("h3", {}, item.title || (item.kind === "vurdering" ? `${item.stars || "–"} av 5` : "Notat")),
    showStatus ? el("p", {}, item.approved ? el("span", { class: "pill pill-ok" }, "Godkjent") : el("span", { class: "pill" }, "Venter på godkjenning")) : null,
    item.kind === "vurdering" && item.title ? el("p", {}, `${item.stars || "–"} av 5`) : null,
    item.text ? el("p", { class: "pre" }, item.text) : null,
    el("p", { class: "muted" }, formatWhen(item.createdAt)),
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
    el("button", { type: "submit", class: "btn btn-ghost" }, "Send kommentar"),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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

async function hydrate(item) {
  const media = document.getElementById(`media-${item.id}`);
  const comments = document.getElementById(`comments-${item.id}`);
  if (!media || media.dataset.loaded) return;
  media.dataset.loaded = "1";
  try {
    const photos = await loadVisible(collection(db, "projects", projectId, "items", item.id, "photos"));
    if (photos.length) {
      const grid = el("div", { class: photos.length > 1 ? "k-grid" : "k-stack" });
      for (const photo of photos) {
        const src = displayUrl(photo.url);
        if (!src) continue;
        const fig = el("figure", {}, [
          el("img", { class: photos.length > 1 ? "" : "k-photo", src, alt: photo.caption || "Bilde", loading: "lazy" }),
          photo.caption ? el("figcaption", { class: "muted" }, photo.caption) : null,
        ]);
        grid.append(fig);
      }
      media.append(grid);
    }
    const thread = await loadVisible(collection(db, "projects", projectId, "items", item.id, "comments"));
    for (const comment of thread) {
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
  return [...map.values()];
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
    field("Bilder", files),
    submit,
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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
    field("Bilder av resultatet, hvis du vil", files),
    submit,
    status,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
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

async function init() {
  if (!projectId || !token) {
    show(viewError);
    return;
  }
  try {
    const cred = await signInAnonymously(auth);
    uid = cred.user.uid;
    await setDoc(doc(db, "projects", projectId, "access", uid), { token });
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) {
      show(viewError);
      return;
    }
    project = { id: snap.id, ...snap.data() };
    document.title = `${project.name || "Prosjekt"} | Einar A Børsheim`;
    show(viewProject);
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
      render();
    });
  } catch (error) {
    console.error(error);
    show(viewError);
  }
}

init();
