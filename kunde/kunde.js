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
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const viewLoading = document.getElementById("view-loading");
const viewError = document.getElementById("view-error");
const viewProject = document.getElementById("view-project");
const projectTitleEl = document.getElementById("project-title");
const projectDescEl = document.getElementById("project-desc");
const reportBoxEl = document.getElementById("report-box");
const reportTextEl = document.getElementById("report-text");
const photoGridEl = document.getElementById("photo-grid");
const photosEmptyEl = document.getElementById("photos-empty");
const photoInput = document.getElementById("photo-input");
const commentInput = document.getElementById("comment-input");
const submitBtn = document.getElementById("submit-btn");
const submitStatusEl = document.getElementById("submit-status");

function showView(view) {
  [viewLoading, viewError, viewProject].forEach((v) => v.classList.add("hidden"));
  view.classList.remove("hidden");
}

const params = new URLSearchParams(window.location.search);
const projectId = params.get("p");
const token = params.get("t");

let selectedFile = null;

photoInput.addEventListener("change", () => {
  selectedFile = photoInput.files?.[0] || null;
  submitBtn.disabled = !selectedFile;
});

async function init() {
  if (!projectId || !token) {
    showView(viewError);
    return;
  }
  try {
    const cred = await signInAnonymously(auth);
    // Registrer tilgang med token fra lenken (sjekkes av Firestore-reglene).
    await setDoc(doc(db, "projects", projectId, "access", cred.user.uid), { token }).catch(() => {});
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists() || snap.data().shareToken !== token) {
      showView(viewError);
      return;
    }
    const data = snap.data();
    projectTitleEl.textContent = data.name;
    projectDescEl.textContent = data.description || "";
    if (data.reportText) {
      reportTextEl.textContent = data.reportText;
      reportBoxEl.classList.remove("hidden");
    }
    showView(viewProject);
    listenToPhotos();
  } catch (err) {
    console.error("Kunne ikke laste prosjekt", err);
    showView(viewError);
  }
}

function listenToPhotos() {
  const q = query(collection(db, "projects", projectId, "photos"), where("approved", "==", true));
  onSnapshot(q, (snapshot) => {
    photoGridEl.innerHTML = "";
    photosEmptyEl.classList.toggle("hidden", !snapshot.empty);
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const card = document.createElement("div");
      card.className = "photo-card";
      card.innerHTML = `
        <img src="${data.url}" alt="Bilde" loading="lazy" />
        ${data.caption ? `<div class="caption">${escapeHtml(data.caption)}</div>` : ""}
      `;
      photoGridEl.appendChild(card);
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

submitBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  submitBtn.disabled = true;
  submitStatusEl.classList.remove("hidden");
  submitStatusEl.textContent = "Laster opp...";
  try {
    const compressed = await compressImage(selectedFile);
    const filename = `customer-${Date.now()}.jpg`;
    const storagePath = `projects/${projectId}/${filename}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytesResumable(storageRef, compressed, { contentType: "image/jpeg" });
    const url = await getDownloadURL(storageRef);
    await addDoc(collection(db, "projects", projectId, "photos"), {
      url,
      storagePath,
      caption: commentInput.value.trim(),
      approved: false,
      source: "customer",
      createdAt: serverTimestamp(),
      uploadedBy: "kunde",
    });
    submitStatusEl.textContent = "Takk! Bildet er sendt inn og vises når det er godkjent.";
    photoInput.value = "";
    commentInput.value = "";
    selectedFile = null;
  } catch (err) {
    console.error("Innsending feilet", err);
    submitStatusEl.textContent = "Noe gikk galt. Prøv igjen.";
  } finally {
    submitBtn.disabled = true;
  }
});

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

init();
