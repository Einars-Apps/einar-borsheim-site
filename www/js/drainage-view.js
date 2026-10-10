import { button, el, field } from "./dom.js";
import {
  DRAINAGE_DEFAULTS,
  SOIL_TYPES,
  assessDrainage,
  backfillChoices,
  drainageError,
  formatConductivity,
  formatDistance,
  formatNumber,
  soilById,
  verdictLabel,
} from "./drainage.js";

function textInput(value, placeholder, onInput, extra = {}) {
  const input = el("input", {
    type: extra.type || "text",
    inputmode: extra.inputmode || "",
    value: value ?? "",
    placeholder: placeholder || "",
    maxlength: extra.maxlength || "",
  });
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function numberField(label, value, placeholder, onInput) {
  return field(label, textInput(value, placeholder, onInput, { inputmode: "decimal" }));
}

export function renderDrainageList({ points, onOpen, onNew }) {
  const list = el("div", { class: "stack" });
  if (!points.length) {
    list.append(el("p", { class: "empty" }, "Ingen strekk ennå. Legg inn et målepunkt for grøfta, med masser, vanntest og rør."));
  }
  for (const point of points) {
    const row = el("button", { type: "button", class: "row drainage-row" }, [
      el("span", { class: "row-body" }, [
        el("span", { class: "row-title" }, point.name || "Strekk"),
        el("span", { class: `pill ${pillClass(point.verdict)}` }, verdictLabel(point.verdict)),
      ]),
    ]);
    row.addEventListener("click", () => onOpen(point.id));
    list.append(row);
  }
  return el("div", { class: "stack" }, [
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Drenering"),
      el("p", { class: "meta" }, "Dokumenter hva som er gjort, og hvorfor. Egne målinger kan avvike fra en generell Byggforsk-anbefaling. Da skriver du begrunnelsen, så den følger med i rapporten."),
      button("Nytt strekk", { class: "btn btn-primary", onClick: onNew }),
    ]),
    list,
  ]);
}

function pillClass(verdict) {
  if (verdict === "gronn") return "";
  if (verdict === "gul") return "pill-warn";
  if (verdict === "rod") return "pill-danger";
  return "pill-muted";
}

