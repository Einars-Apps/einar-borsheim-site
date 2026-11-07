import { el, field } from "./dom.js";
import { COST_INFO_NOTE, formatQty } from "./cost.js";
import {
  REQUEST_UNITS,
  customerRequestStatusLabel,
  parseRequestNumber,
  requestPriceLines,
  requestStatus,
  requestStatusLabel,
  requestTotalText,
  requestUnitId,
} from "./requests.js";

function priceTable(request) {
  const rows = requestPriceLines(request);
  if (!rows.length) return null;
  return el("dl", { class: "request-price" }, rows.map(([label, value]) => el("div", {}, [
    el("dt", {}, label),
    el("dd", {}, value),
  ])));
}

function statusPill(request) {
  const status = requestStatus(request);
  const tone = status === "godkjent" ? "pill-ok" : status === "avslatt" ? "pill" : "pill-warn";
  return el("p", {}, el("span", { class: `pill ${tone}` }, requestStatusLabel(request)));
}

export function renderCustomerRequests({ requests = [] } = {}) {
  const list = el("div", { class: "request-list" });
  if (!requests.length) list.append(el("p", { class: "meta" }, "Ingenting ligger her ennå."));
  for (const request of requests) list.append(customerCard(request));
  return el("section", { class: "request-box" }, [
    el("h2", { class: "h-app" }, "Tillegg"),
    el("p", { class: "meta" }, COST_INFO_NOTE),
    el("p", { class: "meta" }, "Det som ligger her, er bare til informasjon. Du bestiller eller godkjenner ikke noe i portalen."),
    list,
  ]);
}

function customerCard(request) {
  const status = requestStatus(request);
  const body = [
    el("p", {}, el("span", { class: "pill" }, customerRequestStatusLabel(request))),
    request.text ? el("p", { class: "pre" }, request.text) : null,
  ];
  if (status === "ny") {
    body.push(el("p", { class: "meta" }, "Einar har fått meldingen. Ingenting er lagt til prisen."));
  } else {
    body.push(el("h3", { class: "request-answer-title" }, "Svar fra Einar"));
    request.answer ? body.push(el("p", { class: "pre" }, request.answer)) : null;
    body.push(priceTable(request));
  }
  if (status === "besvart") {
    body.push(el("p", { class: "meta" }, "Svaret er til informasjon. Ta kontakt med Einar hvis du vil gå videre. Ingenting legges til før dere er enige."));
  }
  if (status === "godkjent") {
    body.push(el("p", { class: "meta" }, "Dette er tatt med i kostnaden."));
  }
  if (status === "avslatt") {
    body.push(el("p", { class: "meta" }, "Dette ble ikke tatt med. Prisen ble ikke endret."));
  }
  return el("article", { class: "request-card" }, body);
}

function unitIdFromLine(line) {
  const hint = String(line?.label || "").match(/\(([^)]+)\)\s*$/);
  return requestUnitId(hint?.[1] || line?.unit || "stk");
}

export function renderAdminRequests({ requests = [], lines = [], onAnswer }) {
  const list = el("div", { class: "request-list" });
  if (!requests.length) list.append(el("p", { class: "meta" }, "Ingen forespørsler fra kunden ennå."));
  for (const request of requests) list.append(adminCard(request, lines, onAnswer));
  return el("section", { class: "card request-box", id: "seksjon-foresporsler" }, [
    el("h2", { class: "h-app" }, "Forespørsler om tillegg"),
    el("p", { class: "meta" }, "Svar med en forklaring og en prislinje. Kunden ser svaret som informasjon og kan ikke godkjenne i portalen. Avtalt mengde legger du inn selv under Avtalt tillegg, eller som en ny post."),
    list,
  ]);
}

