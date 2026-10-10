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

const backToProjectsBtn = document.getElementById("back-to-projects");
const projectTitleEl = document.getElementById("project-title");
const projectDescViewEl = document.getElementById("project-desc-view");
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

let unsubscribeProjects = null;
let unsubscribePhotos = null;
let currentProject = null; // { id, name, description, shareToken }
let currentPhotos = [];
let reportSaveTimeout;

function showView(view) {
  [viewLogin, viewProjects, viewProject].forEach((v) => v.classList.add("hidden"));
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
function listenToProjects() {
  const q = query(collection(db, "projects"), orderBy("createdAt", "desc"));
  unsubscribeProjects = onSnapshot(
    q,
    (snapshot) => {
      projectListEl.innerHTML = "";
      if (snapshot.empty) {
        projectsEmptyEl.classList.remove("hidden");
        return;
      }
      projectsEmptyEl.classList.add("hidden");
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const li = document.createElement("li");
        li.innerHTML = `
          <span class="project-name"></span>
          <span class="project-desc"></span>
        `;
        li.querySelector(".project-name").textContent = data.name;
        li.querySelector(".project-desc").textContent = data.description || "";
        li.addEventListener("click", () => openProject(docSnap.id, data));
        projectListEl.appendChild(li);
      });
    },
    (err) => {
      console.error("Kunne ikke hente prosjekter:", err.code, err.message);
      alert(`Kunne ikke hente prosjekter (${err.code || err.message}).`);
    }
  );
}

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
  };
  projectTitleEl.textContent = currentProject.name;
  projectDescViewEl.textContent = currentProject.description;
  reportTextEl.value = data.reportText || "";
  showView(viewProject);
  listenToPhotos(id);
  renderPendingQueue();
}

backToProjectsBtn.addEventListener("click", () => {
  if (unsubscribePhotos) unsubscribePhotos();
  currentProject = null;
  showView(viewProjects);
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
    `Slette prosjektet "${currentProject.name}" permanent, inkludert alle bilder? Dette kan ikke angres.`
  );
  if (!sure) return;
  deleteProjectBtn.disabled = true;
  deleteProjectBtn.textContent = "Sletter...";
  try {
    const photosSnap = await getDocs(collection(db, "projects", currentProject.id, "photos"));
    for (const photoDoc of photosSnap.docs) {
      const data = photoDoc.data();
      if (data.storagePath) {
        await deleteObject(ref(storage, data.storagePath)).catch(() => {});
      }
      await deleteDoc(photoDoc.ref);
    }
    await deleteDoc(doc(db, "projects", currentProject.id));
    if (unsubscribePhotos) unsubscribePhotos();
    currentProject = null;
    showView(viewProjects);
  } catch (err) {
    console.error("Kunne ikke slette prosjekt", err.code, err.message);
    alert(`Kunne ikke slette prosjekt (${err.code || err.message}).`);
  } finally {
    deleteProjectBtn.disabled = false;
    deleteProjectBtn.textContent = "🗑️ Slett prosjekt";
  }
});

function listenToPhotos(projectId) {
  if (unsubscribePhotos) unsubscribePhotos();
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

    photoGridEl.innerHTML = "";
    photosEmptyEl.classList.toggle("hidden", approved.length > 0);
    approved.forEach((data) => renderPhotoCard(photoGridEl, data, false));

    pendingSectionEl.classList.toggle("hidden", pending.length === 0);
    pendingGridEl.innerHTML = "";
    pending.forEach((data) => renderPhotoCard(pendingGridEl, data, true));
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

  container.appendChild(card);
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
  for (const photo of photos) {
    pdf.addPage();
    pageNumber++;
    const dataUrl = await urlToDataUrl(photo.url);
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

  const filename = `internkontroll-${project.name.replace(/\s+/g, "_")}.pdf`;

  if (Filesystem) {
    // Native app: skriv PDF-en til enheten og åpne del/lagre-menyen (nettleser-nedlasting fungerer ikke i WebView)
    const base64 = pdf.output("datauristring").split(",")[1];
    const writeResult = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: "CACHE",
    });
    if (Share) {
      await Share.share({ title: filename, url: writeResult.uri });
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
