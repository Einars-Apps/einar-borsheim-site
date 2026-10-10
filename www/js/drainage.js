// Beregninger for dreneringsmodulen. Tallene er omtrentlige og kan redigeres i skjemaet.
// De er ikke hentet som krav fra SINTEF Byggforsk.

export const DRAINAGE_DEFAULTS = {
  dischargeCoefficient: 0.62,
  densityKgM3: 1000,
  manningN: 0.011,
  roofCoefficient: 0.9,
  plotCoefficient: 0.3,
  greenAt: 1.5,
  yellowAt: 1,
  askerLatitude: 59.833,
  askerLongitude: 10.435,
};

const SOIL_SOURCE = "Omtrentlig størrelsesorden for mettet hydraulisk ledningsevne, slik den brukes i hydrogeologi (Freeze og Cherry) og i vanlig geoteknisk praksis. Ikke et Byggforsk-krav.";

export const SOIL_TYPES = [
  { id: "leire", label: "Leire", kMs: 1e-9, range: "10⁻¹⁰–10⁻⁸ m/s", source: SOIL_SOURCE },
  { id: "silt", label: "Silt", kMs: 1e-7, range: "10⁻⁸–10⁻⁶ m/s", source: SOIL_SOURCE },
  { id: "sand", label: "Sand", kMs: 1e-4, range: "10⁻⁵–10⁻³ m/s", source: SOIL_SOURCE },
  { id: "grus", label: "Grus", kMs: 1e-2, range: "10⁻³–10⁻¹ m/s", source: SOIL_SOURCE },
  { id: "fyllmasse", label: "Fyllmasse", kMs: 1e-5, range: "ofte 10⁻⁶–10⁻⁴ m/s, svært varierende", source: SOIL_SOURCE },
  { id: "morene", label: "Morene", kMs: 1e-7, range: "10⁻⁸–10⁻⁶ m/s", source: SOIL_SOURCE },
];

const BACKFILL = [
  ["pukk", "Pukk"],
  ["singel", "Singel"],
  ["sand", "Sand"],
  ["stedlig", "Stedlige masser"],
  ["annet", "Annet"],
];

export function backfillChoices() {
  return BACKFILL.map(([id, label]) => ({ id, label }));
}

export function soilById(id) {
  return SOIL_TYPES.find((soil) => soil.id === id) || SOIL_TYPES[2];
}

