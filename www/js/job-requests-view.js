import { button, el, field } from "./dom.js";
import { formatQty } from "./cost.js";
import { jobKindLabel, jobQuantity, jobStatus, jobStatusLabel } from "./job-requests.js";

function pill(request) {
  const status = jobStatus(request);
  const tone = status === "tillegg" ? "pill-ok" : status === "besvart" ? "pill-warn" : "pill";
  return el("span", { class: `pill ${tone}` }, jobStatusLabel(request));
}

function photoNode(request) {
  const url = String(request?.photoUrl || "");
  if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1:9199/") && !url.startsWith("http://localhost:9199/")) return null;
  return el("img", { src: url, alt: "Bilde til forespørselen", class: "job-photo" });
}

export function renderJobRequests({ requests = [], onSubmit }) {
  let kind = "pris";
  const pris = el("input", { type: "radio", name: "job-kind", value: "pris", checked: true });
  const bestill = el("input", { type: "radio", name: "job-kind", value: "bestilling" });
  pris.addEventListener("change", () => { kind = "pris"; });
  bestill.addEventListener("change", () => { kind = "bestilling"; });
  const text = el("textarea", {
    rows: "4",
    maxlength: "2000",
    placeholder: "Beskriv arbeidet, for eksempel ni meter ekstra drenering langs garasjen",
  });
  const quantity = el("input", { type: "text", inputmode: "decimal", placeholder: "Valgfritt" });
  const file = el("input", { type: "file", accept: "image/*" });
  const note = el("p", { class: "meta", hidden: true });
  const form = el("form", { class: "request-form" }, [
    el("fieldset", { class: "job-kind" }, [
      el("legend", {}, "Hva vil du?"),
      el("label", { class: "choice" }, [pris, el("span", {}, "Be om pris")]),
      el("label", { class: "choice" }, [bestill, el("span", {}, "Bestill")]),
    ]),
    field("Beskrivelse", text),
    field("Antall, hvis du vet det", quantity),
    field("Bilde, hvis du vil", file),
    el("button", { type: "submit", class: "btn btn-primary" }, "Send forespørsel"),
    note,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const description = text.value.trim();
    if (!description) {
      note.hidden = false;
      note.textContent = "Skriv hva du vil ha gjort.";
      return;
    }
    const qtyText = quantity.value.trim();
    if (qtyText && jobQuantity(qtyText) == null) {
      note.hidden = false;
      note.textContent = "Antallet må være et tall over 0, eller stå tomt.";
      return;
    }
    const submit = form.querySelector("button");
    const sentKind = kind;
    submit.disabled = true;
    note.hidden = false;
    note.textContent = "Sender…";
    try {
      await onSubmit?.({
        kind: sentKind,
        text: description,
        quantity: qtyText,
        file: file.files?.[0] || null,
      });
      text.value = "";
      quantity.value = "";
      file.value = "";
      kind = "pris";
      pris.checked = true;
      note.textContent = sentKind === "bestilling"
        ? "Bestillingen er sendt. Einar ser den og legger den til når den er avklart. Ingen pris er satt."
        : "Forespørselen er sendt. Einar svarer. Ingen pris er satt.";
    } catch (error) {
      console.error(error);
      note.textContent = "Forespørselen ble ikke sendt. Prøv igjen.";
    } finally {
      submit.disabled = false;
    }
  });
  const list = el("div", { class: "request-list" });
  if (!requests.length) list.append(el("p", { class: "meta" }, "Du har ingen forespørsler ennå."));
  for (const request of requests) list.append(customerCard(request));
  return el("section", { class: "request-box" }, [
    el("h2", { class: "h-app" }, "Be om pris eller bestill"),
    el("p", { class: "meta" }, "Be om pris hvis du vil ha et svar først. Bestill hvis du vil at Einar skal ta med arbeidet. Pris settes ikke automatisk."),
    form,
    list,
  ]);
}

function customerCard(request) {
  return el("article", { class: "request-card" }, [
    el("p", {}, [pill(request), " ", jobKindLabel(request)]),
    request.text ? el("p", { class: "pre" }, request.text) : null,
    request.quantity ? el("p", {}, `Antall: ${formatQty(request.quantity)}`) : null,
    photoNode(request),
    request.status === "tillegg" && request.postLabel
      ? el("p", { class: "meta" }, `Lagt til på ${request.postLabel}.`)
      : null,
  ]);
}

export function renderAdminJobRequests({ requests = [], lines = [], onBesvart, onAddTillegg }) {
  const list = el("div", { class: "request-list" });
  if (!requests.length) list.append(el("p", { class: "meta" }, "Ingen forespørsler fra kunden ennå."));
  for (const request of requests) list.append(adminCard(request, lines, onBesvart, onAddTillegg));
  return el("section", { class: "card request-box" }, [
    el("h2", { class: "h-app" }, "Forespørsler fra kunden"),
    el("p", { class: "meta" }, "Ny, besvart, eller lagt til som tillegg. Pris settes ikke her."),
    list,
  ]);
}

function adminCard(request, lines, onBesvart, onAddTillegg) {
  const status = jobStatus(request);
  const body = [
    el("p", {}, [pill(request), " ", jobKindLabel(request)]),
    request.text ? el("p", { class: "pre" }, request.text) : null,
    request.quantity ? el("p", {}, `Antall fra kunden: ${formatQty(request.quantity)}`) : null,
    photoNode(request),
  ];
  if (status === "tillegg") {
    body.push(el("p", { class: "meta" }, request.postLabel
      ? `Lagt til som tillegg på ${request.postLabel}.`
      : "Lagt til som tillegg."));
    return el("article", { class: "request-card" }, body);
  }
  if (status === "ny") {
    body.push(button("Marker som besvart", {
      class: "btn btn-ghost",
      onClick: () => onBesvart?.(request),
    }));
  }
  body.push(addForm(request, lines, onAddTillegg));
  return el("article", { class: "request-card" }, body);
}

function addForm(request, lines, onAddTillegg) {
  const post = el("select", { "aria-label": "Post" });
  post.append(el("option", { value: "" }, "Velg post"));
  for (const line of lines || []) post.append(el("option", { value: line.id }, line.label));
  const quantity = el("input", {
    type: "text",
    inputmode: "decimal",
    value: request.quantity ? formatQty(request.quantity) : "",
    "aria-label": "Antall som tillegg",
  });
  const note = el("p", { class: "meta" }, "");
  const form = el("form", { class: "request-form" }, [
    field("Legg antallet på denne posten", post),
    field("Antall i avtalt tillegg", quantity),
    el("button", { type: "submit", class: "btn btn-primary" }, "Legg til som tillegg"),
    note,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const qty = jobQuantity(quantity.value);
    const line = (lines || []).find((item) => item.id === post.value);
    if (!line) {
      note.textContent = "Velg en post.";
      return;
    }
    if (qty == null) {
      note.textContent = "Skriv antallet som skal legges til.";
      return;
    }
    form.querySelector("button").disabled = true;
    note.textContent = "Legger til…";
    try {
      await onAddTillegg?.(request, { postId: line.id, postLabel: line.label, quantity: qty });
      note.textContent = "Lagt til som tillegg. Ingen pris er endret.";
    } catch (error) {
      console.error(error);
      note.textContent = "Tillegget ble ikke lagret.";
      form.querySelector("button").disabled = false;
    }
  });
  return form;
}
