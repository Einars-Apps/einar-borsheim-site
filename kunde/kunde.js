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
  orderBy,
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
const projectStatusBadge = document.getElementById("project-status-badge");
const projectDescEl = document.getElementById("project-desc");
const reportBoxEl = document.getElementById("report-box");
const reportTextEl = document.getElementById("report-text");
const downloadPdfBtn = document.getElementById("download-pdf-btn");
const photoGridEl = document.getElementById("photo-grid");
const photosEmptyEl = document.getElementById("photos-empty");
const photoInput = document.getElementById("photo-input");
const commentInput = document.getElementById("comment-input");
const submitBtn = document.getElementById("submit-btn");
const submitStatusEl = document.getElementById("submit-status");
const messageListEl = document.getElementById("message-list");
const messageInputEl = document.getElementById("message-input");
const sendMessageBtn = document.getElementById("send-message-btn");
const documentInput = document.getElementById("document-input");
const documentStatusEl = document.getElementById("document-status");
const documentListEl = document.getElementById("document-list");
const documentsEmptyEl = document.getElementById("documents-empty");

const COMPANY = {
  name: "Einar A Børsheim",
  tagline: "Entreprenør",
  address: "Eriksvei 13, 1386 Asker",
  phone: "905 52 065",
  email: "e.bors@hotmail.com",
  orgNr: "962 091 504",
};

let approvedPhotosCache = [];
let currentProjectData = null;

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
    currentProjectData = data;
    projectTitleEl.textContent = data.name;
    projectDescEl.textContent = data.description || "";
    if (data.status === "done") {
      projectStatusBadge.classList.remove("hidden");
      downloadPdfBtn.classList.remove("hidden");
    }
    if (data.reportText) {
      reportTextEl.textContent = data.reportText;
      reportBoxEl.classList.remove("hidden");
    }
    showView(viewProject);
    listenToPhotos();
    listenToMessages();
    listenToDocuments();
  } catch (err) {
    console.error("Kunne ikke laste prosjekt", err);
    showView(viewError);
  }
}

function listenToMessages() {
  const q = query(collection(db, "projects", projectId, "messages"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    messageListEl.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const bubble = document.createElement("div");
      bubble.className = `message-bubble ${data.sender === "customer" ? "from-customer" : "from-admin"}`;
      const time = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString("no-NO") : "";
      bubble.innerHTML = `<span></span><span class="message-meta">${data.sender === "customer" ? "Deg" : "Einar A Børsheim"} · ${time}</span>`;
      bubble.querySelector("span").textContent = data.text;
      messageListEl.appendChild(bubble);
    });
    messageListEl.scrollTop = messageListEl.scrollHeight;
  });
}

async function sendCustomerMessage() {
  const text = messageInputEl.value.trim();
  if (!text) return;
  sendMessageBtn.disabled = true;
  try {
    await addDoc(collection(db, "projects", projectId, "messages"), {
      text,
      sender: "customer",
      createdAt: serverTimestamp(),
    });
    messageInputEl.value = "";
  } catch (err) {
    console.error("Kunne ikke sende melding", err);
    alert("Kunne ikke sende melding. Prøv igjen.");
  } finally {
    sendMessageBtn.disabled = false;
  }
}

sendMessageBtn.addEventListener("click", sendCustomerMessage);
messageInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendCustomerMessage();
  }
});

function listenToPhotos() {
  const q = query(collection(db, "projects", projectId, "photos"), where("approved", "==", true));
  onSnapshot(q, (snapshot) => {
    approvedPhotosCache = [];
    photoGridEl.innerHTML = "";
    photosEmptyEl.classList.toggle("hidden", !snapshot.empty);
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      approvedPhotosCache.push(data);
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

function listenToDocuments() {
  const q = query(collection(db, "projects", projectId, "documents"), where("approved", "==", true));
  onSnapshot(q, (snapshot) => {
    documentListEl.innerHTML = "";
    documentsEmptyEl.classList.toggle("hidden", !snapshot.empty);
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const date = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString("no-NO") : "";
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="${data.url}" target="_blank" rel="noopener"></a>
        <div class="doc-meta"></div>
      `;
      li.querySelector("a").textContent = data.name;
      li.querySelector(".doc-meta").textContent = `${data.source === "customer" ? "Deg" : "Einar A Børsheim"} · ${date}`;
      documentListEl.appendChild(li);
    });
  });
}

documentInput.addEventListener("change", async () => {
  const files = Array.from(documentInput.files || []);
  if (!files.length) return;
  documentStatusEl.classList.remove("hidden");
  for (let i = 0; i < files.length; i++) {
    documentStatusEl.textContent = `Laster opp ${i + 1} av ${files.length}...`;
    try {
      const storagePath = `projects/${projectId}/documents/${Date.now()}-${files[i].name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytesResumable(storageRef, files[i], { contentType: files[i].type || "application/octet-stream" });
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, "projects", projectId, "documents"), {
        name: files[i].name,
        url,
        storagePath,
        approved: false,
        source: "customer",
        uploadedBy: "kunde",
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Dokumentopplasting feilet", err);
      alert(`Kunne ikke laste opp "${files[i].name}".`);
    }
  }
  documentStatusEl.classList.add("hidden");
  documentInput.value = "";
});

downloadPdfBtn.addEventListener("click", async () => {
  downloadPdfBtn.disabled = true;
  downloadPdfBtn.textContent = "Genererer PDF...";
  try {
    await generatePdfReport(currentProjectData, approvedPhotosCache);
  } catch (err) {
    console.error("PDF-generering feilet", err);
    alert("Klarte ikke å lage PDF-rapport. Prøv igjen.");
  } finally {
    downloadPdfBtn.disabled = false;
    downloadPdfBtn.textContent = "📄 Last ned ferdig rapport (PDF)";
  }
});

async function generatePdfReport(project, photos) {
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
  pdf.text("Ferdigrapport", margin, 50);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(16);
  pdf.text(project.name, margin, 62);
  let cursorY = 70;
  pdf.setFontSize(11);
  if (project.description) {
    pdf.text(project.description, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
    cursorY += 10;
  }
  if (project.reportText) {
    pdf.text(project.reportText, margin, cursorY, { maxWidth: pageWidth - margin * 2 });
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
    let dataUrl;
    try {
      dataUrl = await urlToDataUrl(photo.url);
    } catch (err) {
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
    const { width, height } = fitDimensions(dims.width, dims.height, maxWidth, maxHeight);
    const x = (pageWidth - width) / 2;
    const y = margin + headerHeight;
    pdf.addImage(dataUrl, "JPEG", x, y, width, height);
    if (photo.caption) {
      pdf.setFontSize(11);
      pdf.text(photo.caption, margin, y + height + 8, { maxWidth });
    }
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text(`Side ${pageNumber}`, pageWidth - margin - 15, pageHeight - 10);
    pdf.setTextColor(20, 20, 20);
  }

  pdf.save(`internkontroll-${project.name.replace(/\s+/g, "_")}.pdf`);
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

init();
