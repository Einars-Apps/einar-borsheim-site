import { COMPANY } from "./company.js";
import { formatDay } from "./logic.js";

let fontCache;
let logoCache;

async function loadLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    const response = await fetch(new URL("../assets/logo-256.png", import.meta.url));
    if (!response.ok) throw new Error("logo");
    logoCache = `data:image/png;base64,${bufferToBase64(await response.arrayBuffer())}`;
  } catch (error) {
    console.error("Kunne ikke laste logo", error);
    logoCache = "";
  }
  return logoCache;
}

async function loadFonts() {
  if (fontCache) return fontCache;
  const [regular, bold] = await Promise.all([
    fetch(new URL("../fonts/NotoSans-Regular.ttf", import.meta.url)).then((res) => res.arrayBuffer()),
    fetch(new URL("../fonts/NotoSans-Bold.ttf", import.meta.url)).then((res) => res.arrayBuffer()),
  ]);
  fontCache = {
    regular: bufferToBase64(regular),
    bold: bufferToBase64(bold),
  };
  return fontCache;
}

function bufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fold(value) {
  return String(value || "")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("Æ", "Ae")
    .replaceAll("Ø", "O")
    .replaceAll("Å", "A");
}

function imageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error("bilde"));
    image.src = dataUrl;
  });
}

export async function generatePdfBlob(model) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const accent = [15, 107, 76];
  let useFont = true;
  try {
    const fonts = await loadFonts();
    pdf.addFileToVFS("NotoSans-Regular.ttf", fonts.regular);
    pdf.addFileToVFS("NotoSans-Bold.ttf", fonts.bold);
    pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    pdf.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
    pdf.setFont("NotoSans", "normal");
  } catch (error) {
    console.error("Kunne ikke laste PDF-skrift", error);
    useFont = false;
    pdf.setFont("helvetica", "normal");
  }

  const textOf = (value) => (useFont ? String(value || "") : fold(value));
  const logo = await loadLogo();
  let y = 18;

  function setFont(size, bold = false, color = [20, 32, 28]) {
    pdf.setFont(useFont ? "NotoSans" : "helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  }

  function lineHeight(size) {
    return size * 0.3528 * 1.35;
  }

  function newPage() {
    pdf.addPage();
    y = 16;
    setFont(9, false, [90, 106, 98]);
    pdf.text(textOf(`${model.project.name}  ·  ${COMPANY.name}`), margin, y);
    y = 22;
  }

  function ensure(height) {
    if (y + height > pageH - 16) newPage();
  }

  function write(value, { size = 11, bold = false, color = [20, 32, 28], gap = 1.5, width } = {}) {
    const content = textOf(value).trim();
    if (!content) return;
    setFont(size, bold, color);
    const lines = pdf.splitTextToSize(content, width || pageW - margin * 2);
    const height = lines.length * lineHeight(size);
    ensure(height + gap);
    pdf.text(lines, margin, y);
    y += height + gap;
  }

  function gap(amount = 3) {
    y += amount;
  }

  pdf.setFillColor(...accent);
  pdf.rect(0, 0, pageW, 48, "F");
  setFont(16, true, [255, 255, 255]);
  pdf.text(textOf(COMPANY.name), margin, 11);
  setFont(10, false, [232, 245, 239]);
  pdf.text(textOf(COMPANY.tagline), margin, 17);
  pdf.text(textOf(COMPANY.street || "Eriksvei 13"), margin, 23);
  pdf.text(textOf(COMPANY.postal || "1386 Asker"), margin, 29);
  pdf.text(textOf(`Tlf ${COMPANY.phone}  ·  ${COMPANY.email}  ·  Org.nr ${COMPANY.orgNr}`), margin, 37);
  if (logo) pdf.addImage(logo, "PNG", pageW - margin - 30, 9, 30, 30);

  y = 58;
  write("SLUTTRAPPORT", { size: 11, bold: true, color: accent, gap: 1 });
  write(model.project.name || "Prosjekt", { size: 20, bold: true, gap: 2 });

  const info = [
    model.project.customerName ? `Oppdragsgiver: ${model.project.customerName}` : "",
    model.project.address ? `Adresse: ${model.project.address}` : "",
    model.project.description ? `Om oppdraget: ${model.project.description}` : "",
    model.project.completedAt ? `Ferdig: ${formatDay(model.project.completedAt)}` : "Status: Pågår",
    `Rapport laget: ${new Date().toLocaleString("nb-NO")}`,
  ].filter(Boolean);
  for (const line of info) write(line, { size: 11, gap: 0.8 });

  gap(2);
  pdf.setDrawColor(...accent);
  pdf.setLineWidth(0.4);
  ensure(4);
  pdf.line(margin, y, pageW - margin, y);
  gap(6);

  write("Arbeid utført", { size: 14, bold: true, gap: 2 });
  if (model.reportText && model.reportText.trim()) write(model.reportText.trim(), { size: 11, gap: 2 });
  else write("Ingen sammendrag er skrevet inn.", { size: 11, color: [90, 106, 98] });

  for (const section of model.sections || []) {
    if (!section.items?.length) continue;
    gap(3);
    write(section.title, { size: 14, bold: true, gap: 2 });
    for (const item of section.items) {
      const heading = [item.title, formatWhenSafe(item.createdAt)].filter(Boolean).join("  ·  ");
      if (heading) write(heading, { size: 12, bold: true, gap: 1 });
      if (item.text) write(item.text, { size: 11, gap: 1.5 });
      if (item.stars) write(`Vurdering: ${item.stars} av 5`, { size: 11, bold: true });
      for (const photo of item.photos || []) {
        try {
          await drawPhoto(photo);
        } catch (error) {
          console.error(error);
          write("(Et bilde kunne ikke settes inn i rapporten.)", { size: 10, color: [141, 90, 18] });
        }
      }
      for (const comment of item.comments || []) {
        const who = comment.source === "kunde" ? "Kunde" : "Einar";
        write(`${who}${comment.createdAt ? ` · ${formatWhenSafe(comment.createdAt)}` : ""}`, {
          size: 9,
          color: [90, 106, 98],
          gap: 0.4,
        });
        write(comment.text, { size: 11, gap: 1.4 });
      }
      gap(2);
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    setFont(8, false, [110, 122, 116]);
    pdf.text(textOf(`${COMPANY.name}  ·  Org.nr ${COMPANY.orgNr}`), margin, pageH - 8);
    pdf.text(textOf(`${page} / ${pages}`), pageW - margin - 14, pageH - 8);
  }

  const safeName = String(model.project.name || "prosjekt")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return { blob: pdf.output("blob"), filename: `Sluttrapport-${safeName || "prosjekt"}.pdf` };

  async function drawPhoto(photo) {
    if (!photo?.dataUrl) return;
    const dims = await imageSize(photo.dataUrl);
    const maxW = pageW - margin * 2;
    const maxH = 105;
    const ratio = Math.min(maxW / dims.width, maxH / dims.height, 1);
    const width = Math.max(20, dims.width * ratio);
    const height = Math.max(20, dims.height * ratio);
    ensure(height + 8);
    pdf.addImage(photo.dataUrl, "JPEG", margin, y, width, height);
    y += height + 2;
    if (photo.caption) write(photo.caption, { size: 10, color: [50, 64, 58], gap: 1 });
  }
}

function formatWhenSafe(value) {
  try {
    return formatDay(value);
  } catch {
    return "";
  }
}
