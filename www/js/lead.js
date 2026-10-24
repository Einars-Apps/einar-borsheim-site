export const LEAD_MAX_BYTES = 8 * 1024 * 1024;
export const LEAD_TYPES = ["image/jpeg", "image/png", "image/webp"];

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function leadId() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += ID_CHARS[bytes[i] % ID_CHARS.length];
  return out;
}

export function leadFileName(name, type) {
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const cleaned = String(name || "").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 70);
  if (cleaned && /\.(jpe?g|png|webp)$/i.test(cleaned)) return cleaned.slice(0, 80);
  const base = cleaned.replace(/\./g, "") || "bilde";
  return `${base}.${ext}`.slice(0, 80);
}

export function leadError(input = {}) {
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim();
  const place = String(input.place || "").trim();
  const text = String(input.text || "").trim();
  if (name.length < 2 || name.length > 79) return "Skriv navnet ditt.";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || phone.length > 19 || !/^[+0-9][0-9 ]{7,18}$/.test(phone)) return "Skriv et telefonnummer.";
  if (email.length > 199) return "E-postadressen er for lang.";
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "E-postadressen ser ikke riktig ut.";
  if (place.length < 2 || place.length > 79) return "Skriv sted eller kommune.";
  if (text.length < 3 || text.length > 1999) return "Skriv en kort beskrivelse.";
  if (input.file) {
    if (!LEAD_TYPES.includes(input.file.type)) return "Bildet må være JPEG, PNG eller WebP.";
    if (input.file.size > LEAD_MAX_BYTES) return "Bildet er for stort. Maks 8 MB.";
  }
  return "";
}

export function leadDocument({ id, name, phone, email = "", place, text, fileName = "", contentType = "" }) {
  const doc = {
    name: String(name || "").trim(),
    phone: String(phone || "").trim(),
    place: String(place || "").trim(),
    text: String(text || "").trim(),
  };
  const mail = String(email || "").trim();
  if (mail) doc.email = mail;
  if (fileName) {
    doc.storagePath = `henvendelser/${id}/${fileName}`;
    doc.contentType = contentType;
  }
  return doc;
}
