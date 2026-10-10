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
    why: null,
    whyEdited: false,
    wells: [],
    costLines: null,
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
  form.why = data.why || null;
  form.whyEdited = !!data.why;
  form.wells = (data.wells || []).map(wellFromDoc);
  form.costLines = data.cost?.lines || null;
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
    why: form.whyEdited && form.why ? normalizeWhy(form.why) : buildWhy(form, assessment, form.defaultReference || ""),
    wells: (form.wells || []).map((well) => storedWell(well, form, assessment)),
    cost: storedCost(form.costLines || suggestStretchLines(form, form.prices)),
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

export const DEFAULT_BYGGFORSK_REFERENCE = "Generell beskrivelse, ikke et sitert blad: SINTEF Byggforsk anbefaler vanligvis at vann ledes bort fra bygningen, at drensrør legges med fall, og at det brukes drenerende masser der stedlige masser er tette. Bytt teksten hvis du vil vise til et bestemt blad.";

export const FALL_GUIDE_PER_MILLE = 10;

export const WELL_TYPES = [
  { id: "betongring", label: "Betongring", pore: 1 },
  { id: "plastkassett", label: "Plastkassett", pore: 0.95 },
  { id: "pukkmagasin", label: "Pukkmagasin", pore: 0.3 },
];

export const VAT_RATE = 0.25;

export const DEFAULT_PRICES = {
  gravingM3: 450,
  drensrorM: 180,
  bronnStk: 4500,
  pukkM3: 550,
  fiberdukM2: 35,
  tilbakefyllingM3: 150,
  maskinTime: 1100,
  mannTime: 750,
  transportTur: 1500,
};

const PRICE_LINES = [
  ["graving", "Graving", "m³", "gravingM3"],
  ["drensror", "Drensrør", "m", "drensrorM"],
  ["bronn", "Brønn eller kassett", "stk", "bronnStk"],
  ["pukk", "Pukk", "m³", "pukkM3"],
  ["fiberduk", "Fiberduk", "m²", "fiberdukM2"],
  ["tilbakefylling", "Tilbakefylling med stedlige masser", "m³", "tilbakefyllingM3"],
  ["maskin", "Maskin", "time", "maskinTime"],
  ["mann", "Mann", "time", "mannTime"],
  ["transport", "Transport", "tur", "transportTur"],
];

export function pricesFromSettings(data) {
  const saved = data?.prices || {};
  const prices = { ...DEFAULT_PRICES };
  for (const key of Object.keys(DEFAULT_PRICES)) {
    const value = parseNumber(saved[key]);
    if (value != null && value >= 0) prices[key] = value;
  }
  return prices;
}

export function pricesFromLines(lines, base = DEFAULT_PRICES) {
  const prices = { ...(base || DEFAULT_PRICES) };
  const keys = Object.fromEntries(PRICE_LINES.map(([id, , , key]) => [id, key]));
  for (const line of lines || []) {
    const key = keys[line.id];
    const value = parseNumber(line.unitPrice);
    if (key && value != null && value >= 0) prices[key] = value;
  }
  return prices;
}

export function emptyWell() {
  return {
    id: `bronn-${Date.now()}`,
    name: "Fordrøyningsbrønn",
    shape: "sirkel",
    depthM: "0.7",
    diameterM: "1",
    lengthM: "",
    widthM: "",
    kind: "betongring",
    pore: "1",
    soilK: "",
    measuredLph: "",
    roofM2: "",
    plotM2: "",
    mmPerHour: "",
    stormHours: "1",
    costLines: null,
  };
}

