import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const COMPANY = {
  name: "Einar A Børsheim",
  tagline: "Entreprenør",
  address: "Eriksvei 13, 1386 Asker",
  phone: "905 52 065",
  email: "e.bors@hotmail.com",
  orgNr: "962 091 504",
};

const CUSTOMER_PORTAL_URL = "https://einar-borsheim.com/kunde/";
const PENDING_QUEUE_KEY = "pendingPhotoUploads";

const Camera = window.Capacitor?.Plugins?.Camera;
const Share = window.Capacitor?.Plugins?.Share;
const Network = window.Capacitor?.Plugins?.Network;
const Filesystem = window.Capacitor?.Plugins?.Filesystem;

// --- DOM ---
const viewLogin = document.getElementById("view-login");
const viewProjects = document.getElementById("view-projects");
const viewProject = document.getElementById("view-project");
const viewTrash = document.getElementById("view-trash");
const userEmailEl = document.getElementById("user-email");
const logoutLink = document.getElementById("logout-link");

const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

const newProjectBtn = document.getElementById("new-project-btn");
const newProjectForm = document.getElementById("new-project-form");
const projectNameInput = document.getElementById("project-name");
const projectDescInput = document.getElementById("project-desc");
const saveProjectBtn = document.getElementById("save-project-btn");
const cancelProjectBtn = document.getElementById("cancel-project-btn");
const projectListEl = document.getElementById("project-list");
const projectsEmptyEl = document.getElementById("projects-empty");
const openTrashBtn = document.getElementById("open-trash-btn");
const backFromTrashBtn = document.getElementById("back-from-trash");
const trashListEl = document.getElementById("trash-list");
const trashEmptyEl = document.getElementById("trash-empty");

const backToProjectsBtn = document.getElementById("back-to-projects");
const projectTitleEl = document.getElementById("project-title");
const projectDescViewEl = document.getElementById("project-desc-view");
const projectStatusBadge = document.getElementById("project-status-badge");
const toggleDoneBtn = document.getElementById("toggle-done-btn");
const customerNameInput = document.getElementById("customer-name");
const customerLinkInput = document.getElementById("customer-link");
const copyLinkBtn = document.getElementById("copy-link-btn");
const shareBtn = document.getElementById("share-btn");
const exportPdfBtn = document.getElementById("export-pdf-btn");
const deleteProjectBtn = document.getElementById("delete-project-btn");
const reportTextEl = document.getElementById("report-text");
const cameraBtn = document.getElementById("camera-btn");
const galleryBtn = document.getElementById("gallery-btn");
const uploadStatusEl = document.getElementById("upload-status");
const offlineStatusEl = document.getElementById("offline-status");
const pendingSectionEl = document.getElementById("pending-section");
const pendingGridEl = document.getElementById("pending-grid");
const photoGridEl = document.getElementById("photo-grid");
const photosEmptyEl = document.getElementById("photos-empty");
const messageListEl = document.getElementById("message-list");
const messageInputEl = document.getElementById("message-input");
const sendMessageBtn = document.getElementById("send-message-btn");

let unsubscribeProjects = null;
let unsubscribePhotos = null;
let unsubscribeMessages = null;
let currentProject = null; // { id, name, description, shareToken }
let currentPhotos = [];
let reportSaveTimeout;

function showView(view) {
  [viewLogin, viewProjects, viewProject, viewTrash].forEach((v) => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

function randomToken(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// --- Auth ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    userEmailEl.textContent = user.email || "";
    logoutLink.classList.remove("hidden");
    showView(viewProjects);
    listenToProjects();
    retryPendingUploads();
  } else {
    userEmailEl.textContent = "";
    logoutLink.classList.add("hidden");
    if (unsubscribeProjects) unsubscribeProjects();
    if (unsubscribePhotos) unsubscribePhotos();
    showView(viewLogin);
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (err) {
    console.error("Innlogging feilet:", err.code, err.message);
    loginError.textContent = `Kunne ikke logge inn (${err.code || "ukjent feil"}).`;
    loginError.classList.remove("hidden");
  }
});

logoutLink.addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
});

// --- Prosjekter ---
let allProjects = [];
const TRASH_RETENTION_DAYS = 90;

