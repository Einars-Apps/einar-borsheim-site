import { placeFields } from "./place.js";

function positionFromReading(reading) {
  const coords = reading?.coords || reading;
  return placeFields({
    lat: coords?.latitude,
    lon: coords?.longitude,
    accuracyM: coords?.accuracy,
  });
}

function browserPosition(timeoutMs) {
  const geolocation = globalThis.navigator?.geolocation;
  if (!geolocation?.getCurrentPosition) return Promise.resolve(null);
  return new Promise((resolve) => {
    geolocation.getCurrentPosition(
      (position) => resolve(positionFromReading(position)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

export async function readDevicePosition(timeoutMs = 8000) {
  const Geo = globalThis.Capacitor?.Plugins?.Geolocation;
  if (Geo?.getCurrentPosition) {
    try {
      if (Geo.checkPermissions && Geo.requestPermissions) {
        let permission = await Geo.checkPermissions();
        const allowed = permission?.location === "granted" || permission?.coarseLocation === "granted";
        if (!allowed && permission?.location !== "denied") {
          permission = await Geo.requestPermissions();
        }
        const granted = permission?.location === "granted" || permission?.coarseLocation === "granted";
        if (!granted) return null;
      }
      const position = await Geo.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 15000,
      });
      return positionFromReading(position);
    } catch {
      return browserPosition(timeoutMs);
    }
  }
  return browserPosition(timeoutMs);
}