function wellFromDoc(data) {
  const well = emptyWell();
  well.id = data.id || well.id;
  well.name = data.name || well.name;
  well.shape = data.shape || well.shape;
  well.depthM = data.depthM ?? well.depthM;
  well.diameterM = data.diameterM ?? "";
  well.lengthM = data.lengthM ?? "";
  well.widthM = data.widthM ?? "";
  well.kind = data.kind || well.kind;
  well.pore = data.pore ?? well.pore;
  well.soilK = data.soilK ?? "";
  well.measuredLph = data.measuredLph ?? "";
  well.roofM2 = data.roofM2 ?? "";
  well.plotM2 = data.plotM2 ?? "";
  well.mmPerHour = data.mmPerHour ?? "";
  well.stormHours = data.stormHours ?? "1";
  well.costLines = data.cost?.lines || null;
  return well;
}

export function wellType(id) {
  return WELL_TYPES.find((type) => type.id === id) || WELL_TYPES[0];
}

export function magazineGrossCubicMeters({ shape, diameterM, lengthM, widthM, depthM } = {}) {
  if (!(depthM > 0)) return null;
  if (shape === "rektangel") {
    if (!(lengthM > 0) || !(widthM > 0)) return null;
    return lengthM * widthM * depthM;
  }
  if (!(diameterM > 0)) return null;
  return Math.PI * (diameterM / 2) ** 2 * depthM;
}

export function infiltrationAreaM2({ shape, diameterM, lengthM, widthM, depthM } = {}) {
  if (!(depthM > 0)) return null;
  if (shape === "rektangel") {
    if (!(lengthM > 0) || !(widthM > 0)) return null;
    return lengthM * widthM + 2 * (lengthM + widthM) * depthM;
  }
  if (!(diameterM > 0)) return null;
  const radius = diameterM / 2;
  return Math.PI * radius ** 2 + Math.PI * diameterM * depthM;
}

export function infiltrationLitersPerHour({ kMs, areaM2, measuredLph } = {}) {
  if (measuredLph > 0) return measuredLph;
  if (!(kMs > 0) || !(areaM2 > 0)) return null;
  return kMs * areaM2 * 1000 * 3600;
}

export function assessWell(well, context = {}) {
  const type = wellType(well.kind);
  const pore = parseNumber(well.pore);
  const poreVolume = pore != null && pore > 0 && pore <= 1 ? pore : type.pore;
  const shape = well.shape === "rektangel" ? "rektangel" : "sirkel";
  const size = {
    shape,
    depthM: parseNumber(well.depthM),
    diameterM: parseNumber(well.diameterM),
    lengthM: parseNumber(well.lengthM),
    widthM: parseNumber(well.widthM),
  };
  const grossM3 = magazineGrossCubicMeters(size);
  const volumeLiters = grossM3 == null ? null : grossM3 * poreVolume * 1000;
  const areaM2 = infiltrationAreaM2(size);
  const soilK = parseNumber(well.soilK) || context.soilK || null;
  const measuredLph = parseNumber(well.measuredLph);
  const perHour = infiltrationLitersPerHour({ kMs: soilK, areaM2, measuredLph });
  const perDay = perHour == null ? null : perHour * 24;
  const hoursToEmpty = volumeLiters > 0 && perHour > 0 ? volumeLiters / perHour : null;
  const mmPerHour = parseNumber(well.mmPerHour) || context.mmPerHour || null;
  const roofM2 = parseNumber(well.roofM2);
  const plotM2 = parseNumber(well.plotM2);
  const roof = roofM2 == null ? (context.roofM2 || 0) : roofM2;
  const plot = plotM2 == null ? (context.plotM2 || 0) : plotM2;
  const roofC = context.roofC ?? DRAINAGE_DEFAULTS.roofCoefficient;
  const plotC = context.plotC ?? DRAINAGE_DEFAULTS.plotCoefficient;
  const inflowLph = mmPerHour > 0 ? (roof * roofC + plot * plotC) * mmPerHour : null;
  const stormHours = parseNumber(well.stormHours) > 0 ? parseNumber(well.stormHours) : 1;
  const stormLiters = inflowLph > 0 ? inflowLph * stormHours : null;
  const covers = volumeLiters != null && perHour != null && stormLiters > 0
    ? volumeLiters + perHour * stormHours
    : null;
  const ratio = covers > 0 && stormLiters > 0 ? covers / stormLiters : null;
  const verdict = verdictFromRatio(ratio);
  const summary = wellSummary({
    well, type, poreVolume, volumeLiters, areaM2, perHour, perDay, hoursToEmpty,
    inflowLph, stormHours, stormLiters, ratio, verdict, measuredLph, soilK,
  });
  return {
    grossM3: round(grossM3, 3),
    poreVolume,
    volumeLiters: round(volumeLiters, 1),
    areaM2: round(areaM2, 2),
    perHour: round(perHour, 1),
    perDay: round(perDay, 1),
    hoursToEmpty: round(hoursToEmpty, 1),
    inflowLph: round(inflowLph, 1),
    stormHours,
    stormLiters: round(stormLiters, 1),
    ratio: round(ratio, 2),
    verdict,
    usedMeasure: measuredLph > 0 ? "malt" : perHour != null ? "k-verdi" : "",
    summary,
  };
}