function listenToProjects() {
  const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));
  unsubscribeProjects = onSnapshot(
    q,
    (snapshot) => {
      allProjects = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderProjectList();
      renderTrashList();
      purgeOldTrash();
    },
    (err) => {
      console.error("Kunne ikke hente prosjekter:", err.code, err.message);
      alert(`Kunne ikke hente prosjekter (${err.code || err.message}).`);
    }
  );
}

function renderProjectList() {
  const active = allProjects.filter((p) => !p.trashed);
  projectListEl.innerHTML = "";
  projectsEmptyEl.classList.toggle("hidden", active.length > 0);
  active.forEach((data) => {
    const li = document.createElement("li");
    li.className = data.status === "done" ? "done-project" : "";
    li.innerHTML = `
      <span class="project-name"></span>
      <span class="project-desc"></span>
    `;
    li.querySelector(".project-name").textContent = (data.status === "done" ? "✅ " : "") + data.name;
    li.querySelector(".project-desc").textContent = data.description || "";
    li.addEventListener("click", () => openProject(data.id, data));
    projectListEl.appendChild(li);
  });
}

function daysSince(timestamp) {
  if (!timestamp?.toDate) return 0;
  return Math.floor((Date.now() - timestamp.toDate().getTime()) / (1000 * 60 * 60 * 24));
}

function renderTrashList() {
  const trashed = allProjects.filter((p) => p.trashed);
  trashListEl.innerHTML = "";
  trashEmptyEl.classList.toggle("hidden", trashed.length > 0);
  trashed.forEach((data) => {
    const daysLeft = Math.max(0, TRASH_RETENTION_DAYS - daysSince(data.trashedAt));
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="project-name"></span>
      <span class="project-desc trash-days"></span>
      <div class="btn-row">
        <button class="btn btn-ghost restore-btn">↩️ Gjenopprett</button>
        <button class="btn btn-ghost delete-project-btn purge-btn">Slett permanent</button>
      </div>
    `;
    li.querySelector(".project-name").textContent = data.name;
    li.querySelector(".trash-days").textContent = `Slettes permanent om ${daysLeft} dager`;
    li.querySelector(".restore-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      updateDoc(doc(db, "projects", data.id), { trashed: false, trashedAt: null });
    });
    li.querySelector(".purge-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Slette "${data.name}" permanent med en gang? Dette kan ikke angres.`)) return;
      await permanentlyDeleteProject(data.id);
    });
    trashListEl.appendChild(li);
  });
}

async function purgeOldTrash() {
  const toPurge = allProjects.filter((p) => p.trashed && daysSince(p.trashedAt) >= TRASH_RETENTION_DAYS);
  for (const p of toPurge) {
    await permanentlyDeleteProject(p.id).catch((err) => console.error("Auto-sletting feilet", err));
  }
}

async function permanentlyDeleteProject(projectId) {
  const photosSnap = await getDocs(collection(db, "projects", projectId, "photos"));
  for (const photoDoc of photosSnap.docs) {
    const data = photoDoc.data();
    if (data.storagePath) {
      await deleteObject(ref(storage, data.storagePath)).catch(() => {});
    }
    await deleteDoc(photoDoc.ref);
  }
  const messagesSnap = await getDocs(collection(db, "projects", projectId, "messages"));
  for (const msgDoc of messagesSnap.docs) {
    await deleteDoc(msgDoc.ref);
  }
  const accessSnap = await getDocs(collection(db, "projects", projectId, "access"));
  for (const accessDoc of accessSnap.docs) {
    await deleteDoc(accessDoc.ref);
  }
  await deleteDoc(doc(db, "projects", projectId));
}

openTrashBtn.addEventListener("click", () => {
  showView(viewTrash);
});

backFromTrashBtn.addEventListener("click", () => {
  showView(viewProjects);
});

newProjectBtn.addEventListener("click", () => {
  newProjectForm.classList.toggle("hidden");
});

cancelProjectBtn.addEventListener("click", () => {
  projectNameInput.value = "";
  projectDescInput.value = "";
  newProjectForm.classList.add("hidden");
});