export function parseNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "–";
  return new Intl.NumberFormat("nb-NO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatConductivity(k) {
  if (!Number.isFinite(k) || k <= 0) return "–";
  const exp = Math.floor(Math.log10(k));
  const mantissa = k / 10 ** exp;
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const expText = String(exp).replace("-", "⁻").replace(/\d/g, (digit) => digits[digit]);
  return `${formatNumber(mantissa, 1)}·10${expText} m/s`;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

// Q = Cd · A · √(2Δp/ρ). Trykket er overtrykk mot friluft. Resultatet er et estimat.
export function hoseFlowLitersPerMinute({
  diameterMm,
  pressureBar,
  coefficient = DRAINAGE_DEFAULTS.dischargeCoefficient,
  density = DRAINAGE_DEFAULTS.densityKgM3,
} = {}) {
  if (!(diameterMm > 0) || !(pressureBar > 0) || !(coefficient > 0) || !(density > 0)) return null;
  const diameterM = diameterMm / 1000;
  const area = Math.PI * (diameterM / 2) ** 2;
  const deltaP = pressureBar * 1e5;
  const cubicPerSecond = coefficient * area * Math.sqrt((2 * deltaP) / density);
  return cubicPerSecond * 1000 * 60;
}

export function measuredFlowLitersPerMinute({ liters, minutes } = {}) {
  if (!(liters > 0) || !(minutes > 0)) return null;
  return liters / minutes;
}

export function flowPerMeter(litersPerMinute, lengthM) {
  if (!(litersPerMinute > 0) || !(lengthM > 0)) return null;
  return litersPerMinute / lengthM;
}

// Manning for fullt, sirkulært rør: Q = (1/n) · A · R^(2/3) · S^(1/2). Fall er i promille.
export function manningLitersPerSecond({
  diameterMm,
  slopePerMille,
  manningN = DRAINAGE_DEFAULTS.manningN,
} = {}) {
  if (!(diameterMm > 0) || !(slopePerMille > 0) || !(manningN > 0)) return null;
  const diameterM = diameterMm / 1000;
  const area = Math.PI * diameterM ** 2 / 4;
  const radius = diameterM / 4;
  const slope = slopePerMille / 1000;
  const cubicPerSecond = (1 / manningN) * area * radius ** (2 / 3) * Math.sqrt(slope);
  return cubicPerSecond * 1000;
}

export function millimetersPerHour({ mmPerHour, litersPerSecondPerHectare } = {}) {
  if (mmPerHour > 0) return mmPerHour;
  if (litersPerSecondPerHectare > 0) return litersPerSecondPerHectare * 0.36;
  return null;
}

// Rasjonelle formel. 1 mm på 1 m² er 1 liter. C er avrenningskoeffisient.
export function inflowLitersPerSecond({
  roofM2 = 0,
  plotM2 = 0,
  roofC = DRAINAGE_DEFAULTS.roofCoefficient,
  plotC = DRAINAGE_DEFAULTS.plotCoefficient,
  mmPerHour,
} = {}) {
  if (!(mmPerHour > 0)) return null;
  const roof = Math.max(0, roofM2) * (roofC ?? 0) * mmPerHour / 3600;
  const plot = Math.max(0, plotM2) * (plotC ?? 0) * mmPerHour / 3600;
  const total = roof + plot;
  return total > 0 ? total : null;
}

export function verdictFromRatio(ratio, { greenAt = DRAINAGE_DEFAULTS.greenAt, yellowAt = DRAINAGE_DEFAULTS.yellowAt } = {}) {
  if (!(ratio > 0)) return "";
  if (ratio >= greenAt) return "gronn";
  if (ratio >= yellowAt) return "gul";
  return "rod";
}

function worseVerdict(left, right) {
  const rank = { rod: 0, gul: 1, gronn: 2 };
  if (!left) return right || "";
  if (!right) return left;
  return rank[left] <= rank[right] ? left : right;
}

export function verdictLabel(verdict) {
  if (verdict === "gronn") return "Grønn";
  if (verdict === "gul") return "Gul";
  if (verdict === "rod") return "Rød";
  return "Ikke vurdert";
}

export function emptyDrainageForm() {
  return {
    name: "",
    soilId: "sand",
    soilNote: "",
    soilK: "",
    soilKTouched: false,
    photoIds: [],
    volumeLiters: "",
    minutes: "",
    hoseMm: "",
    pressureBar: "",
    ditchLengthM: "",
    pipeDiameterMm: "110",
    slopePerMille: "",
    pipeLengthM: "",
    backfill: "pukk",
    backfillNote: "",
    manningN: String(DRAINAGE_DEFAULTS.manningN),
    roofM2: "",
    plotM2: "",
    roofC: String(DRAINAGE_DEFAULTS.roofCoefficient),
    plotC: String(DRAINAGE_DEFAULTS.plotCoefficient),
    mmPerHour: "",
    litersPerSecondPerHectare: "",
    latitude: String(DRAINAGE_DEFAULTS.askerLatitude),
    longitude: String(DRAINAGE_DEFAULTS.askerLongitude),
    rainDate: "",
    manualMm: "",
    manualStation: "",
    rain: null,
    deviates: false,
    deviationReason: "",
  };
}

export function formFromDoc(data = {}) {
  const form = emptyDrainageForm();
  const water = data.water || {};
  const pipe = data.pipe || {};
  const runoff = data.runoff || {};
  form.name = data.name || "";
  form.soilId = data.soilId || form.soilId;
  form.soilNote = data.soilNote || "";
  form.soilK = data.soilK == null ? "" : String(data.soilK);
  form.soilKTouched = data.soilK != null;
  form.photoIds = (data.photos || []).map((photo) => photo.id).filter(Boolean);
  form.volumeLiters = water.volumeLiters ?? "";
  form.minutes = water.minutes ?? "";
  form.hoseMm = water.hoseMm ?? "";
  form.pressureBar = water.pressureBar ?? "";
  form.ditchLengthM = water.ditchLengthM ?? "";
  form.pipeDiameterMm = pipe.diameterMm ?? form.pipeDiameterMm;
  form.slopePerMille = pipe.slopePerMille ?? "";
  form.pipeLengthM = pipe.lengthM ?? "";
  form.backfill = pipe.backfill || form.backfill;
  form.backfillNote = pipe.backfillNote || "";
  form.manningN = pipe.manningN ?? form.manningN;
  form.roofM2 = runoff.roofM2 ?? "";
  form.plotM2 = runoff.plotM2 ?? "";
  form.roofC = runoff.roofC ?? form.roofC;
  form.plotC = runoff.plotC ?? form.plotC;
  form.mmPerHour = runoff.mmPerHour ?? "";
  form.litersPerSecondPerHectare = runoff.litersPerSecondPerHectare ?? "";
  form.latitude = data.latitude ?? form.latitude;
  form.longitude = data.longitude ?? form.longitude;
  form.rainDate = data.rain?.date || "";
  form.manualMm = data.rain?.source === "manual" ? (data.rain.selectedMm ?? "") : "";
  form.manualStation = data.rain?.source === "manual" ? (data.rain.stationName || "") : "";
  form.rain = data.rain?.source === "frost" ? data.rain : null;
  form.deviates = data.deviatesFromByggforsk === true;
  form.deviationReason = data.deviationReason || "";
  return form;
}

export function drainageError(form) {
  if (!String(form.name || "").trim()) return "Gi strekket et navn, for eksempel nordvegg eller mot veien.";
  if (form.deviates && String(form.deviationReason || "").trim().length < 5) {
    return "Skriv hvorfor løsningen avviker fra Byggforsk-anbefalingen.";
  }
  return "";
}

function rainSentence(rain) {
  if (!rain) return "";
  const place = rain.stationName || "manuell måling";
  const distance = formatDistance(rain.distanceKm);
  const where = distance ? `${place}, ${distance} unna` : place;
  const bits = [
    rain.selectedMm != null ? `valgt dato ${formatNumber(rain.selectedMm)} mm` : "",
    rain.last1Mm != null ? `siste døgn ${formatNumber(rain.last1Mm)} mm` : "",
    rain.last3Mm != null ? `siste 3 døgn ${formatNumber(rain.last3Mm)} mm` : "",
    rain.last7Mm != null ? `siste 7 døgn ${formatNumber(rain.last7Mm)} mm` : "",
  ].filter(Boolean);
  const source = rain.source === "frost"
    ? "Kilde: Meteorologisk institutt / Frost."
    : "Kilde: manuelt innskrevet nedbør.";
  const when = rain.fetchedAt ? ` Hentet ${rain.fetchedAt}.` : "";
  return `Observert nedbør (${where}): ${bits.join(", ") || "ingen tall"}. ${source}${when}`;
}

export function formatDistance(distanceKm) {
  if (!(distanceKm >= 0)) return "";
  if (distanceKm < 1) return `${formatNumber(distanceKm * 1000, 0)} m`;
  return `${formatNumber(distanceKm, 1)} km`;
}

export function assessDrainage(form) {
  const soil = soilById(form.soilId);
  const typedK = parseNumber(form.soilK);
  const soilK = typedK != null && typedK > 0 ? typedK : soil.kMs;
  const volume = parseNumber(form.volumeLiters);
  const minutes = parseNumber(form.minutes);
  const measuredLpm = measuredFlowLitersPerMinute({ liters: volume, minutes });
  const estimatedLpm = hoseFlowLitersPerMinute({
    diameterMm: parseNumber(form.hoseMm),
    pressureBar: parseNumber(form.pressureBar),
  });
  const usedLpm = measuredLpm ?? estimatedLpm;
  const ditchLengthM = parseNumber(form.ditchLengthM);
  const perMeter = flowPerMeter(usedLpm, ditchLengthM);
  const pipeLs = manningLitersPerSecond({
    diameterMm: parseNumber(form.pipeDiameterMm),
    slopePerMille: parseNumber(form.slopePerMille),
    manningN: parseNumber(form.manningN) || DRAINAGE_DEFAULTS.manningN,
  });
  const mmPerHour = millimetersPerHour({
    mmPerHour: parseNumber(form.mmPerHour),
    litersPerSecondPerHectare: parseNumber(form.litersPerSecondPerHectare),
  });
  const inflowLs = inflowLitersPerSecond({
    roofM2: parseNumber(form.roofM2) || 0,
    plotM2: parseNumber(form.plotM2) || 0,
    roofC: parseNumber(form.roofC),
    plotC: parseNumber(form.plotC),
    mmPerHour,
  });
  const inflowLpm = inflowLs == null ? null : inflowLs * 60;
  const testRatio = usedLpm > 0 && inflowLpm > 0 ? usedLpm / inflowLpm : null;
  const pipeRatio = pipeLs > 0 && inflowLs > 0 ? pipeLs / inflowLs : null;
  const verdict = worseVerdict(verdictFromRatio(testRatio), verdictFromRatio(pipeRatio));
  const rain = form.rain || manualRain(form);
  const summary = buildSummary({
    form,
    soil,
    soilK,
    volume,
    minutes,
    measuredLpm,
    estimatedLpm,
    usedLpm,
    perMeter,
    ditchLengthM,
    pipeLs,
    mmPerHour,
    inflowLpm,
    testRatio,
    pipeRatio,
    verdict,
    rain,
  });
  return {
    soil,
    soilK,
    measuredLpm: round(measuredLpm, 2),
    estimatedLpm: round(estimatedLpm, 2),
    usedLpm: round(usedLpm, 2),
    usedSource: measuredLpm != null ? "malt" : estimatedLpm != null ? "estimat" : "",
    perMeter: round(perMeter, 2),
    pipeLs: round(pipeLs, 3),
    mmPerHour: round(mmPerHour, 2),
    inflowLs: round(inflowLs, 3),
    inflowLpm: round(inflowLpm, 2),
    testRatio: round(testRatio, 2),
    pipeRatio: round(pipeRatio, 2),
    verdict,
    summary,
    rain,
  };
}

function manualRain(form) {
  const mm = parseNumber(form.manualMm);
  const station = String(form.manualStation || "").trim();
  if (mm == null && !station) return null;
  return {
    source: "manual",
    stationId: "",
    stationName: station,
    distanceKm: null,
    date: form.rainDate || "",
    selectedMm: mm,
    last1Mm: null,
    last3Mm: null,
    last7Mm: null,
    fetchedAt: "",
  };
}

function buildSummary(calc) {
  const {
    form, soil, soilK, volume, minutes, measuredLpm, estimatedLpm, usedLpm, perMeter,
    pipeLs, mmPerHour, inflowLpm, testRatio, pipeRatio, verdict, rain,
  } = calc;
  const lines = [];
  lines.push(`${soil.label}. Omtrentlig vannledningsevne ${formatConductivity(soilK)} (${soil.range}). ${soil.source}`);
  if (String(form.soilNote || "").trim()) lines.push(String(form.soilNote).trim());

  if (measuredLpm != null) {
    const per = perMeter != null ? ` (${formatNumber(perMeter)} l/min per meter)` : "";
    let sentence = `Grøfta tok unna ${formatNumber(volume, 0)} liter på ${formatNumber(minutes)} min = ${formatNumber(usedLpm)} l/min${per}.`;
    if (inflowLpm > 0) {
      const roof = parseNumber(form.roofM2) || 0;
      const plot = parseNumber(form.plotM2) || 0;
      const where = [
        roof ? `${formatNumber(roof, 0)} m² tak` : "",
        plot ? `${formatNumber(plot, 0)} m² tomt` : "",
      ].filter(Boolean).join(" og ");
      sentence += ` Ved ${formatNumber(mmPerHour)} mm/t regn på ${where} kommer om lag ${formatNumber(inflowLpm)} l/min, altså ${marginPhrase(testRatio)}.`;
    }
    lines.push(sentence);
  } else if (estimatedLpm != null) {
    lines.push(`Estimert vann fra slangen er ${formatNumber(estimatedLpm)} l/min. Formelen er Q = Cd·A·√(2Δp/ρ) med Cd = ${formatNumber(DRAINAGE_DEFAULTS.dischargeCoefficient, 2)}. En bøttetest overstyrer dette estimatet.`);
  }

  if (pipeLs != null) {
    const backfill = backfillChoices().find((item) => item.id === form.backfill)?.label || "";
    const note = form.backfill === "annet" && form.backfillNote ? form.backfillNote : backfill;
    const lengthM = parseNumber(form.pipeLengthM);
    const lengthText = lengthM ? `, lengde ${formatNumber(lengthM, 0)} m` : "";
    lines.push(`Drensrøret (${formatNumber(parseNumber(form.pipeDiameterMm), 0)} mm, fall ${formatNumber(parseNumber(form.slopePerMille))} ‰${lengthText}, n = ${formatNumber(parseNumber(form.manningN) || DRAINAGE_DEFAULTS.manningN, 3)}) kan føre om lag ${formatNumber(pipeLs, 2)} l/s etter Manning for fullt, glatt plastrør. Omfylling: ${note || "ikke oppgitt"}. Omfyllingen styrer innlekkingen og inngår ikke i Manning-tallet.`);
    if (pipeRatio != null) {
      lines.push(`Røret mot dimensjonerende tilrenning: ${marginPhrase(pipeRatio)} (${formatNumber(pipeRatio, 1)} ganger).`);
    }
  }

  if (inflowLpm > 0 && measuredLpm == null) {
    lines.push(`Dimensjonerende tilrenning er om lag ${formatNumber(inflowLpm)} l/min ved ${formatNumber(mmPerHour)} mm/t, tak ${formatNumber(parseNumber(form.roofM2) || 0, 0)} m² (C = ${formatNumber(parseNumber(form.roofC), 2)}) og tomt ${formatNumber(parseNumber(form.plotM2) || 0, 0)} m² (C = ${formatNumber(parseNumber(form.plotC), 2)}).`);
  }

  if (verdict) lines.push(`Vurdering: ${verdictLabel(verdict)}. ${verdictExplanation(verdict)}`);
  const rainLine = rainSentence(rain);
  if (rainLine) lines.push(rainLine);
  if (form.deviates && String(form.deviationReason || "").trim()) {
    lines.push(`Avviker fra Byggforsk-anbefaling: ${String(form.deviationReason).trim()}`);
  }
  return lines.join("\n\n");
}

function marginPhrase(ratio) {
  const verdict = verdictFromRatio(ratio);
  if (verdict === "gronn") return "god margin";
  if (verdict === "gul") return "noe margin";
  if (verdict === "rod") return "for liten margin";
  return "uten sammenligning";
}

function verdictExplanation(verdict) {
  if (verdict === "gronn") return "Kapasiteten er minst 1,5 ganger tilrenningen.";
  if (verdict === "gul") return "Kapasiteten er mellom 1 og 1,5 ganger tilrenningen.";
  return "Kapasiteten er lavere enn tilrenningen.";
}

export function documentFromForm(form, assessment, photos = []) {
  const selected = new Set(form.photoIds || []);
  const chosen = photos.filter((photo) => selected.has(photo.id)).map((photo) => ({
    id: photo.id,
    url: photo.url,
    caption: photo.caption || "",
  }));
  const backfill = form.backfill === "annet" ? (form.backfillNote || "Annet") : form.backfill;
  return {
    name: String(form.name || "").trim(),
    soilId: form.soilId,
    soilLabel: assessment.soil.label,
    soilNote: String(form.soilNote || "").trim(),
    soilK: assessment.soilK,
    soilKRange: assessment.soil.range,
    soilKSource: assessment.soil.source,
    photos: chosen,
    latitude: parseNumber(form.latitude),
    longitude: parseNumber(form.longitude),
    water: {
      volumeLiters: parseNumber(form.volumeLiters),
      minutes: parseNumber(form.minutes),
      hoseMm: parseNumber(form.hoseMm),
      pressureBar: parseNumber(form.pressureBar),
      ditchLengthM: parseNumber(form.ditchLengthM),
      measuredLpm: assessment.measuredLpm,
      estimatedLpm: assessment.estimatedLpm,
      usedLpm: assessment.usedLpm,
      usedSource: assessment.usedSource,
      perMeter: assessment.perMeter,
    },
    pipe: {
      diameterMm: parseNumber(form.pipeDiameterMm),
      slopePerMille: parseNumber(form.slopePerMille),
      lengthM: parseNumber(form.pipeLengthM),
      backfill,
      backfillNote: String(form.backfillNote || "").trim(),
      manningN: parseNumber(form.manningN) || DRAINAGE_DEFAULTS.manningN,
      capacityLs: assessment.pipeLs,
    },
    runoff: {
      roofM2: parseNumber(form.roofM2),
      plotM2: parseNumber(form.plotM2),
      roofC: parseNumber(form.roofC),
      plotC: parseNumber(form.plotC),
      mmPerHour: assessment.mmPerHour,
      litersPerSecondPerHectare: parseNumber(form.litersPerSecondPerHectare),
      inflowLs: assessment.inflowLs,
      inflowLpm: assessment.inflowLpm,
    },
    ratios: { test: assessment.testRatio, pipe: assessment.pipeRatio },
    verdict: assessment.verdict,
    summary: assessment.summary,
    deviatesFromByggforsk: form.deviates === true,
    deviationReason: form.deviates ? String(form.deviationReason || "").trim() : "",
    rain: assessment.rain,
  };
}

export function reportIsPublished(project) {
  if (!project) return false;
  const status = project.status;
  const finished = status === "fullfort" || status === "done";
  return finished && !!(project.pdfPath || project.pdfUrl);
}

export function shiftIsoDate(iso, days) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function frostSourcesUrl(longitude, latitude) {
  const geometry = encodeURIComponent(`nearest(POINT(${longitude} ${latitude}))`);
  return `https://frost.met.no/sources/v0.jsonld?types=SensorSystem&elements=precipitation_amount&geometry=${geometry}`;
}

export function frostObservationsUrl(stationId, fromDate, toDate) {
  const params = [
    `sources=${encodeURIComponent(stationId)}`,
    `referencetime=${encodeURIComponent(`${fromDate}/${toDate}`)}`,
    `elements=${encodeURIComponent("sum(precipitation_amount P1D)")}`,
  ];
  return `https://frost.met.no/observations/v0.jsonld?${params.join("&")}`;
}

export function parseFrostSource(payload) {
  const item = payload?.data?.[0];
  if (!item?.id) {
    const error = new Error("Fant ingen målestasjon med nedbør i nærheten.");
    error.code = "no-station";
    throw error;
  }
  return {
    stationId: item.id,
    stationName: item.name || item.id,
    distanceKm: typeof item.distance === "number" ? item.distance : null,
  };
}

// Døgsummene fra Frost kan komme to ganger (PT6H og PT18H). PT6H er norsk døgnnedbør 06–06 UTC.
// De skal ikke legges sammen.
export function dailyPrecipitation(payload) {
  const byDay = new Map();
  for (const item of payload?.data || []) {
    const day = String(item.referenceTime || "").slice(0, 10);
    if (!day) continue;
    const observations = item.observations || [];
    const chosen = observations.find((obs) => obs.timeOffset === "PT6H") || observations[0];
    const value = Number(chosen?.value);
    if (!Number.isFinite(value)) continue;
    byDay.set(day, value);
  }
  return byDay;
}

export function rainWindows(byDay, date) {
  const sumLast = (count) => {
    let total = 0;
    let seen = 0;
    for (let index = 0; index < count; index += 1) {
      const key = shiftIsoDate(date, -index);
      if (byDay.has(key)) {
        total += byDay.get(key);
        seen += 1;
      }
    }
    return seen ? round(total, 1) : null;
  };
  return {
    selectedMm: byDay.has(date) ? round(byDay.get(date), 1) : null,
    last1Mm: sumLast(1),
    last3Mm: sumLast(3),
    last7Mm: sumLast(7),
  };
}

export function resolveFrostClientId(configId, settingsId) {
  const fromSettings = String(settingsId || "").trim();
  const fromConfig = String(configId || "").trim();
  return fromSettings || fromConfig || "";
}
