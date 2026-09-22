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
const exportPdfBtn = document.getElementById("export-pdf-btn");
const cameraInput = document.getElementById("camera-input");
const galleryInput = document.getElementById("gallery-input");
const uploadStatusEl = document.getElementById("upload-status");
const photoGridEl = document.getElementById("photo-grid");
const photosEmptyEl = document.getElementById("photos-empty");

let unsubscribeProjects = null;
let unsubscribePhotos = null;
let currentProject = null; // { id, name, description }
let currentPhotos = [];

function showView(view) {
  [viewLogin, viewProjects, viewProject].forEach((v) => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

// --- Auth ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    userEmailEl.textContent = user.email;
    logoutLink.classList.remove("hidden");
    showView(viewProjects);
    listenToProjects();
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
  currentProject = { id, name: data.name, description: data.description || "" };
  projectTitleEl.textContent = currentProject.name;
  projectDescViewEl.textContent = currentProject.description;
  showView(viewProject);
  listenToPhotos(id);
}

backToProjectsBtn.addEventListener("click", () => {
  if (unsubscribePhotos) unsubscribePhotos();
  currentProject = null;
  showView(viewProjects);
});

function listenToPhotos(projectId) {
  if (unsubscribePhotos) unsubscribePhotos();
  const q = query(collection(db, "projects", projectId, "photos"), orderBy("createdAt", "desc"));
  unsubscribePhotos = onSnapshot(q, (snapshot) => {
    currentPhotos = [];
    photoGridEl.innerHTML = "";
    if (snapshot.empty) {
      photosEmptyEl.classList.remove("hidden");
      return;
    }
    photosEmptyEl.classList.add("hidden");
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      currentPhotos.push({ id: docSnap.id, ...data });
      renderPhotoCard(docSnap.id, data);
    });
  });
}

function renderPhotoCard(photoId, data) {
  const card = document.createElement("div");
  card.className = "photo-card";
  card.innerHTML = `
    <img src="${data.url}" alt="Bilde" loading="lazy" />
    <textarea class="photo-caption" rows="2" placeholder="Kommentar / avvik...">${data.caption || ""}</textarea>
    <div class="photo-actions">
      <span class="photo-date"></span>
      <button class="delete-photo">Slett</button>
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
      updateDoc(doc(db, "projects", currentProject.id, "photos", photoId), {
        caption: captionEl.value,
      });
    }, 600);
  });

  card.querySelector(".delete-photo").addEventListener("click", async () => {
    if (!confirm("Slette dette bildet?")) return;
    try {
      if (data.storagePath) {
        await deleteObject(ref(storage, data.storagePath));
      }
    } catch (err) {
      // fortsett å slette Firestore-posten selv om filen mangler i storage
    }
    await deleteDoc(doc(db, "projects", currentProject.id, "photos", photoId));
  });

  photoGridEl.appendChild(card);
}

// --- Opplasting av bilder (kamera eller eksisterende bilder) ---
let uploadInProgress = false;

window.addEventListener("beforeunload", (e) => {
  if (uploadInProgress) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function handlePhotoFiles(files, inputEl) {
  if (!files.length || !currentProject) return;
  uploadInProgress = true;
  uploadStatusEl.classList.remove("hidden");
  for (let i = 0; i < files.length; i++) {
    try {
      uploadStatusEl.textContent = `Komprimerer bilde ${i + 1} av ${files.length}...`;
      const compressed = await compressImage(files[i]);
      const filename = `${Date.now()}-${i}.jpg`;
      const storagePath = `projects/${currentProject.id}/${filename}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, compressed, { contentType: "image/jpeg" });
      await new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            uploadStatusEl.textContent = `Laster opp bilde ${i + 1} av ${files.length} (${percent}%)...`;
          },
          reject,
          resolve
        );
      });
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, "projects", currentProject.id, "photos"), {
        url,
        storagePath,
        caption: "",
        createdAt: serverTimestamp(),
        uploadedBy: auth.currentUser?.email || "ukjent",
      });
    } catch (err) {
      console.error("Opplasting feilet", err.code, err.message);
      alert(`Opplasting feilet (${err.code || err.message}). Prøv på nytt uten å bytte app eller låse skjermen mens det laster.`);
    }
  }
  uploadInProgress = false;
  uploadStatusEl.classList.add("hidden");
  inputEl.value = "";
}

cameraInput.addEventListener("change", (e) => handlePhotoFiles(Array.from(e.target.files || []), cameraInput));
galleryInput.addEventListener("change", (e) => handlePhotoFiles(Array.from(e.target.files || []), galleryInput));

// Skalerer ned og komprimerer bildet før opplasting for å spare data/lagring.
// createImageBitmap dekoder rå fil direkte (mye raskere enn FileReader/dataURL for store mobilbilder).
async function compressImage(file, maxDimension = 1600, quality = 0.75) {
  const bitmap = await createImageBitmap(file);
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
    await generatePdfReport(currentProject, currentPhotos);
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

async function generatePdfReport(project, photos) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;

  // Forside
  pdf.setFontSize(22);
  pdf.text("Internkontroll-rapport", margin, 30);
  pdf.setFontSize(16);
  pdf.text(project.name, margin, 42);
  pdf.setFontSize(11);
  if (project.description) {
    pdf.text(project.description, margin, 50, { maxWidth: pageWidth - margin * 2 });
  }
  pdf.setFontSize(10);
  pdf.text(`Generert: ${new Date().toLocaleString("no-NO")}`, margin, pageHeight - 15);
  pdf.text(`Antall bilder: ${photos.length}`, margin, pageHeight - 10);

  for (const photo of photos) {
    pdf.addPage();
    const dataUrl = await urlToDataUrl(photo.url);
    const dims = await getImageDimensions(dataUrl);
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2 - 20;
    let { width, height } = fitDimensions(dims.width, dims.height, maxWidth, maxHeight);
    const x = (pageWidth - width) / 2;
    pdf.addImage(dataUrl, "JPEG", x, margin, width, height);
    if (photo.caption) {
      pdf.setFontSize(11);
      pdf.text(photo.caption, margin, margin + height + 8, { maxWidth });
    }
    const date = photo.createdAt?.toDate ? photo.createdAt.toDate().toLocaleDateString("no-NO") : "";
    pdf.setFontSize(9);
    pdf.text(date, margin, pageHeight - 10);
  }

  const filename = `internkontroll-${project.name.replace(/\s+/g, "_")}.pdf`;
  pdf.save(filename);
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

// --- PWA service worker ---
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
