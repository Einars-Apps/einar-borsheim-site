import { button, el, field } from "./dom.js";
import { canSpeak, dictate } from "./speech.js";
import {
  alternativeHeading,
  alternativePriceText,
  approvedChoiceSum,
  blankOfferFields,
  chosenAlternative,
  formatOfferSum,
  fikenProjectFallback,
  fikenProjectStatus,
  isOfferItem,
  normalizeAlternatives,
  offerStatus,
  offerStatusLabel,
  offerTypeLabel,
  OFFER_KINDS,
} from "./offers.js";

function taleButton(textarea) {
  if (!canSpeak()) return null;
  return button("Tale", {
    class: "btn btn-ghost",
    onClick: async () => {
      try {
        await dictate((spoken) => {
          const base = textarea.value || "";
          const spacer = base && !/\s$/.test(base) ? " " : "";
          textarea.value = `${base}${spacer}${spoken}`;
          textarea.dispatchEvent(new Event("input"));
        });
      } catch (error) {
        console.error(error);
      }
    },
  });
}

export function renderOfferList({ items, project, onOpen, onNew }) {
  const posts = (items || []).filter(isOfferItem);
  const sum = approvedChoiceSum(posts);
  const list = el("div", { class: "stack" });
  if (!posts.length) {
    list.append(el("p", { class: "empty" }, "Ingen poster ennå. En post kan være tilbud, endring eller tillegg, med alternativer kunden velger mellom."));
  }
  for (const item of posts) {
    const status = offerStatus(item);
    const chosen = chosenAlternative(item);
    const row = el("button", { type: "button", class: "row" }, [
      el("span", { class: "row-body" }, [
        el("span", { class: "row-title" }, item.title || offerTypeLabel(item.kind)),
        el("span", { class: "row-text" }, [
          offerTypeLabel(item.kind),
          offerStatusLabel(status),
          status === "godkjent" && chosen ? alternativeHeading(chosen) : "",
          fikenProjectStatus(item, project),
          !item.fikenSynced && item.fikenError ? "Ikke synket til Fiken" : "",
        ].filter(Boolean).join(" · ")),
      ]),
    ]);
    row.addEventListener("click", () => onOpen(item.id));
    list.append(row);
  }
  return el("div", { class: "stack" }, [
    el("section", { class: "card continue" }, [
      el("h2", { class: "h-app" }, "Tilbud og endringer"),
      el("p", { class: "meta" }, "Samme godkjenning som før. Kunden velger ett alternativ. Pris kr 0,00 betyr inkludert."),
      el("p", { class: "pre" }, formatOfferSum(sum)),
      button("Ny post", { class: "btn btn-primary", onClick: onNew }),
    ]),
    list,
  ]);
}

