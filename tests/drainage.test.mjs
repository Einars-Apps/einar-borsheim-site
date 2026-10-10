import test from "node:test";
import assert from "node:assert/strict";
import {
  assessDrainage,
  dailyPrecipitation,
  drainageError,
  emptyDrainageForm,
  formatConductivity,
  frostObservationsUrl,
  frostSourcesUrl,
  hoseFlowLitersPerMinute,
  inflowLitersPerSecond,
  manningLitersPerSecond,
  measuredFlowLitersPerMinute,
  millimetersPerHour,
  parseFrostSource,
  rainWindows,
  reportIsPublished,
  resolveFrostClientId,
  soilById,
  verdictFromRatio,
} from "../www/js/drainage.js";

test("bøttetest og slangeformel", () => {
  assert.equal(measuredFlowLitersPerMinute({ liters: 600, minutes: 4 }), 150);
  const hose = hoseFlowLitersPerMinute({ diameterMm: 13, pressureBar: 3 });
  assert.ok(hose > 110 && hose < 130, hose);
  const form = emptyDrainageForm();
  form.volumeLiters = "600";
  form.minutes = "4";
  form.hoseMm = "13";
  form.pressureBar = "3";
  form.ditchLengthM = "10";
  const assessed = assessDrainage(form);
  assert.equal(assessed.usedSource, "malt");
  assert.equal(assessed.usedLpm, 150);
  assert.equal(assessed.perMeter, 15);
});

test("Manning for 110 mm plastrør og tilrenning", () => {
  const flow = manningLitersPerSecond({ diameterMm: 110, slopePerMille: 10, manningN: 0.011 });
  assert.ok(flow > 7 && flow < 9, flow);
  const inflow = inflowLitersPerSecond({ roofM2: 120, plotM2: 0, roofC: 1, plotC: 0, mmPerHour: 20 });
  assert.ok(Math.abs(inflow * 60 - 40) < 0.01);
  assert.equal(millimetersPerHour({ litersPerSecondPerHectare: 20 / 0.36 }), 20);
});

test("grønn, gul og rød margin", () => {
  assert.equal(verdictFromRatio(1.5), "gronn");
  assert.equal(verdictFromRatio(1.2), "gul");
  assert.equal(verdictFromRatio(0.8), "rod");
  const form = emptyDrainageForm();
  form.name = "Nordvegg";
  form.volumeLiters = "600";
  form.minutes = "4";
  form.ditchLengthM = "10";
  form.roofM2 = "120";
  form.roofC = "1";
  form.plotM2 = "0";
  form.mmPerHour = "20";
  const assessed = assessDrainage(form);
  assert.equal(assessed.verdict, "gronn");
  assert.match(assessed.summary, /600 liter/);
  assert.match(assessed.summary, /4 min/);
  assert.match(assessed.summary, /150 l\/min/);
  assert.match(assessed.summary, /15 l\/min per meter/);
  assert.match(assessed.summary, /40 l\/min/);
  assert.match(assessed.summary, /120 m² tak/);
  assert.match(assessed.summary, /god margin/);
});

test("avvik fra Byggforsk krever begrunnelse", () => {
  const form = emptyDrainageForm();
  form.name = "Mot veien";
  form.deviates = true;
  form.deviationReason = "kort";
  assert.match(drainageError(form), /Byggforsk/);
  form.deviationReason = "Grunnen er tett leire, så jeg la ekstra pukk og større fall.";
  assert.equal(drainageError(form), "");
  const summary = assessDrainage(form).summary;
  assert.match(summary, /Avviker fra Byggforsk-anbefaling/);
});

test("massetyper har omtrentlig og navngitt kilde", () => {
  for (const id of ["leire", "silt", "sand", "grus", "fyllmasse", "morene"]) {
    const soil = soilById(id);
    assert.ok(soil.kMs > 0);
    assert.match(soil.source, /Omtrentlig/);
    assert.match(formatConductivity(soil.kMs), /m\/s/);
  }
  assert.ok(soilById("leire").kMs < soilById("sand").kMs);
  assert.ok(soilById("sand").kMs < soilById("grus").kMs);
});

test("Frost-døgn telles én gang, og klienten kommer fra konfig", () => {
  const days = dailyPrecipitation({
    data: [
      {
        referenceTime: "2026-10-10T00:00:00.000Z",
        observations: [
          { timeOffset: "PT18H", value: 9 },
          { timeOffset: "PT6H", value: 1.2 },
        ],
      },
      {
        referenceTime: "2026-10-09T00:00:00.000Z",
        observations: [{ timeOffset: "PT6H", value: 0 }],
      },
      {
        referenceTime: "2026-10-05T00:00:00.000Z",
        observations: [{ timeOffset: "PT6H", value: 0.2 }],
      },
    ],
  });
  assert.equal(days.get("2026-10-10"), 1.2);
  const windows = rainWindows(days, "2026-10-10");
  assert.equal(windows.selectedMm, 1.2);
  assert.equal(windows.last1Mm, 1.2);
  assert.equal(windows.last3Mm, 1.2);
  assert.equal(windows.last7Mm, 1.4);
  const source = parseFrostSource({
    data: [{ id: "SN19718", name: "ASKER BRANNSTASJON II", distance: 0.374 }],
  });
  assert.equal(source.stationId, "SN19718");
  assert.equal(source.stationName, "ASKER BRANNSTASJON II");
  assert.match(frostSourcesUrl(10.435, 59.833), /precipitation_amount/);
  assert.match(decodeURIComponent(frostObservationsUrl("SN19718", "2026-10-03", "2026-10-11")), /sum\(precipitation_amount P1D\)/);
  assert.equal(resolveFrostClientId("", "fra-innstillinger"), "fra-innstillinger");
  assert.equal(resolveFrostClientId("fra-konfig", ""), "fra-konfig");
  assert.equal(resolveFrostClientId("", ""), "");
});

test("kunden ser drenering i portalen bare når rapporten er publisert", () => {
  assert.equal(reportIsPublished({ status: "aktiv", pdfUrl: "https://x" }), false);
  assert.equal(reportIsPublished({ status: "fullfort" }), false);
  assert.equal(reportIsPublished({ status: "fullfort", pdfPath: "projects/a/rapport/sluttrapport.pdf" }), true);
  assert.equal(reportIsPublished({ status: "done", pdfUrl: "https://x" }), true);
});