saveProjectBtn.addEventListener("click", async () => {
  const name = projectNameInput.value.trim();
  if (!name) return;
  try {
    await addDoc(collection(db, "projects"), {
      name,
      description: projectDescInput.value.trim(),
      reportText: "",
      customerName: "",
      status: "active",
      trashed: false,
      shareToken: randomToken(),
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser?.email || "ukjent",
    });
    projectNameInput.value = "";
    projectDescInput.value = "";
    newProjectForm.classList.add("hidden");
  } catch (err) {
    console.error("Kunne ikke opprette prosjekt:", err.code, err.message);
    alert(`Kunne ikke opprette prosjekt (${err.code || err.message}).`);
  }
});

// --- Prosjektdetalj ---
function openProject(id, data) {
  currentProject = {
    id,
    name: data.name,
    description: data.description || "",
    shareToken: data.shareToken || "",
    status: data.status || "active",
  };
  projectTitleEl.textContent = currentProject.name;
  projectDescViewEl.textContent = currentProject.description;
  reportTextEl.value = data.reportText || "";
  customerNameInput.value = data.customerName || "";
  customerLinkInput.value = `${CUSTOMER_PORTAL_URL}?p=${id}&t=${currentProject.shareToken}`;
  updateDoneUi();
  showView(viewProject);
  listenToPhotos(id);
  listenToMessages(id);
  renderPendingQueue();
}

function updateDoneUi() {
  const isDone = currentProject?.status === "done";
  projectStatusBadge.classList.toggle("hidden", !isDone);
  toggleDoneBtn.textContent = isDone ? "↩️ Merk som aktiv" : "✅ Merk som ferdig";
}

toggleDoneBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const newStatus = currentProject.status === "done" ? "active" : "done";
  currentProject.status = newStatus;
  updateDoneUi();
  await updateDoc(doc(db, "projects", currentProject.id), { status: newStatus }).catch((err) =>
    console.error("Kunne ikke oppdatere status", err)
  );
});

let customerNameSaveTimeout;
customerNameInput.addEventListener("input", () => {
  clearTimeout(customerNameSaveTimeout);
  customerNameSaveTimeout = setTimeout(() => {
    if (!currentProject) return;
    updateDoc(doc(db, "projects", currentProject.id), { customerName: customerNameInput.value.trim() }).catch(
      (err) => console.error("Kunne ikke lagre kundenavn", err)
    );
  }, 600);
});

copyLinkBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(customerLinkInput.value);
    copyLinkBtn.textContent = "Kopiert!";
    setTimeout(() => (copyLinkBtn.textContent = "Kopier"), 1500);
  } catch {
    alert(customerLinkInput.value);
  }
});

backToProjectsBtn.addEventListener("click", () => {
  if (unsubscribePhotos) unsubscribePhotos();
  if (unsubscribeMessages) unsubscribeMessages();
  currentProject = null;
  showView(viewProjects);
});

function listenToMessages(projectId) {
  if (unsubscribeMessages) unsubscribeMessages();
  const q = query(collection(db, "projects", projectId, "messages"), orderBy("createdAt", "asc"));
  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    messageListEl.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const bubble = document.createElement("div");
      bubble.className = `message-bubble ${data.sender === "admin" ? "from-admin" : "from-customer"}`;
      const time = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString("no-NO") : "";
      bubble.innerHTML = `<span></span><span class="message-meta">${data.sender === "admin" ? "Deg" : "Kunde"} · ${time}</span>`;
      bubble.querySelector("span").textContent = data.text;
      messageListEl.appendChild(bubble);
    });
    messageListEl.scrollTop = messageListEl.scrollHeight;
  });
}

async function sendAdminMessage() {
  const text = messageInputEl.value.trim();
  if (!text || !currentProject) return;
  sendMessageBtn.disabled = true;
  try {
    await addDoc(collection(db, "projects", currentProject.id, "messages"), {
      text,
      sender: "admin",
      createdAt: serverTimestamp(),
    });
    messageInputEl.value = "";
  } catch (err) {
    console.error("Kunne ikke sende melding", err.code, err.message);
    alert(`Kunne ikke sende melding (${err.code || err.message}).`);
  } finally {
    sendMessageBtn.disabled = false;
  }
}