export function renderOfferEditor({ item, project, onSave, onSend, onWithdraw, onFiken, onFikenProject }) {
  const status = offerStatus(item);
  const stored = item.alternatives?.length ? item.alternatives : blankOfferFields().alternatives;
  const alternatives = stored.map((alternative) => ({ ...alternative }));
  const kind = el("select");
  for (const id of OFFER_KINDS) {
    const option = el("option", { value: id }, offerTypeLabel(id));
    if (id === (item.kind || "tilbud")) option.selected = true;
    kind.append(option);
  }
  const rows = el("div", { class: "stack" });
  const fallback = el("textarea", { class: "cost-fallback", rows: "6", readonly: true });
  fallback.hidden = true;
  const note = el("p", { class: "meta" });

  function paintNote() {
    const chosen = chosenAlternative(item);
    if (item.fikenSynced) {
      note.textContent = fikenProjectStatus(item, project);
      return;
    }
    if (item.fikenError) {
      note.textContent = item.fikenError;
      return;
    }
    if (status === "godkjent" && chosen) {
      note.textContent = `Kunden valgte ${alternativeHeading(chosen)}. ${alternativePriceText(chosen)}.`;
      return;
    }
    if (status === "avslatt") {
      note.textContent = "Kunden har avslått. Lag en ny post hvis tilbudet skal endres.";
      return;
    }
    if (status === "sendt") {
      note.textContent = "Sendt til kunden. Venter på valg og godkjenning.";
      return;
    }
    note.textContent = "Utkast. Lagre alternativene, og send posten når den er klar.";
  }

  function readRows() {
    return alternatives.map((alternative) => ({ ...alternative }));
  }

  function drawRows() {
    rows.replaceChildren();
    alternatives.forEach((alternative, index) => {
      const name = el("input", { type: "text", maxlength: "120", value: alternative.name || "" });
      const description = el("textarea", { rows: "2", maxlength: "1000", value: alternative.description || "" });
      const price = el("input", { type: "text", inputmode: "decimal", value: alternative.priceExVat ?? 0 });
      name.addEventListener("input", () => { alternative.name = name.value; });
      description.addEventListener("input", () => { alternative.description = description.value; });
      price.addEventListener("input", () => { alternative.priceExVat = price.value; });
      rows.append(el("article", { class: "note offer-alt" }, [
        el("p", { class: "meta" }, alternativeHeading({ ...alternative, name: alternative.name || "Alternativ" })),
        field("Navn", name),
        field("Beskrivelse", description),
        field("Pris eks. mva (0 = inkludert)", price),
        el("p", { class: "meta" }, alternativePriceText(alternative)),
        alternatives.length > 1
          ? button("Fjern alternativ", {
            class: "btn btn-danger",
            onClick: () => {
              alternatives.splice(index, 1);
              drawRows();
            },
          })
          : null,
      ]));
    });
  }

  async function persist() {
    const next = normalizeAlternatives(readRows());
    if (!next.length) throw new Error("Hvert alternativ trenger et navn.");
    await onSave?.({ kind: kind.value, alternatives: next });
    return next;
  }

  const actions = [
    button("Lagre alternativer", {
      class: "btn btn-primary",
      onClick: async () => {
        try {
          await persist();
          note.textContent = "Alternativene er lagret.";
        } catch (error) {
          note.textContent = error.message || "Kunne ikke lagre.";
        }
      },
    }),
  ];
  if (status === "utkast" || status === "sendt") {
    actions.push(button(status === "sendt" ? "Send på nytt" : "Send til kunde", {
      class: "btn btn-ghost",
      onClick: async () => {
        try {
          await persist();
          await onSend?.();
        } catch (error) {
          note.textContent = error.message || "Kunne ikke sende.";
        }
      },
    }));
  }
  if (status === "sendt") {
    actions.push(button("Trekk tilbake til utkast", {
      class: "btn btn-ghost",
      onClick: () => onWithdraw?.(),
    }));
  }

  const fiken = el("div", { class: "stack" });
  if (status === "godkjent" && chosenAlternative(item)) {
    function showFallback(message) {
      fallback.hidden = false;
      fallback.value = `${message || ""}\n\n${fikenProjectFallback(item, project)}`.trim();
      note.textContent = message || "Fiken-utkastet ble ikke opprettet. Linjene ligger under.";
    }
    async function send(fikenKind) {
      try {
        const result = await onFiken?.(fikenKind);
        if (result?.ok) {
          fallback.hidden = true;
          note.textContent = result.message || "Utkastet er opprettet i Fiken.";
          return;
        }
        throw new Error(result?.message || "Fiken er ikke tilgjengelig");
      } catch (error) {
        console.error(error);
        showFallback(error.message || "Fiken-utkastet ble ikke opprettet. Linjene ligger under.");
      }
    }
    async function sendProject() {
      try {
        const result = await onFikenProject?.();
        if (result?.ok) {
          fallback.hidden = true;
          note.textContent = result.message || fikenProjectStatus(item, project);
          return;
        }
        throw new Error(result?.message || "Fiken er ikke tilgjengelig");
      } catch (error) {
        console.error(error);
        showFallback(error.message || "Posten ble ikke lagt i Fiken-prosjektet. Teksten ligger under.");
      }
    }
    if (item.fikenSynced) {
      fiken.append(el("p", { class: "meta fiken-status" }, fikenProjectStatus(item, project)));
      if (item.fikenDraftId) fiken.append(el("p", { class: "meta" }, `Fakturautkast ${item.fikenDraftId}. Det er ikke sendt.`));
    } else {
      fiken.append(button("Send til Fiken-prosjekt", { class: "btn btn-primary btn-block", onClick: sendProject }));
    }
    fiken.append(el("div", { class: "action-row" }, [
      button("Tilbudsutkast i Fiken", { class: "btn btn-ghost", onClick: () => send("tilbud") }),
      button("Fakturautkast i Fiken", { class: "btn btn-ghost", onClick: () => send("faktura") }),
    ]));
    if (item.fikenError) {
      fallback.hidden = false;
      fallback.value = fikenProjectFallback(item, project);
    }
  } else {
    fiken.append(el("p", { class: "meta" }, "Fiken bruker den godkjente løsningen. Knappene kommer når kunden har valgt."));
  }

  paintNote();
  drawRows();
  return el("section", { class: "card continue offer-editor" }, [
    el("h2", { class: "h-app" }, "Alternativer"),
    el("p", { class: "meta" }, `${offerTypeLabel(item.kind)} · ${offerStatusLabel(status)}. Kunden kan bare velge, ikke endre prisen.`),
    note,
    field("Type", kind),
    rows,
    button("Legg til alternativ", {
      class: "btn btn-ghost",
      onClick: () => {
        if (alternatives.length >= 8) return;
        alternatives.push({ id: `alt-${Date.now().toString(36)}`, name: "", description: "", priceExVat: 0 });
        drawRows();
      },
    }),
    el("div", { class: "action-row" }, actions),
    fiken,
    fallback,
  ]);
}

