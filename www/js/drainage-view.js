import { button, el, field } from "./dom.js";
import {
  DRAINAGE_DEFAULTS,
  DEFAULT_PRICES,
  SOIL_TYPES,
  WELL_TYPES,
  assessDrainage,
  assessWell,
  backfillChoices,
  buildWhy,
  costCsv,
  costTotals,
  drainageError,
  emptyWell,
  formatConductivity,
  formatCost,
  formatDistance,
  formatMoney,
  formatNumber,
  parseNumber,
  soilById,
  suggestStretchLines,
  suggestWellLines,
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
        point.wells?.length ? el("span", { class: "meta" }, point.wells.length === 1 ? "1 brønn" : `${point.wells.length} brønner`) : null,
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

export function renderDrainageForm({ model, photos, hasClient, prices, defaultReference, onSave, onDelete, onRain, onSavePrices, onFiken, onCreateOffer }) {
  const state = {
    ...model,
    photoIds: [...(model.photoIds || [])],
    rain: model.rain ? { ...model.rain } : null,
    why: model.why ? structuredClone(model.why) : null,
    wells: (model.wells || []).map((well) => ({ ...well, costLines: well.costLines ? well.costLines.map((line) => ({ ...line })) : null })),
    costLines: model.costLines ? model.costLines.map((line) => ({ ...line })) : null,
    prices: prices || DEFAULT_PRICES,
    defaultReference: defaultReference || "",
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
    state.syncWhy?.(assessment);
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
    whySection(state, refresh, defaultReference),
    wellsSection(state),
    costSection(state, { onSavePrices, onFiken, onCreateOffer }),
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

function verdictSelect(value, onChange) {
  const select = el("select", { class: "verdict-select" });
  for (const [id, label] of [["gronn", "Grønn"], ["gul", "Gul"], ["rod", "Rød"]]) {
    const option = el("option", { value: id }, label);
    if (id === value) option.selected = true;
    select.append(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function whySection(state, refresh, defaultReference) {
  const reference = el("textarea", { rows: "4" });
  const conclusion = el("textarea", { rows: "3" });
  const body = el("div", { class: "why-rows" });
  const root = el("section", { class: "card continue" });
  const fields = [];

  function write() {
    const why = state.why || { reference: "", rows: [], conclusion: "" };
    if (document.activeElement !== reference) reference.value = why.reference || "";
    if (document.activeElement !== conclusion) conclusion.value = why.conclusion || "";
    if (fields.length !== (why.rows || []).length) buildRows(why);
    else {
      why.rows.forEach((row, index) => {
        const field = fields[index];
        if (document.activeElement !== field.einar) field.einar.value = row.einar || "";
        if (document.activeElement !== field.byggforsk) field.byggforsk.value = row.byggforsk || "";
        if (document.activeElement !== field.verdict) field.verdict.value = row.verdict || "gul";
      });
    }
  }

  function buildRows(why) {
    fields.length = 0;
    body.replaceChildren();
    (why.rows || []).forEach((row, index) => {
      const einar = el("textarea", { rows: "3" });
      const byggforsk = el("textarea", { rows: "3" });
      einar.value = row.einar || "";
      byggforsk.value = row.byggforsk || "";
      const mark = (key, node) => {
        node.addEventListener("input", () => {
          if (state.why?.rows?.[index]) state.why.rows[index][key] = node.value;
          state.whyEdited = true;
        });
      };
      mark("einar", einar);
      mark("byggforsk", byggforsk);
      const verdict = verdictSelect(row.verdict, (value) => {
        if (state.why?.rows?.[index]) state.why.rows[index].verdict = value;
        state.whyEdited = true;
        article.className = `why-row verdict-${value || "gul"}`;
      });
      fields.push({ einar, byggforsk, verdict });
      const article = el("article", { class: `why-row verdict-${row.verdict || "gul"}` }, [
        el("h3", { class: "h-app" }, row.topic || "Tema"),
        verdict,
        field("Einars løsning", einar),
        field("Byggforsk, generelt", byggforsk),
      ]);
      body.append(article);
    });
  }

  reference.addEventListener("input", () => {
    state.why.reference = reference.value;
    state.whyEdited = true;
  });
  conclusion.addEventListener("input", () => {
    state.why.conclusion = conclusion.value;
    state.whyEdited = true;
  });
  state.syncWhy = (assessment) => {
    if (state.whyEdited) return;
    if (root.contains(document.activeElement)) return;
    state.why = buildWhy(state, assessment, defaultReference || "");
    write();
  };
  state.why = state.why || buildWhy(state, assessDrainage(state), defaultReference || "");
  write();
  root.append(
    el("h2", { class: "h-app" }, "Hvorfor denne løsningen"),
    el("p", { class: "meta" }, "Sammenligningen er en generell Byggforsk-praksis, ikke et sitert blad. Teksten kan endres. Oppdater forslaget når målingene er fylt inn."),
    field("Byggforsk-referanse", reference),
    body,
    field("Konklusjon", conclusion),
    button("Oppdater forslaget fra målingene", {
      class: "btn btn-ghost",
      onClick: () => {
        state.why = buildWhy(state, assessDrainage(state), defaultReference || "");
        state.whyEdited = true;
        write();
        refresh();
      },
    }),
  );
  return root;
}

function stretchContext(state) {
  return {
    soilK: parseNumber(state.soilK) || soilById(state.soilId).kMs,
    mmPerHour: parseNumber(state.mmPerHour),
    roofM2: parseNumber(state.roofM2) || 0,
    plotM2: parseNumber(state.plotM2) || 0,
    roofC: parseNumber(state.roofC) ?? DRAINAGE_DEFAULTS.roofCoefficient,
    plotC: parseNumber(state.plotC) ?? DRAINAGE_DEFAULTS.plotCoefficient,
  };
}

function wellsSection(state) {
  const host = el("div", { class: "stack" });
  function addCard(well) {
    const live = el("div");
    const paint = () => {
      const result = assessWell(well, stretchContext(state));
      const lines = well.costLines || suggestWellLines(well, result, state.prices);
      const costText = formatCost({ lines, ...costTotals(lines) }, "Kostnad for brønnen");
      live.className = `verdict verdict-${result.verdict || "tom"}`;
      live.replaceChildren(
        el("p", { class: "verdict-title" }, verdictLabel(result.verdict) || "Venter på mål"),
        el("p", { class: "pre" }, result.summary),
        costText ? el("p", { class: "pre" }, costText) : null,
      );
      state.syncCost?.();
    };
    const shape = el("select");
    for (const [id, label] of [["sirkel", "Sirkel, diameter"], ["rektangel", "Rektangel, lengde × bredde"]]) {
      const option = el("option", { value: id }, label);
      if (well.shape === id) option.selected = true;
      shape.append(option);
    }
    const kind = el("select");
    for (const type of WELL_TYPES) {
      const option = el("option", { value: type.id }, `${type.label} (porevolum ${formatNumber(type.pore, 2)})`);
      if (well.kind === type.id) option.selected = true;
      kind.append(option);
    }
    const diameter = field("Diameter (m)", textInput(well.diameterM, "1", (value) => {
      well.diameterM = value;
      paint();
    }, { inputmode: "decimal" }));
    const length = field("Lengde (m)", textInput(well.lengthM, "1,2", (value) => {
      well.lengthM = value;
      paint();
    }, { inputmode: "decimal" }));
    const width = field("Bredde (m)", textInput(well.widthM, "0,8", (value) => {
      well.widthM = value;
      paint();
    }, { inputmode: "decimal" }));
    const showShape = () => {
      const circle = shape.value !== "rektangel";
      diameter.hidden = !circle;
      length.hidden = circle;
      width.hidden = circle;
    };
    shape.addEventListener("change", () => {
      well.shape = shape.value;
      showShape();
      paint();
    });
    kind.addEventListener("change", () => {
      well.kind = kind.value;
      if (!well.poreTouched) {
        well.pore = String(WELL_TYPES.find((type) => type.id === kind.value)?.pore ?? 1);
        pore.value = well.pore;
      }
      paint();
    });
    const pore = textInput(well.pore, "0,3", (value) => {
      well.pore = value;
      well.poreTouched = true;
      paint();
    }, { inputmode: "decimal" });
    const card = el("article", { class: "note" }, [
      field("Navn", textInput(well.name, "Brønn ved nedløp", (value) => {
        well.name = value;
      })),
      field("Form", shape),
      numberField("Dybde (m)", well.depthM, "0,7", (value) => {
        well.depthM = value;
        paint();
      }),
      diameter,
      length,
      width,
      field("Type", kind),
      field("Porevolum (0–1)", pore),
      el("p", { class: "meta" }, "Betongring er åpen (1). Plastkassett er nesten åpen (0,95). Pukkmagasin regnes med 0,3 om ikke du endrer det. Tomme felt for areal og regn bruker strekket."),
      numberField("Målt infiltrasjon (liter/time)", well.measuredLph, "Tom = regn ut fra k-verdi", (value) => {
        well.measuredLph = value;
        paint();
      }),
      numberField("Egen k-verdi (m/s), hvis den skiller seg fra strekket", well.soilK, "", (value) => {
        well.soilK = value;
        paint();
      }),
      numberField("Tilkoblet tak (m²)", well.roofM2, "Tom = strekket", (value) => {
        well.roofM2 = value;
        paint();
      }),
      numberField("Tilkoblet tomt (m²)", well.plotM2, "", (value) => {
        well.plotM2 = value;
        paint();
      }),
      numberField("Regn på brønnen (mm/t)", well.mmPerHour, "Tom = strekket", (value) => {
        well.mmPerHour = value;
        paint();
      }),
      numberField("Varighet på skuren (timer)", well.stormHours, "1", (value) => {
        well.stormHours = value;
        paint();
      }),
      live,
      button("Fjern brønn", {
        class: "btn btn-danger",
        onClick: () => {
          state.wells = state.wells.filter((item) => item !== well);
          card.remove();
        },
      }),
    ]);
    showShape();
    paint();
    host.append(card);
  }
  for (const well of state.wells) addCard(well);
  return el("section", { class: "card continue" }, [
    el("h2", { class: "h-app" }, "Fordrøyningsbrønn"),
    el("p", { class: "meta" }, "Brønnen hører til dette strekket. Volumet er porevolum ganger gropt. Tømmingen er målt rate, eller k-verdi ganger arealet av bunn og sider."),
    host,
    button("Legg til brønn", {
      class: "btn btn-ghost",
      onClick: () => {
        const well = emptyWell();
        state.wells.push(well);
        addCard(well);
      },
    }),
  ]);
}

function costSection(state, { onSavePrices, onFiken, onCreateOffer }) {
  state.costLines = state.costLines || suggestStretchLines(state, state.prices);
  const totals = el("p", { class: "pre" });
  const fallback = el("textarea", { rows: "8", readonly: true });
  fallback.hidden = true;
  function billableLines() {
    const stretch = state.costLines.map((line) => ({ ...line }));
    const fromWells = [];
    for (const well of state.wells || []) {
      const result = assessWell(well, stretchContext(state));
      const lines = well.costLines || suggestWellLines(well, result, state.prices);
      for (const line of lines) {
        if (!(parseNumber(line.quantity) > 0)) continue;
        fromWells.push({ ...line, label: `${well.name || "Brønn"}: ${line.label}` });
      }
    }
    return stretch.concat(fromWells);
  }
  const paint = () => {
    const stretch = costTotals(state.costLines);
    const all = costTotals(billableLines());
    const stretchText = `Eks. mva ${formatMoney(stretch.exVat)}\nMva 25 % ${formatMoney(stretch.vat)}\nInkl. mva ${formatMoney(stretch.incVat)}`;
    totals.textContent = stretch.incVat === all.incVat
      ? stretchText
      : `${stretchText}\n\nMed brønner: eks. mva ${formatMoney(all.exVat)}, mva ${formatMoney(all.vat)}, inkl. mva ${formatMoney(all.incVat)}`;
  };
  state.syncCost = paint;
  const rows = el("div", { class: "stack" });
  for (const line of state.costLines) {
    rows.append(el("div", { class: "cost-line" }, [
      el("strong", {}, `${line.label} (${line.unit})`),
      field("Antall", textInput(line.quantity, "0", (value) => {
        line.quantity = value;
        paint();
      }, { inputmode: "decimal" })),
      field("Enhetspris eks. mva", textInput(line.unitPrice, "0", (value) => {
        line.unitPrice = value;
        paint();
      }, { inputmode: "decimal" })),
    ]));
  }
  paint();
  function exportText() {
    const lines = billableLines();
    const cost = { lines, ...costTotals(lines) };
    return `${formatCost(cost, state.name || "Kostnad")}\n\n${costCsv(lines)}`;
  }
  async function send(kind) {
    const lines = billableLines();
    try {
      const result = await onFiken?.({ kind, lines, title: state.name || "Drenering" });
      if (result?.ok) {
        fallback.hidden = true;
        paint();
        totals.textContent = `${totals.textContent}\n\n${result.message || "Utkastet er opprettet i Fiken."}`;
        return;
      }
      throw new Error(result?.message || "Fiken er ikke tilgjengelig");
    } catch (error) {
      console.error(error);
      fallback.hidden = false;
      fallback.value = exportText();
      const detail = error?.message ? ` ${error.message}` : "";
      totals.textContent = `Fiken-utkastet ble ikke opprettet. Linjene ligger under, klare til å limes inn.${detail}`;
    }
  }
  return el("section", { class: "card continue" }, [
    el("h2", { class: "h-app" }, "Kostnad"),
    el("p", { class: "meta" }, "Enhetsprisene er startverdier du kan endre. Lagre dem som standard, så brukes de neste gang. Summene er eks. og inkl. 25 % mva."),
    rows,
    totals,
    el("div", { class: "action-row" }, [
      button("Lagre som standardpriser", {
        class: "btn btn-ghost",
        onClick: async () => {
          try {
            const next = await onSavePrices?.(state.costLines);
            if (next) state.prices = next;
            paint();
            totals.textContent = `${totals.textContent}\n\nStandardprisene er lagret.`;
          } catch (error) {
            console.error(error);
            totals.textContent = "Kunne ikke lagre standardprisene.";
          }
        },
      }),
      button("Hent rørlengde inn i antall", {
        class: "btn btn-ghost",
        onClick: () => {
          const line = state.costLines.find((item) => item.id === "drensror");
          if (line) line.quantity = state.pipeLengthM || "";
          const input = rows.querySelectorAll("input");
          const index = state.costLines.indexOf(line);
          if (input[index * 2]) input[index * 2].value = line.quantity;
          paint();
        },
      }),
      button("Lag post i Tilbud og endringer", {
        class: "btn btn-primary",
        onClick: async () => {
          try {
            await onCreateOffer?.(state);
          } catch (error) {
            console.error(error);
          }
        },
      }),
      button("Tilbudsutkast i Fiken", { class: "btn btn-ghost", onClick: () => send("tilbud") }),
      button("Fakturautkast i Fiken", { class: "btn btn-ghost", onClick: () => send("faktura") }),
      button("Kopier linjer", {
        class: "btn btn-ghost",
        onClick: async () => {
          const text = fallback.value || exportText();
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            console.error(error);
          }
          fallback.hidden = false;
          fallback.className = "cost-fallback";
          if (!fallback.value) fallback.value = exportText();
        },
      }),
    ]),
    fallback,
  ]);
}