sendMessageBtn.addEventListener("click", sendAdminMessage);
messageInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAdminMessage();
  }
});

reportTextEl.addEventListener("input", () => {
  clearTimeout(reportSaveTimeout);
  reportSaveTimeout = setTimeout(() => {
    if (!currentProject) return;
    updateDoc(doc(db, "projects", currentProject.id), { reportText: reportTextEl.value }).catch((err) =>
      console.error("Kunne ikke lagre rapporttekst", err)
    );
  }, 700);
});

shareBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const url = `${CUSTOMER_PORTAL_URL}?p=${currentProject.id}&t=${currentProject.shareToken}`;
  const text = `Her kan du se og legge til bilder for prosjektet "${currentProject.name}": ${url}`;
  if (Share) {
    try {
      await Share.share({ title: "Del prosjekt med kunde", text, url });
      return;
    } catch (err) {
      // bruker avbrøt deling - ikke en feil
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert("Lenke kopiert til utklippstavlen:\n" + url);
  } catch {
    alert(url);
  }
});

deleteProjectBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  const sure = confirm(
    `Flytte "${currentProject.name}" til papirkurven? Den slettes permanent automatisk etter 3 måneder, eller du kan gjenopprette den når som helst før det.`
  );
  if (!sure) return;
  deleteProjectBtn.disabled = true;
  try {
    await updateDoc(doc(db, "projects", currentProject.id), {
      trashed: true,
      trashedAt: serverTimestamp(),
    });
    if (unsubscribePhotos) unsubscribePhotos();
    if (unsubscribeMessages) unsubscribeMessages();
    currentProject = null;
    showView(viewProjects);
  } catch (err) {
    console.error("Kunne ikke flytte prosjekt til papirkurv", err.code, err.message);
    alert(`Kunne ikke flytte prosjekt til papirkurv (${err.code || err.message}).`);
  } finally {
    deleteProjectBtn.disabled = false;
  }
});

const photoCards = new Map(); // photoId -> { card, container }

function listenToPhotos(projectId) {
  if (unsubscribePhotos) unsubscribePhotos();
  photoCards.clear();
  const q = query(collection(db, "projects", projectId, "photos"), orderBy("createdAt", "desc"));
  unsubscribePhotos = onSnapshot(q, (snapshot) => {
    currentPhotos = [];
    const approved = [];
    const pending = [];
    snapshot.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      currentPhotos.push(data);
      if (data.approved === false) pending.push(data);
      else approved.push(data);
    });

    photosEmptyEl.classList.toggle("hidden", approved.length > 0);
    pendingSectionEl.classList.toggle("hidden", pending.length === 0);

    const seenIds = new Set();
    updatePhotoGrid(photoGridEl, approved, false, seenIds);
    updatePhotoGrid(pendingGridEl, pending, true, seenIds);

    // Fjern kort for bilder som ikke lenger finnes (slettet)
    for (const [id, entry] of photoCards) {
      if (!seenIds.has(id)) {
        entry.card.remove();
        photoCards.delete(id);
      }
    }
  });
}

// Oppdaterer rutenettet uten å ødelegge fokus i et tekstfelt brukeren skriver i akkurat nå
function updatePhotoGrid(container, items, isPending, seenIds) {
  let previousEl = null;
  items.forEach((data) => {
    seenIds.add(data.id);
    const existing = photoCards.get(data.id);
    const captionHasFocus = existing && existing.card.querySelector(".photo-caption") === document.activeElement;

    if (!existing) {
      const card = renderPhotoCard(container, data, isPending);
      photoCards.set(data.id, { card, container });
    } else {
      // Flytt kortet til riktig container hvis det byttet status (kunde->godkjent)
      if (existing.container !== container) {
        container.appendChild(existing.card);
        existing.container = container;
      }
      if (!captionHasFocus) {
        const captionEl = existing.card.querySelector(".photo-caption");
        if (captionEl.value !== (data.caption || "")) captionEl.value = data.caption || "";
      }
    }
    // Sørg for riktig rekkefølge uten å flytte kortet brukeren skriver i
    const entry = photoCards.get(data.id);
    if (!captionHasFocus) {
      if (previousEl) previousEl.after(entry.card);
      else container.prepend(entry.card);
    }
    previousEl = entry.card;
  });
}