function wellSummary(calc) {
  const lines = [];
  if (calc.volumeLiters == null) {
    return "Fyll inn dybde og diameter, eller lengde og bredde.";
  }
  lines.push(`${calc.type.label} med porevolum ${formatNumber(calc.poreVolume, 2)}. Magasinet rommer om lag ${formatNumber(calc.volumeLiters, 0)} liter.`);
  if (calc.perHour != null) {
    const how = calc.measuredLph > 0
      ? "målt infiltrasjon"
      : `k-verdi ${formatConductivity(calc.soilK)} ganget med bunn og sider (${formatNumber(calc.areaM2, 2)} m²), med enhetsgradient`;
    lines.push(`Tømming til stedlige masser er om lag ${formatNumber(calc.perHour, 0)} liter i timen og ${formatNumber(calc.perDay, 0)} liter i døgnet (${how}).`);
  }
  if (calc.hoursToEmpty != null) {
    lines.push(`Full brønn er tom etter om lag ${formatNumber(calc.hoursToEmpty, 1)} timer.`);
  }
  if (calc.stormLiters != null) {
    lines.push(`Tilkoblet areal gir om lag ${formatNumber(calc.inflowLph, 0)} liter i timen ved ${formatNumber(calc.stormHours, 1)} timers regn, altså ${formatNumber(calc.stormLiters, 0)} liter i skuren.`);
  }
  if (calc.verdict) {
    lines.push(`Vurdering: ${verdictLabel(calc.verdict)}. ${calc.verdict === "gronn" ? "Brønnen og bakken tar unna skuren med margin." : calc.verdict === "gul" ? "Det holder så vidt for denne skuren." : "Brønnen tar ikke unna den valgte skuren."}`);
  }
  return lines.join(" ");
}

function storedWell(well, form, assessment) {
  const result = assessWell(well, {
    soilK: assessment.soilK,
    mmPerHour: assessment.mmPerHour,
    roofM2: parseNumber(form.roofM2) || 0,
    plotM2: parseNumber(form.plotM2) || 0,
    roofC: parseNumber(form.roofC),
    plotC: parseNumber(form.plotC),
  });
  const lines = well.costLines || suggestWellLines(well, result, form.prices);
  return {
    id: well.id,
    name: String(well.name || "Fordrøyningsbrønn").trim(),
    shape: well.shape === "rektangel" ? "rektangel" : "sirkel",
    depthM: parseNumber(well.depthM),
    diameterM: parseNumber(well.diameterM),
    lengthM: parseNumber(well.lengthM),
    widthM: parseNumber(well.widthM),
    kind: well.kind,
    pore: result.poreVolume,
    soilK: parseNumber(well.soilK),
    measuredLph: parseNumber(well.measuredLph),
    roofM2: parseNumber(well.roofM2),
    plotM2: parseNumber(well.plotM2),
    mmPerHour: parseNumber(well.mmPerHour),
    stormHours: result.stormHours,
    volumeLiters: result.volumeLiters,
    areaM2: result.areaM2,
    perHour: result.perHour,
    perDay: result.perDay,
    hoursToEmpty: result.hoursToEmpty,
    inflowLph: result.inflowLph,
    stormLiters: result.stormLiters,
    ratio: result.ratio,
    verdict: result.verdict,
    summary: result.summary,
    cost: storedCost(lines),
  };
}

