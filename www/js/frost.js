import { frostObservationsUrl, frostSourcesUrl, parseFrostSource, dailyPrecipitation, rainWindows, shiftIsoDate } from "./drainage.js";
import { capacitorHttpPlugin, nativeHttpGet } from "./native-http.js";

// Frost krever Basic auth (klient-ID som brukernavn, tomt passord). Nettleseren stopper
// kallet på grunn av CORS. På telefonen kalles CapacitorHttp.request direkte.
// Den globale XHR-lappen er av, så Firestore og Storage bruker WebView sin egen strøm.
export async function frostGet(url, clientId, http = {}) {
  const headers = {
    Authorization: `Basic ${btoa(`${clientId}:`)}`,
    Accept: "application/json",
  };
  const plugin = http.plugin === undefined ? capacitorHttpPlugin() : http.plugin;
  const { status, data } = await nativeHttpGet(url, headers, { plugin, fetchImpl: http.fetchImpl });
  if (status >= 400) throw frostError(data, status);
  return data;
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