export function renderFikenProjectBox({ project, onList, onCreate }) {
  const note = el("p", { class: "meta" });
  const picker = el("div", { class: "stack" });
  const linked = project?.fikenProjectId
    ? `Koblet til Fiken-prosjekt ${project.fikenProjectName || project.fikenProjectId}${project.fikenProjectNumber ? ` (${project.fikenProjectNumber})` : ""}.`
    : "Ikke koblet til Fiken ennå. Godkjente poster legges på ett felles fakturautkast for prosjektet du velger.";

  async function loadList() {
    note.textContent = "Henter prosjekter fra Fiken…";
    picker.replaceChildren();
    try {
      const result = await onList?.();
      const projects = result?.projects || [];
      if (!projects.length) {
        note.textContent = "Fiken har ingen åpne prosjekter. Opprett et nytt.";
        return;
      }
      const select = el("select");
      select.append(el("option", { value: "" }, "Velg prosjekt"));
      for (const entry of projects) {
        const label = [entry.name, entry.number, entry.contactName].filter(Boolean).join(" · ");
        select.append(el("option", { value: String(entry.projectId) }, label || String(entry.projectId)));
      }
      picker.append(
        field("Eksisterende Fiken-prosjekt", select),
        button("Bruk valgt prosjekt", {
          class: "btn btn-primary btn-block",
          onClick: async () => {
            if (!select.value) {
              note.textContent = "Velg et prosjekt i listen.";
              return;
            }
            note.textContent = "Kobler til prosjektet…";
            try {
              const linkedProject = await onCreate?.({ fikenProjectId: Number(select.value) });
              note.textContent = linkedProject?.message || "Koblet til Fiken-prosjektet.";
            } catch (error) {
              note.textContent = error.message || "Kunne ikke koble til prosjektet.";
            }
          },
        }),
      );
      note.textContent = `${projects.length} åpne prosjekter i Fiken.`;
    } catch (error) {
      note.textContent = error.message || "Fiken-funksjonen er ikke tilgjengelig.";
    }
  }

  return el("section", { class: "card continue fiken-project" }, [
    el("h2", { class: "h-app" }, "Fiken-prosjekt"),
    el("p", { class: "meta" }, linked),
    el("p", { class: "meta" }, "Godkjente poster samles på ett fakturautkast. Fakturaen sendes ikke av seg selv."),
    el("div", { class: "action-row" }, [
      button("Hent Fiken-prosjekter", { class: "btn btn-ghost", onClick: loadList }),
      button("Opprett Fiken-prosjekt", {
        class: "btn btn-primary",
        onClick: async () => {
          note.textContent = "Oppretter prosjekt i Fiken…";
          try {
            const created = await onCreate?.({ create: true });
            note.textContent = created?.message || "Fiken-prosjektet er opprettet.";
          } catch (error) {
            note.textContent = error.message || "Kunne ikke opprette Fiken-prosjektet.";
          }
        },
      }),
    ]),
    picker,
    note,
  ]);
}