export function buildWhy(form, assessment, referenceOverride = "") {
  const reference = String(referenceOverride || DEFAULT_BYGGFORSK_REFERENCE).trim();
  const rows = [soilWhy(form, assessment), waterWhy(assessment), rainWhy(assessment), fallWhy(form)];
  return { reference, rows, conclusion: whyConclusion(rows) };
}

function soilWhy(form, assessment) {
  const tight = ["leire", "silt", "morene"].includes(form.soilId) || assessment.soilK < 1e-6;
  const documented = assessment.pipeLs != null || assessment.measuredLpm != null;
  return {
    id: "masser",
    topic: "Stedlige masser",
    einar: tight
      ? `Stedlig masse er ${assessment.soil.label.toLowerCase()} med omtrentlig k ${formatConductivity(assessment.soilK)}. Løsningen er å drenere, ikke å stole på massen alene.`
      : `Stedlig masse er ${assessment.soil.label.toLowerCase()} med omtrentlig k ${formatConductivity(assessment.soilK)}. Massen kan ta imot vann, og løsningen hviler på målingene.`,
    byggforsk: tight
      ? "Generelt anbefales drenering når massen er tett, slik at vann ikke blir stående mot grunnmuren. Dette er ikke et sitert krav."
      : "Ved mer åpne masser kan en enklere løsning holde. Det bør likevel vises at vannet ikke blir stående.",
    verdict: documented ? "gronn" : "gul",
  };
}

function waterWhy(assessment) {
  const byggforsk = "Anbefalingen er å kontrollere at vannet tas unna. Det finnes ikke ett tall for alle tomter. Målingen er dokumentasjonen.";
  if (assessment.measuredLpm != null && assessment.testRatio != null) {
    return {
      id: "vann",
      topic: "Vanntest og infiltrasjon",
      einar: `Bøttetest ${formatNumber(assessment.usedLpm)} l/min mot tilrenning ${formatNumber(assessment.inflowLpm)} l/min (${formatNumber(assessment.testRatio, 1)} ganger).`,
      byggforsk,
      verdict: verdictFromRatio(assessment.testRatio) || "gul",
    };
  }
  if (assessment.measuredLpm != null) {
    return {
      id: "vann",
      topic: "Vanntest og infiltrasjon",
      einar: `Bøttetest ${formatNumber(assessment.usedLpm)} l/min. Tilrenning er ikke fylt inn, så marginen er ikke regnet.`,
      byggforsk,
      verdict: "gul",
    };
  }
  if (assessment.estimatedLpm != null) {
    return {
      id: "vann",
      topic: "Vanntest og infiltrasjon",
      einar: `Bare et slangeestimat på ${formatNumber(assessment.estimatedLpm)} l/min, ikke en bøttetest.`,
      byggforsk,
      verdict: "gul",
    };
  }
  return {
    id: "vann",
    topic: "Vanntest og infiltrasjon",
    einar: "Ingen vanntest er ført.",
    byggforsk,
    verdict: "gul",
  };
}

