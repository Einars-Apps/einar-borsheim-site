import { frostObservationsUrl, frostSourcesUrl, parseFrostSource, dailyPrecipitation, rainWindows, shiftIsoDate } from "./drainage.js";

// Frost krever Basic auth (klient-ID som brukernavn, tomt passord). Nettleseren stopper
// kallet på grunn av CORS. I Android-appen er CapacitorHttp slått på, og kallet går
// gjennom telefonens HTTP-bibliotek, uten nettleserens CORS-sperre.
export async function frostGet(url, clientId) {
  const headers = {
    Authorization: `Basic ${btoa(`${clientId}:`)}`,
    Accept: "application/json",
  };
  const plugin = window.Capacitor?.Plugins?.CapacitorHttp;
  if (plugin?.get) {
    const response = await plugin.get({ url, headers });
    const status = response.status || 0;
    const data = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    if (status >= 400) throw frostError(data, status);
    return data;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw frostError(await response.json().catch(() => ({})), response.status);
  return response.json();
}

function frostError(data, status) {
  const message = data?.error?.message || data?.error?.reason || `Frost svarte ${status}`;
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function fetchFrostRain({ clientId, latitude, longitude, date }) {
  if (!clientId) {
    const error = new Error("Frost-klient mangler");
    error.code = "no-client";
    throw error;
  }
  const sourcePayload = await frostGet(frostSourcesUrl(longitude, latitude), clientId);
  const source = parseFrostSource(sourcePayload);
  const from = shiftIsoDate(date, -7);
  const to = shiftIsoDate(date, 1);
  const observations = await frostGet(frostObservationsUrl(source.stationId, from, to), clientId);
  const windows = rainWindows(dailyPrecipitation(observations), date);
  return {
    source: "frost",
    stationId: source.stationId,
    stationName: source.stationName,
    distanceKm: source.distanceKm,
    date,
    ...windows,
    fetchedAt: new Date().toLocaleString("nb-NO"),
  };
}