function adminCard(request, lines, onAnswer) {
  const status = requestStatus(request);
  const body = [
    statusPill(request),
    request.text ? el("p", { class: "pre" }, request.text) : null,
  ];
  if (status === "ny") body.push(answerForm(request, lines, onAnswer));
  else {
    request.answer ? body.push(el("p", { class: "pre" }, request.answer)) : null;
    body.push(priceTable(request));
    if (status === "besvart") body.push(el("p", { class: "meta" }, "Svaret ligger hos kunden som informasjon."));
    if (status === "godkjent") {
      body.push(el("p", { class: "meta" }, request.appliedAt
        ? "Godkjent og lagt inn i kostnaden."
        : "Godkjent. Legges inn i kostnaden."));
    }
    if (status === "avslatt") body.push(el("p", { class: "meta" }, "Kunden avslo. Prisen er ikke endret."));
  }
  return el("article", { class: "request-card" }, body);
}

function answerForm(request, lines, onAnswer) {
  const answer = el("textarea", { rows: "3", maxlength: "2000", placeholder: "Forklar hva du foreslår" });
  const post = el("select", { "aria-label": "Knytt til post" });
  post.append(el("option", { value: "" }, "Ny post"));
  for (const line of lines || []) post.append(el("option", { value: line.id }, line.label));
  const name = el("input", { type: "text", maxlength: "200", "aria-label": "Navn på posten" });
  const unit = el("select", { "aria-label": "Enhet" });
  for (const item of REQUEST_UNITS) unit.append(el("option", { value: item.id }, item.label));
  const quantity = el("input", { type: "text", inputmode: "decimal", value: "1", "aria-label": "Antall" });
  const price = el("input", { type: "text", inputmode: "decimal", value: "0", "aria-label": "Enhetspris eks. mva" });
  const sum = el("p", { class: "request-sum" }, "");
  const note = el("p", { class: "meta" }, "");
  function paintSum() {
    const qty = parseRequestNumber(quantity.value);
    const unitPrice = parseRequestNumber(price.value);
    sum.textContent = qty != null && unitPrice != null
      ? `Sum ${requestTotalText(qty, unitPrice)}`
      : "Skriv antall og pris.";
  }
  function applyLine(id) {
    const line = (lines || []).find((item) => item.id === id);
    if (!line) return;
    name.value = line.label || "";
    unit.value = unitIdFromLine(line);
    price.value = formatQty(line.unitPrice || 0);
    paintSum();
  }
  post.addEventListener("change", () => applyLine(post.value));
  quantity.addEventListener("input", paintSum);
  price.addEventListener("input", paintSum);
  paintSum();
  const form = el("form", { class: "request-form" }, [
    field("Forklaring til kunden", answer),
    field("Post", post),
    field("Navn på posten", name),
    field("Enhet", unit),
    field("Antall", quantity),
    field("Enhetspris, kr eks. mva", price),
    sum,
    el("p", { class: "meta" }, "Ny post får denne enhetsprisen. En post som finnes fra før får antallet i Avtalt tillegg."),
    el("button", { type: "submit", class: "btn btn-primary" }, "Send svar"),
    note,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const qty = parseRequestNumber(quantity.value);
    const unitPrice = parseRequestNumber(price.value);
    if (!answer.value.trim()) {
      note.textContent = "Skriv en forklaring.";
      return;
    }
    if (!name.value.trim()) {
      note.textContent = "Skriv navn på posten.";
      return;
    }
    if (qty == null || qty <= 0 || unitPrice == null) {
      note.textContent = "Skriv antall og enhetspris.";
      return;
    }
    form.querySelector("button").disabled = true;
    note.textContent = "Sender svaret…";
    try {
      await onAnswer?.(request, {
        answer: answer.value.trim(),
        postId: post.value,
        postName: name.value.trim(),
        unit: unit.value,
        quantity: qty,
        unitPrice,
      });
      note.textContent = "Svaret er sendt. Kunden ser det som informasjon.";
    } catch (error) {
      console.error(error);
      note.textContent = "Svaret ble ikke sendt.";
      form.querySelector("button").disabled = false;
    }
  });
  return form;
}