export function renderDrainageForm({ model, photos, hasClient, onSave, onDelete, onRain }) {
  const state = {
    ...model,
    photoIds: [...(model.photoIds || [])],
    rain: model.rain ? { ...model.rain } : null,
  };
  if (!state.rainDate) state.rainDate = new Date().toISOString().slice(0, 10);
  const result = el("div", { class: "drainage-result" });
  const status = el("p", { class: "meta" });

  const refresh = () => {
    const assessment = assessDrainage(state);
    result.className = `drainage-result verdict verdict-${assessment.verdict || "tom"}`;
    result.replaceChildren(
      el("p", { class: "verdict-title" }, verdictLabel(assessment.verdict)),
      el("p", { class: "pre" }, assessment.summary || "Fyll inn målinger for å se vurderingen."),
    );
    return assessment;
  };

  const soil = el("select");
  for (const type of SOIL_TYPES) {
    const option = el("option", { value: type.id }, type.label);
    if (type.id === state.soilId) option.selected = true;
    soil.append(option);
  }
  const kInput = textInput(state.soilK || String(soilById(state.soilId).kMs), "m/s", (value) => {
    state.soilK = value;
    state.soilKTouched = true;
    refresh();
  }, { inputmode: "decimal" });
  const kHelp = el("p", { class: "meta" });
  const showSoil = () => {
    const type = soilById(state.soilId);
    kHelp.textContent = `${type.label}: typisk ${formatConductivity(type.kMs)} (${type.range}). ${type.source}`;
  };
  soil.addEventListener("change", () => {
    state.soilId = soil.value;
    if (!state.soilKTouched) {
      state.soilK = String(soilById(state.soilId).kMs);
      kInput.value = state.soilK;
    }
    showSoil();
    refresh();
  });
  showSoil();

  const photoBox = el("div", { class: "stack" });
  if (!photos.length) {
    photoBox.append(el("p", { class: "meta" }, "Ingen bilder i prosjektet ennå. Ta bilder fra grava under Bilder, og knytt dem til strekket etterpå."));
  }
  for (const photo of photos) {
    const box = el("input", { type: "checkbox" });
    box.checked = state.photoIds.includes(photo.id);
    box.addEventListener("change", () => {
      state.photoIds = box.checked
        ? [...state.photoIds, photo.id]
        : state.photoIds.filter((id) => id !== photo.id);
    });
    const row = el("label", { class: "checkline" }, [
      box,
      photo.url ? el("img", { src: photo.url, alt: "", class: "drainage-thumb" }) : null,
      el("span", {}, photo.caption || "Bilde fra prosjektet"),
    ]);
    photoBox.append(row);
  }

  const backfill = el("select");
  for (const choice of backfillChoices()) {
    const option = el("option", { value: choice.id }, choice.label);
    if (choice.id === state.backfill) option.selected = true;
    backfill.append(option);
  }
  const backfillNote = textInput(state.backfillNote, "Beskriv massen", (value) => {
    state.backfillNote = value;
    refresh();
  });
  const backfillWrap = field("Beskrivelse av omfylling", backfillNote);
  backfillWrap.hidden = state.backfill !== "annet";
  backfill.addEventListener("change", () => {
    state.backfill = backfill.value;
    backfillWrap.hidden = state.backfill !== "annet";
    refresh();
  });

  const deviate = el("input", { type: "checkbox" });
  deviate.checked = state.deviates === true;
  const reason = el("textarea", { rows: "4", maxlength: "2000", placeholder: "Hva er gjort annerledes, og hvorfor holder det her?" });
  reason.value = state.deviationReason || "";
  const reasonWrap = field("Begrunnelse", reason);
  reasonWrap.hidden = !state.deviates;
  deviate.addEventListener("change", () => {
    state.deviates = deviate.checked;
    reasonWrap.hidden = !state.deviates;
    refresh();
  });
  reason.addEventListener("input", () => {
    state.deviationReason = reason.value;
    refresh();
  });

  const rainNote = el("p", { class: "meta" });
  const showRain = () => {
    if (!state.rain) {
      rainNote.textContent = hasClient
        ? "Hent observert nedbør fra nærmeste målestasjon. Tallene lagres med stasjonsnavn, avstand og tidspunkt."
        : "Frost-klient mangler. Skriv inn millimeter og stasjonsnavn selv.";
      return;
    }
    const distance = formatDistance(state.rain.distanceKm);
    rainNote.textContent = `${state.rain.stationName || "Manuell"}${distance ? `, ${distance}` : ""}. Valgt dato ${formatNumber(state.rain.selectedMm)} mm, 1/3/7 døgn: ${formatNumber(state.rain.last1Mm)} / ${formatNumber(state.rain.last3Mm)} / ${formatNumber(state.rain.last7Mm)} mm.`;
  };

  const dateInput = el("input", { type: "date", value: state.rainDate });
  dateInput.addEventListener("change", () => {
    state.rainDate = dateInput.value;
  });
  const latInput = textInput(state.latitude, String(DRAINAGE_DEFAULTS.askerLatitude), (value) => {
    state.latitude = value;
  }, { inputmode: "decimal" });
  const lonInput = textInput(state.longitude, String(DRAINAGE_DEFAULTS.askerLongitude), (value) => {
    state.longitude = value;
  }, { inputmode: "decimal" });
  const clearRain = button("Bruk manuell nedbør i stedet", {
    class: "btn btn-ghost",
    onClick: () => {
      state.rain = null;
      clearRain.hidden = true;
      showRain();
      refresh();
    },
  });
  clearRain.hidden = !state.rain;

  refresh();
  showRain();

  const actions = [
    button("Lagre strekk", {
      class: "btn btn-primary",
      onClick: () => {
        const error = drainageError(state);
        if (error) {
          status.textContent = error;
          return;
        }
        status.textContent = "";
        onSave(state, assessDrainage(state));
      },
    }),
  ];
  if (onDelete) actions.push(button("Slett strekk", { class: "btn btn-danger", onClick: onDelete }));

  return el("div", { class: "stack" }, [
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Strekk"),
      field("Navn på strekk", textInput(state.name, "For eksempel nordvegg", (value) => {
        state.name = value;
      }, { maxlength: "120" })),
    ]),
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Stedlige masser"),
      field("Massetype", soil),
      field("Vannledningsevne k (m/s)", kInput),
      kHelp,
      field("Merknad", textInput(state.soilNote, "Det du så i grava", (value) => {
        state.soilNote = value;
        refresh();
      }, { maxlength: "500" })),
      el("p", { class: "meta" }, "Knytt bilder som allerede ligger på prosjektet."),
      photoBox,
    ]),
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Utekran og vanntest"),
      el("p", { class: "meta" }, "Mål volum og tid til vannet er borte i grøfta. Det overstyrer et estimat fra slangen. Estimatformelen er Q = Cd·A·√(2Δp/ρ), med Cd = 0,62. Den er et overslag, ikke en måling."),
      numberField("Volum (liter)", state.volumeLiters, "600", (value) => {
        state.volumeLiters = value;
        refresh();
      }),
      numberField("Tid til vannet er borte (minutter)", state.minutes, "4", (value) => {
        state.minutes = value;
        refresh();
      }),
      numberField("Grøftlengde (meter)", state.ditchLengthM, "10", (value) => {
        state.ditchLengthM = value;
        refresh();
      }),
      numberField("Slangediameter (mm), hvis du ikke målte bøtte", state.hoseMm, "13", (value) => {
        state.hoseMm = value;
        refresh();
      }),
      numberField("Trykk (bar)", state.pressureBar, "3", (value) => {
        state.pressureBar = value;
        refresh();
      }),
    ]),
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Rør, fall og tilrenning"),
      el("p", { class: "meta" }, "Rørkapasiteten er Manning for fullt, glatt plastrør. Standard n er 0,011 (litt lavere kapasitet enn 0,010). Fall oppgis i promille. Intensiteten er den du vil sjekke mot, ikke den observerte døgnsummen."),
      numberField("Rørdiameter (mm)", state.pipeDiameterMm, "110", (value) => {
        state.pipeDiameterMm = value;
        refresh();
      }),
      numberField("Fall (promille)", state.slopePerMille, "10", (value) => {
        state.slopePerMille = value;
        refresh();
      }),
      numberField("Rørlengde (meter)", state.pipeLengthM, "20", (value) => {
        state.pipeLengthM = value;
        refresh();
      }),
      field("Omfyllingsmasse", backfill),
      backfillWrap,
      numberField("Manning n", state.manningN, "0,011", (value) => {
        state.manningN = value;
        refresh();
      }),
      numberField("Takareal (m²)", state.roofM2, "120", (value) => {
        state.roofM2 = value;
        refresh();
      }),
      numberField("Avrenningskoeffisient tak", state.roofC, "0,9", (value) => {
        state.roofC = value;
        refresh();
      }),
      numberField("Tomteareal (m²)", state.plotM2, "200", (value) => {
        state.plotM2 = value;
        refresh();
      }),
      numberField("Avrenningskoeffisient tomt", state.plotC, "0,3", (value) => {
        state.plotC = value;
        refresh();
      }),
      numberField("Dimensjonerende nedbør (mm/t)", state.mmPerHour, "20", (value) => {
        state.mmPerHour = value;
        refresh();
      }),
      numberField("Eller intensitet (l/s·ha)", state.litersPerSecondPerHectare, "", (value) => {
        state.litersPerSecondPerHectare = value;
        refresh();
      }),
    ]),
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Nedbør"),
      rainNote,
      field("Dato", dateInput),
      field("Breddegrad", latInput),
      field("Lengdegrad", lonInput),
      el("p", { class: "meta" }, "Utgangspunktet er Asker. Flytt punktet hvis prosjektet ligger et annet sted."),
      button("Bruk telefonens posisjon", {
        class: "btn btn-ghost",
        onClick: () => {
          if (!navigator.geolocation) {
            status.textContent = "Telefonen ga ikke posisjon. Skriv inn breddegrad og lengdegrad.";
            return;
          }
          navigator.geolocation.getCurrentPosition((position) => {
            state.latitude = String(Math.round(position.coords.latitude * 10000) / 10000);
            state.longitude = String(Math.round(position.coords.longitude * 10000) / 10000);
            latInput.value = state.latitude;
            lonInput.value = state.longitude;
          }, () => {
            status.textContent = "Fikk ikke posisjon. Skriv inn breddegrad og lengdegrad.";
          });
        },
      }),
      clearRain,
      button(hasClient ? "Hent nedbør fra Frost" : "Frost er ikke satt opp", {
        class: "btn btn-ghost",
        disabled: !hasClient,
        onClick: async () => {
          status.textContent = "Henter nedbør…";
          try {
            state.rain = await onRain({
              latitude: state.latitude,
              longitude: state.longitude,
              date: state.rainDate,
            });
            clearRain.hidden = false;
            status.textContent = "";
            showRain();
            refresh();
          } catch (error) {
            console.error(error);
            status.textContent = "Kunne ikke hente fra Frost. Skriv inn millimeter og stasjonsnavn under.";
          }
        },
      }),
      numberField("Manuell nedbør på valgt dato (mm)", state.manualMm, "", (value) => {
        state.manualMm = value;
        if (!state.rain) refresh();
      }),
      field("Stasjonsnavn ved manuell føring", textInput(state.manualStation, "For eksempel Asker", (value) => {
        state.manualStation = value;
        if (!state.rain) refresh();
      })),
    ]),
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Vurdering"),
      result,
      el("label", { class: "checkline" }, [
        deviate,
        el("span", {}, "Avviker fra Byggforsk-anbefaling"),
      ]),
      reasonWrap,
      status,
      el("div", { class: "action-row" }, actions),
    ]),
  ]);
}