function rainWhy(assessment) {
  const rain = assessment.rain;
  const byggforsk = "Lokal nedbør bør ligge til grunn. Intensiteten i sjekken er et valgt kontrolltall, ikke en observert døgnsum.";
  if (rain?.source === "frost" && rain.stationName) {
    const distance = formatDistance(rain.distanceKm);
    const near = rain.distanceKm == null || rain.distanceKm <= 10;
    return {
      id: "nedbor",
      topic: "Nedbør",
      einar: `Observert nedbør fra ${rain.stationName}${distance ? ` (${distance} unna)` : ""}. Valgt dato ${formatNumber(rain.selectedMm)} mm, siste 7 døgn ${formatNumber(rain.last7Mm)} mm. Kontrollintensitet ${formatNumber(assessment.mmPerHour)} mm/t.`,
      byggforsk,
      verdict: near ? "gronn" : "gul",
    };
  }
  if (rain) {
    return {
      id: "nedbor",
      topic: "Nedbør",
      einar: `Manuelt ført${rain.stationName ? ` fra ${rain.stationName}` : ""}: ${formatNumber(rain.selectedMm)} mm.`,
      byggforsk,
      verdict: "gul",
    };
  }
  return {
    id: "nedbor",
    topic: "Nedbør",
    einar: "Nedbør er ikke hentet eller ført.",
    byggforsk,
    verdict: "rod",
  };
}

function fallWhy(form) {
  const slope = parseNumber(form.slopePerMille);
  const byggforsk = `Generelt anbefales jevnt fall bort fra bygningen. ${FALL_GUIDE_PER_MILLE} ‰ er bare et praktisk skille i tabellen, ikke et sitert minimum.`;
  if (slope == null) {
    return { id: "fall", topic: "Terreng og fall", einar: "Fall er ikke fylt inn.", byggforsk, verdict: "gul" };
  }
  if (slope >= FALL_GUIDE_PER_MILLE) {
    return { id: "fall", topic: "Terreng og fall", einar: `Fall på ${formatNumber(slope)} ‰ er ført, så vann kan renne i røret.`, byggforsk, verdict: "gronn" };
  }
  if (slope > 0) {
    return { id: "fall", topic: "Terreng og fall", einar: `Fall på ${formatNumber(slope)} ‰ er lavt. Sjekk at det likevel heller bort fra huset.`, byggforsk, verdict: "gul" };
  }
  return { id: "fall", topic: "Terreng og fall", einar: "Fall er 0. Vann blir stående i røret.", byggforsk, verdict: "rod" };
}

function whyConclusion(rows) {
  if (rows.some((row) => row.verdict === "rod")) {
    return "Minst én rad er rød. Løsningen bør endres, eller så skriver du begrunnelsen for avviket.";
  }
  if (rows.some((row) => row.verdict === "gul")) {
    return "Løsningen kan brukes, med forbehold på de gule radene.";
  }
  return "Målingene støtter den valgte løsningen sammenlignet med en generell Byggforsk-praksis. Dette er ikke et sitat fra et blad.";
}

function normalizeWhy(why) {
  return {
    reference: String(why.reference || DEFAULT_BYGGFORSK_REFERENCE).trim(),
    rows: (why.rows || []).map((row) => ({
      id: row.id || "",
      topic: String(row.topic || "").trim(),
      einar: String(row.einar || "").trim(),
      byggforsk: String(row.byggforsk || "").trim(),
      verdict: ["gronn", "gul", "rod"].includes(row.verdict) ? row.verdict : "gul",
    })),
    conclusion: String(why.conclusion || "").trim(),
  };
}

export function formatWhy(why) {
  if (!why?.rows?.length && !why?.conclusion) return "";
  const lines = ["Hvorfor denne løsningen", why.reference || ""];
  for (const row of why.rows || []) {
    lines.push(`${row.topic} (${verdictLabel(row.verdict)}). Einar: ${row.einar} Byggforsk, generelt: ${row.byggforsk}`);
  }
  if (why.conclusion) lines.push(`Konklusjon: ${why.conclusion}`);
  return lines.filter(Boolean).join("\n");
}

function blankLine(id, label, unit, quantity, unitPrice) {
  return {
    id,
    label,
    unit,
    quantity: quantity == null || quantity === "" ? "" : String(quantity),
    unitPrice: unitPrice == null ? "" : String(unitPrice),
  };
}

