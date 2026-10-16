import { button, el } from "./dom.js";
import { formatKr } from "./offers.js";
import { formatQty } from "./cost.js";
import { fikenQuoteFacts, fikenQuoteLines } from "./fiken-offers.js";

function openPdf(url) {
  window.open(url, "_blank", "noopener");
}

export function renderFikenQuoteList({ quotes = [], linked = false, onRefresh } = {}) {
  const cards = [...quotes].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const stack = [
    el("section", { class: "card continue quote-intro" }, [
      el("h2", { class: "h-app" }, "Tilbud"),
      el("p", { class: "meta" }, "Slik tilbudet er skrevet i Fiken. Teksten kan ikke endres her."),
      linked
        ? button("Oppdater fra Fiken", { class: "btn btn-ghost btn-block", onClick: () => onRefresh?.() })
        : el("p", { class: "meta" }, "Koble prosjektet til Fiken for å hente tilbudet."),
    ]),
  ];
  if (!cards.length) {
    stack.push(el("p", { class: "empty" }, "Ingen tilbud fra Fiken ennå."));
    return el("div", { class: "stack" }, stack);
  }
  for (const quote of cards) stack.push(renderFikenQuote(quote));
  return el("div", { class: "stack" }, stack);
}

function renderFikenQuote(quote) {
  const facts = el("dl", { class: "quote-facts" });
  for (const row of fikenQuoteFacts(quote)) {
    facts.append(
      el("div", {}, [
        el("dt", {}, row.label),
        el("dd", {}, row.value),
      ]),
    );
  }
  const lines = el("div", { class: "stack" });
  for (const line of fikenQuoteLines(quote)) {
    const discount = line.discountPercent ? ` Rabatt ${formatQty(line.discountPercent)} %.` : "";
    lines.append(el("article", { class: "qty-line" }, [
      el("p", { class: "cost-line-title" }, line.description),
      line.comment ? el("p", { class: "pre" }, line.comment) : null,
      el("p", {}, `${formatQty(line.quantity)} stk à ${formatKr(line.unitPrice)} eks. mva.${discount}`),
      el("p", { class: "meta" }, `Linjesum ${formatKr(line.net)} eks. mva`),
    ]));
  }
  const pdfUrl = String(quote.pdfUrl || "");
  const pdf = pdfUrl.startsWith("https://")
    ? button(quote.pdfName ? `Åpne PDF i Fiken (${quote.pdfName})` : "Åpne PDF i Fiken", {
      class: "btn btn-primary btn-block",
      onClick: () => openPdf(pdfUrl),
    })
    : null;
  return el("article", { class: "card quote-box" }, [
    el("h3", { class: "h-app" }, quote.number ? `Fiken-tilbud nr ${quote.number}` : "Fiken-tilbud"),
    facts,
    quote.invoiceText ? el("div", {}, [
      el("p", { class: "qty-label" }, "Tekst over linjene"),
      el("p", { class: "pre" }, quote.invoiceText),
    ]) : null,
    quote.comment ? el("div", {}, [
      el("p", { class: "qty-label" }, "Kommentar"),
      el("p", { class: "pre" }, quote.comment),
    ]) : null,
    lines.childNodes.length ? el("h3", { class: "h-app" }, "Linjer") : null,
    lines.childNodes.length ? lines : null,
    quote.discount ? el("p", { class: "meta" }, `Rabatt ${formatKr(quote.discount)}`) : null,
    el("p", { class: "cost-money" }, `Sum eks. mva ${formatKr(quote.exVat || 0)}`),
    el("p", { class: "cost-money" }, `Mva ${formatKr(quote.vat || 0)}`),
    el("p", { class: "cost-money" }, `Sum inkl. mva ${formatKr(quote.incVat || 0)}`),
    pdf,
  ]);
}