function renderPhotoCard(container, data, isPending) {
  const card = document.createElement("div");
  card.className = "photo-card" + (isPending ? " pending-card" : "");
  card.innerHTML = `
    <img src="${data.url}" alt="Bilde" loading="lazy" />
    <textarea class="photo-caption" rows="2" placeholder="Kommentar / avvik...">${data.caption || ""}</textarea>
    <div class="photo-actions">
      <span class="photo-date"></span>
      ${isPending ? '<button class="approve-photo">Godkjenn</button>' : ""}
      <button class="delete-photo">${isPending ? "Avvis" : "Slett"}</button>
    </div>
  `;
  const imgEl = card.querySelector("img");
  let imgAttempts = 0;
  imgEl.addEventListener("error", () => {
    if (imgAttempts >= 3) return;
    imgAttempts++;
    setTimeout(() => {
      imgEl.src = `${data.url}${data.url.includes("?") ? "&" : "?"}retry=${imgAttempts}`;
    }, 1000 * imgAttempts);
  });
  const dateEl = card.querySelector(".photo-date");
  if (data.createdAt?.toDate) {
    dateEl.textContent = data.createdAt.toDate().toLocaleDateString("no-NO");
  }

  const captionEl = card.querySelector(".photo-caption");
  let saveTimeout;
  captionEl.addEventListener("input", () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      updateDoc(doc(db, "projects", currentProject.id, "photos", data.id), {
        caption: captionEl.value,
      });
    }, 600);
  });

  const approveBtn = card.querySelector(".approve-photo");
  if (approveBtn) {
    approveBtn.addEventListener("click", () => {
      updateDoc(doc(db, "projects", currentProject.id, "photos", data.id), { approved: true });
    });
  }

  card.querySelector(".delete-photo").addEventListener("click", async () => {
    if (!confirm(isPending ? "Avvise dette bildet?" : "Slette dette bildet?")) return;
    try {
      if (data.storagePath) {
        await deleteObject(ref(storage, data.storagePath));
      }
    } catch (err) {
      // fortsett å slette Firestore-posten selv om filen mangler i storage
    }
    await deleteDoc(doc(db, "projects", currentProject.id, "photos", data.id));
  });

  return card;
}

// --- Offline-kø (lagres lokalt til nettforbindelse er tilbake) ---
function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function setQueue(queue) {
  localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(queue));
}

function renderPendingQueue() {
  const queue = getQueue().filter((item) => item.projectId === currentProject?.id);
  const existingLocal = photoGridEl.querySelectorAll(".local-pending-card");
  existingLocal.forEach((el) => el.remove());
  queue.forEach((item) => {
    const card = document.createElement("div");
    card.className = "photo-card local-pending-card";
    card.innerHTML = `
      <img src="${item.dataUrl}" alt="Venter opplasting" />
      <div class="photo-actions">
        <span class="badge-local">📴 Venter på opplasting...</span>
      </div>
    `;
    photoGridEl.prepend(card);
  });
}

async function retryPendingUploads() {
  const queue = getQueue();
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    try {
      await uploadQueuedItem(item);
    } catch (err) {
      remaining.push(item);
    }
  }
  setQueue(remaining);
  if (currentProject) renderPendingQueue();
}