export function renderQuickOrder({ onLocate, onPhotos, onSubmit }) {
  const customerName = el("input", { type: "text", maxlength: "120", autocomplete: "name", placeholder: "Navn" });
  const phone = el("input", { type: "tel", maxlength: "40", autocomplete: "tel", placeholder: "Telefon" });
  const email = el("input", { type: "email", maxlength: "120", autocomplete: "email", placeholder: "E-post" });
  const address = el("input", { type: "text", maxlength: "180", autocomplete: "street-address", placeholder: "Adresse" });
  const description = el("textarea", { rows: "4", maxlength: "4000", placeholder: "Hva skal gjøres?" });
  const price = el("input", { type: "text", inputmode: "decimal", placeholder: "0" });
  const status = el("p", { class: "meta" });
  const photos = [];
  const strip = el("div", { class: "photo-strip" });
  const submit = button("Lag tilbud nå", { type: "submit", class: "btn btn-primary btn-block" });

  function showPhotos() {
    strip.replaceChildren();
    photos.forEach((blob, index) => {
      const url = URL.createObjectURL(blob);
      const remove = button("Fjern", {
        class: "btn btn-ghost",
        onClick: () => {
          photos.splice(index, 1);
          showPhotos();
        },
      });
      strip.append(el("figure", { class: "photo-chip" }, [
        el("img", { src: url, alt: "Bilde til tilbudet" }),
        remove,
      ]));
    });
  }

  async function addPhotos(source) {
    try {
      const blobs = await onPhotos(source);
      photos.push(...blobs);
      showPhotos();
    } catch (error) {
      if (String(error?.message || error).toLowerCase().includes("cancel") || error?.code === "cancel") return;
      console.error(error);
      status.textContent = "Kunne ikke hente bildet. Prøv igjen, eller hopp over bildene.";
    }
  }

  const form = el("form", { class: "screen stack quick-order" }, [
    el("p", { class: "lead" }, "Ett skjermbilde: kunde, sted, hva som skal gjøres, og send tilbudet."),
    field("Kundenavn", customerName),
    field("Telefon", phone),
    field("E-post", email),
    field("Adresse", address),
    button("Bruk min posisjon", {
      type: "button",
      class: "btn btn-ghost btn-block",
      onClick: async () => {
        status.textContent = "Henter posisjon…";
        try {
          const text = await onLocate();
          address.value = text || address.value;
          status.textContent = text ? "Adressen er fylt inn fra posisjonen." : "Fant ingen adresse. Skriv den inn.";
        } catch (error) {
          status.textContent = error.message || "Fikk ikke posisjon. Skriv adressen selv.";
        }
      },
    }),
    field("Kort beskrivelse", description),
    taleButton(description),
    field("Pris på anbefalt løsning, eks. mva", price),
    el("p", { class: "meta" }, "Standardalternativet er kr 0,00 og inkludert. Anbefalt løsning bruker prisen over."),
    el("div", { class: "action-row" }, [
      button("Ta bilde", { type: "button", class: "btn btn-ghost", onClick: () => addPhotos("camera") }),
      button("Fra bilder", { type: "button", class: "btn btn-ghost", onClick: () => addPhotos("gallery") }),
    ]),
    strip,
    status,
    submit,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!customerName.value.trim()) {
      status.textContent = "Skriv kundens navn.";
      customerName.focus();
      return;
    }
    submit.disabled = true;
    status.textContent = "Oppretter tilbudet…";
    try {
      await onSubmit({
        customerName: customerName.value.trim(),
        phone: phone.value.trim(),
        email: email.value.trim(),
        address: address.value.trim(),
        description: description.value.trim(),
        priceExVat: price.value.trim(),
        blobs: photos.slice(),
      });
    } catch (error) {
      console.error(error);
      status.textContent = "Kunne ikke opprette tilbudet. Prøv igjen.";
      submit.disabled = false;
    }
  });
  return form;
}