export function suggestStretchLines(form, prices = DEFAULT_PRICES) {
  const rates = prices || DEFAULT_PRICES;
  return PRICE_LINES.map(([id, label, unit, key]) => blankLine(
    id,
    label,
    unit,
    id === "drensror" ? (parseNumber(form?.pipeLengthM) || "") : "",
    rates[key],
  ));
}

export function suggestWellLines(well, result, prices = DEFAULT_PRICES) {
  const rates = prices || DEFAULT_PRICES;
  const gravel = well?.kind === "pukkmagasin" && result?.grossM3 ? result.grossM3 : "";
  return PRICE_LINES.map(([id, label, unit, key]) => blankLine(
    id,
    label,
    unit,
    id === "bronn" ? 1 : id === "pukk" ? gravel : "",
    rates[key],
  ));
}

export function costTotals(lines, vatRate = VAT_RATE) {
  const parsed = (lines || []).map((line) => ({
    ...line,
    quantity: parseNumber(line.quantity) || 0,
    unitPrice: parseNumber(line.unitPrice) || 0,
  }));
  const exVat = round(parsed.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0), 2) || 0;
  const vat = round(exVat * vatRate, 2) || 0;
  return { exVat, vat, incVat: round(exVat + vat, 2) || 0 };
}

function storedCost(lines) {
  const totals = costTotals(lines);
  return {
    lines: (lines || []).map((line) => ({
      id: line.id,
      label: line.label,
      unit: line.unit,
      quantity: parseNumber(line.quantity) || 0,
      unitPrice: parseNumber(line.unitPrice) || 0,
    })),
    ...totals,
  };
}

export function formatMoney(value) {
  if (!Number.isFinite(value)) return "–";
  return `${new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} kr`;
}

export function formatCost(cost, title = "Kostnad") {
  if (!cost?.lines?.length) return "";
  const rows = cost.lines
    .filter((line) => line.quantity)
    .map((line) => `${line.label}: ${formatNumber(line.quantity, 2)} ${line.unit} × ${formatMoney(line.unitPrice)} = ${formatMoney(line.quantity * line.unitPrice)}`);
  if (!rows.length) return "";
  return [
    title,
    ...rows,
    `Sum eks. mva ${formatMoney(cost.exVat)}`,
    `Mva ${formatMoney(cost.vat)}`,
    `Sum inkl. mva ${formatMoney(cost.incVat)}`,
  ].join("\n");
}

export function costCsv(lines) {
  const header = "Beskrivelse;Antall;Enhet;Enhetspris eks. mva;Sum eks. mva";
  const rows = (lines || []).filter((line) => parseNumber(line.quantity)).map((line) => {
    const quantity = parseNumber(line.quantity) || 0;
    const price = parseNumber(line.unitPrice) || 0;
    const cell = (value) => String(value).replaceAll(";", ",");
    const number = (value) => formatNumber(value, 2);
    return [cell(line.label), number(quantity), cell(line.unit), number(price), number(quantity * price)].join(";");
  });
  return [header, ...rows].join("\n");
}

export function fikenDraftLines(lines) {
  return (lines || []).filter((line) => parseNumber(line.quantity) > 0).map((line) => ({
    description: `${line.label}${line.unit ? ` (${line.unit})` : ""}`,
    quantity: parseNumber(line.quantity),
    unitPrice: Math.round((parseNumber(line.unitPrice) || 0) * 100),
    vatType: "HIGH",
  }));
}

export function drainageReportText(data) {
  const wells = (data?.wells || []).map((well) => [well.name || "Fordrøyningsbrønn", well.summary || "", formatCost(well.cost, "Kostnad for brønnen")].filter(Boolean).join("\n"));
  return [
    data?.summary || "",
    formatWhy(data?.why),
    wells.join("\n\n"),
    formatCost(data?.cost, "Kostnad for strekket"),
  ].filter(Boolean).join("\n\n");
}