async function uploadQueuedItem(item) {
  const blob = await (await fetch(item.dataUrl)).blob();
  const storagePath = `projects/${item.projectId}/${item.filename}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytesResumable(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);
  await addDoc(collection(db, "projects", item.projectId, "photos"), {
    url,
    storagePath,
    caption: "",
    approved: true,
    source: "admin",
    createdAt: serverTimestamp(),
    uploadedBy: auth.currentUser?.email || "ukjent",
  });
}

if (Network) {
  Network.addListener("networkStatusChange", (status) => {
    offlineStatusEl.classList.toggle("hidden", status.connected);
    if (status.connected) retryPendingUploads();
  });
  Network.getStatus().then((status) => offlineStatusEl.classList.toggle("hidden", status.connected));
}

// --- Opplasting av bilder (native kamera/galleri via Capacitor) ---
async function handlePhotoBlobs(blobs) {
  if (!blobs.length || !currentProject) return;
  uploadStatusEl.classList.remove("hidden");
  for (let i = 0; i < blobs.length; i++) {
    uploadStatusEl.textContent = `Behandler bilde ${i + 1} av ${blobs.length}...`;
    try {
      const compressed = await compressImage(blobs[i]);
      const dataUrl = await blobToDataUrl(compressed);
      const filename = `${Date.now()}-${i}.jpg`;
      const queueItem = { projectId: currentProject.id, filename, dataUrl, createdAt: Date.now() };

      // Lagre lokalt først (synlig med en gang, overlever at nett mangler)
      const queue = getQueue();
      queue.push(queueItem);
      setQueue(queue);
      renderPendingQueue();

      // Prøv å laste opp med en gang
      await uploadQueuedItem(queueItem);
      setQueue(getQueue().filter((q) => q.filename !== filename || q.projectId !== queueItem.projectId));
      renderPendingQueue();
    } catch (err) {
      console.error("Opplasting feilet, blir i lokal kø", err.code, err.message);
    }
  }
  uploadStatusEl.classList.add("hidden");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function uriToBlob(path) {
  const response = await fetch(path);
  return response.blob();
}

cameraBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  if (!Camera) {
    alert("Kamera er kun tilgjengelig i den installerte appen, ikke i nettleseren.");
    return;
  }
  try {
    const photo = await Camera.getPhoto({
      quality: 85,
      resultType: "uri",
      source: "CAMERA",
      saveToGallery: true, // bildet havner også i telefonens vanlige galleri
    });
    const blob = await uriToBlob(photo.webPath);
    await handlePhotoBlobs([blob]);
  } catch (err) {
    if (err?.message?.toLowerCase().includes("cancel")) return;
    console.error("Kamera feilet", err);
    alert("Kunne ikke åpne kamera.");
  }
});

galleryBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  if (!Camera) {
    alert("Bildevelger er kun tilgjengelig i den installerte appen, ikke i nettleseren.");
    return;
  }
  try {
    const result = await Camera.pickImages({ quality: 85 });
    const blobs = await Promise.all(result.photos.map((p) => uriToBlob(p.webPath)));
    await handlePhotoBlobs(blobs);
  } catch (err) {
    if (err?.message?.toLowerCase().includes("cancel")) return;
    console.error("Bildevelger feilet", err);
    alert("Kunne ikke åpne bildevelger.");
  }
});

// Skalerer ned og komprimerer bildet før opplasting for å spare data/lagring
async function compressImage(blob, maxDimension = 1600, quality = 0.75) {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  if (width > height && width > maxDimension) {
    height = Math.round((height * maxDimension) / width);
    width = maxDimension;
  } else if (height > maxDimension) {
    width = Math.round((width * maxDimension) / height);
    height = maxDimension;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

// --- PDF-rapport ---
exportPdfBtn.addEventListener("click", async () => {
  if (!currentProject) return;
  exportPdfBtn.disabled = true;
  exportPdfBtn.textContent = "Genererer PDF...";
  try {
    const approvedPhotos = currentPhotos.filter((p) => p.approved !== false);
    await generatePdfReport(currentProject, reportTextEl.value, approvedPhotos);
  } catch (err) {
    console.error("PDF-generering feilet", err);
    alert("Klarte ikke å lage PDF-rapport. Prøv igjen.");
  } finally {
    exportPdfBtn.disabled = false;
    exportPdfBtn.textContent = "Lag PDF-rapport";
  }
});

async function urlToDataUrl(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Prøver å laste ned bildet to ganger før det gis opp (forbigående nettverksglipp)
async function fetchWithRetry(url) {
  try {
    return await urlToDataUrl(url);
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return await urlToDataUrl(url);
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function generatePdfReport(project, reportText, photos) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const accent = [0, 105, 92];

  pdf.setFillColor(...accent);
  pdf.rect(0, 0, pageWidth, 28, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(COMPANY.name, margin, 12);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(COMPANY.tagline, margin, 19);

  pdf.setTextColor(20, 20, 20);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(24);
  pdf.text("Internkontroll-rapport", margin, 50);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(16);
  pdf.text(project.name, margin, 62);
  let cursorY = 70;
  pdf.setFontSize(11);
  if (project.description) {
    pdf.text(project.description, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
    cursorY += 10;
  }
  if (reportText && reportText.trim()) {
    pdf.text(reportText.trim(), margin, cursorY, { maxWidth: pageWidth - margin * 2 });
  }

  pdf.setDrawColor(...accent);
  pdf.setLineWidth(0.5);
  pdf.line(margin, 90, pageWidth - margin, 90);

  pdf.setFontSize(10);
  pdf.text(`Generert: ${new Date().toLocaleString("no-NO")}`, margin, 100);
  pdf.text(`Antall bilder: ${photos.length}`, margin, 106);

  pdf.setFontSize(9);
  pdf.setTextColor(100, 100, 100);
  [
    COMPANY.name,
    COMPANY.address,
    `Tlf: ${COMPANY.phone}  ·  E-post: ${COMPANY.email}`,
    `Org.nr: ${COMPANY.orgNr}`,
  ].forEach((line, i) => pdf.text(line, margin, pageHeight - 25 + i * 5));
  pdf.setTextColor(20, 20, 20);

  let pageNumber = 1;
  let skipped = 0;
  for (const photo of photos) {
    let dataUrl;
    try {
      dataUrl = await fetchWithRetry(photo.url);
    } catch (err) {
      console.error("Hopper over bilde i PDF (kunne ikke laste ned):", err);
      skipped++;
      continue;
    }
    pdf.addPage();
    pageNumber++;
    const dims = await getImageDimensions(dataUrl);
    const headerHeight = 12;

    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text(`${project.name} — ${COMPANY.name}`, margin, headerHeight);
    pdf.setTextColor(20, 20, 20);

    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2 - headerHeight - 15;
    let { width, height } = fitDimensions(dims.width, dims.height, maxWidth, maxHeight);
    const x = (pageWidth - width) / 2;
    const y = margin + headerHeight;
    pdf.addImage(dataUrl, "JPEG", x, y, width, height);
    if (photo.caption) {
      pdf.setFontSize(11);
      pdf.text(photo.caption, margin, y + height + 8, { maxWidth });
    }
    const date = photo.createdAt?.toDate ? photo.createdAt.toDate().toLocaleDateString("no-NO") : "";
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text(date, margin, pageHeight - 10);
    pdf.text(`Side ${pageNumber}`, pageWidth - margin - 15, pageHeight - 10);
    pdf.setTextColor(20, 20, 20);
  }

  if (skipped > 0) {
    alert(`${skipped} av ${photos.length} bilder kunne ikke lastes ned og ble utelatt fra PDF-en (nettverksproblem). Resten av rapporten ble generert.`);
  }

  const filename = `internkontroll-${project.name.replace(/\s+/g, "_")}.pdf`;

  if (Filesystem) {
    // Native app: skriv PDF-en til enheten og åpne del/lagre-menyen (nettleser-nedlasting fungerer ikke i WebView)
    const base64 = pdf.output("datauristring").split(",")[1];
    console.log(`PDF klar, ${base64.length} tegn base64. Skriver til fil...`);
    const writeResult = await withTimeout(
      Filesystem.writeFile({ path: filename, data: base64, directory: "CACHE" }),
      20000,
      "Tidsavbrudd ved skriving av PDF-fil"
    );
    console.log("PDF skrevet til:", writeResult.uri);
    if (Share) {
      console.log("Åpner delemeny...");
      await withTimeout(
        Share.share({ title: filename, url: writeResult.uri }),
        20000,
        "Tidsavbrudd ved åpning av delemeny"
      );
      console.log("Delemeny lukket.");
    } else {
      alert(`PDF lagret: ${writeResult.uri}`);
    }
  } else {
    // Nettleser (PC/test): vanlig nedlasting
    pdf.save(filename);
  }
}

function getImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.src = dataUrl;
  });
}

function fitDimensions(width, height, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * ratio, height: height * ratio };
}
