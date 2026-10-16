import { photoMillis } from "./photos.js";

export const GPS_GOOD_M = 30;

export function formatCapture(value, timeZone = "Europe/Oslo") {
  const time = photoMillis(value);
  if (time == null) return "";
  const parts = new Intl.DateTimeFormat("nb-NO", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const day = pick("day");
  const month = pick("month");
  const year = pick("year");
  const hour = pick("hour");
  const minute = pick("minute");
  if (!day || !month || !year || !hour || !minute) return "";
  return `${day}.${month}.${year} kl. ${hour}:${minute}`;
}

function wallParts(time) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(time));
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour") === "24" ? "00" : pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function osloOffsetMillis(utcMillis) {
  const parts = wallParts(utcMillis);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcMillis;
}

export function photoTimeLabel(photo) {
  const taken = photoMillis(photo?.takenAt);
  if (taken != null) return formatCapture(taken);
  const uploaded = photoMillis(photo?.uploadedAt) ?? photoMillis(photo?.createdAt);
  if (uploaded == null) return "";
  return `Lastet opp ${formatCapture(uploaded)}`;
}

export function photoWhen(photo) {
  return photoTimeLabel(photo);
}

export function captureInputValue(value) {
  const time = photoMillis(value);
  if (time == null) return "";
  const parts = wallParts(time);
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function captureInputToMillis(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = osloOffsetMillis(utc);
  utc -= offset;
  const refined = osloOffsetMillis(utc);
  if (refined !== offset) utc -= refined - offset;
  const parts = wallParts(utc);
  if (parts.year !== match[1] || parts.month !== match[2] || parts.day !== match[3] || parts.hour !== match[4] || parts.minute !== match[5]) {
    return null;
  }
  return utc;
}

export function showGpsInReport(project) {
  return project?.showGpsInReport !== false;
}

export function mapHref(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  const la = latitude.toFixed(5);
  const lo = longitude.toFixed(5);
  return `https://norgeskart.no/#!?project=norgeskart&lat=${la}&lon=${lo}&zoom=16&markerLat=${la}&markerLon=${lo}`;
}

export function gpsLabel(place) {
  const lat = Number(place?.lat);
  const lon = Number(place?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const href = mapHref(lat, lon);
  const accuracy = Number(place?.accuracyM);
  const precise = Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= GPS_GOOD_M;
  if (!precise) return { text: "Omtrentlig posisjon", href, precise: false };
  const metres = Math.max(0, Math.round(accuracy));
  return { text: `${lat.toFixed(4)}, ${lon.toFixed(4)} ±${metres} m`, href, precise: true };
}

export function placeFields(source) {
  const lat = Number(source?.lat);
  const lon = Number(source?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const fields = { lat, lon };
  const accuracy = Number(source?.accuracyM);
  if (Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100000) fields.accuracyM = accuracy;
  return fields;
}

export function withDevicePosition(prepared, position) {
  if (!prepared || placeFields(prepared)) return prepared;
  const fields = placeFields(position);
  if (!fields) return prepared;
  return { ...prepared, ...fields };
}
