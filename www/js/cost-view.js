import { button, el, field } from "./dom.js";
import { formatKr } from "./offers.js";
import { formatQty, signedKr, signedQty } from "./cost.js";

function moneyLine(label, exVat, incVat) {
  return el("p", { class: "cost-money" }, `${label}: ${formatKr(exVat)} eks. mva, ${formatKr(incVat)} inkl. mva`);
}

function stepper(value, label, onCommit) {
  const input = el("input", {
    type: "text",
    inputmode: "decimal",
    "aria-label": label,
    value: formatQty(value),
  });
  let dirty = false;
  input.addEventListener("input", () => { dirty = true; });
  const commit = () => {
    if (!dirty) return;
    dirty = false;
    onCommit(input.value);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  const shown = () => {
    const parsed = Number(String(input.value).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number(value) || 0;
  };
  const minus = button("−", {
    class: "btn btn-ghost qty-btn",
    onClick: () => {
      dirty = false;
      const next = Math.max(0, Math.round((shown() - 1) * 100) / 100);
      input.blur();
      onCommit(next);
    },
  });
  const plus = button("+", {
    class: "btn btn-ghost qty-btn",
    onClick: () => {
      dirty = false;
      const next = Math.round((shown() + 1) * 100) / 100;
      input.blur();
      onCommit(next);
    },
  });
  minus.addEventListener("mousedown", (event) => event.preventDefault());
  plus.addEventListener("mousedown", (event) => event.preventDefault());
  minus.setAttribute("aria-label", `Mindre ${label}`);
  plus.setAttribute("aria-label", `Mer ${label}`);
  return el("div", { class: "qty-step" }, [minus, input, plus]);
}

export function renderCostOverview({
  summary,
  history = [],
  editable = false,
  showPreview = false,
  showToCustomer = false,
  extras = [],
  onAgreed,
  onQuantity,
}) {
  const diffClass = summary.differenceExVat > 0 ? "cost-diff-up" : summary.differenceExVat < 0 ? "cost-diff-down" : "meta";
  const approved = (summary.offers?.rows || []).filter((row) => row.status === "godkjent");
  const agreed = editable
    ? field("Avtalt pris / grunntilbud, eks. mva", (() => {
      const input = el("input", { type: "text", inputmode: "decimal", value: formatQty(summary.agreedExVat) });
      let dirty = false;
      input.addEventListener("input", () => { dirty = true; });
      const commit = () => {
        if (!dirty) return;
        dirty = false;
        onAgreed?.(input.value);
      };
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);
      return input;
    })())
    : el("p", { class: "meta" }, `Avtalt pris / grunntilbud: ${formatKr(summary.agreedExVat)} eks. mva`);

  const lines = el("div", { class: "cost-lines" });
  const ordered = [
    ...summary.lines.filter((line) => line.fromFiken),
    ...summary.lines.filter((line) => !line.fromFiken),
  ];
  for (const line of ordered) {
    const deviation = `${signedQty(line.deviation)} ${line.unit}`;
    const body = [
      el("p", { class: "cost-line-title" }, line.label),
      line.source ? el("p", { class: "meta" }, line.source) : null,
      editable && line.fromFiken ? null : el("p", { class: "meta" }, `à ${formatKr(line.unitPrice)} eks. mva`),
    ];
    if (editable && line.fromFiken) {
      const price = el("input", {
        type: "text",
        inputmode: "decimal",
        value: formatQty(line.unitPrice),
        "aria-label": `Enhetspris ${line.label}`,
      });
      let priceDirty = false;
      price.addEventListener("input", () => { priceDirty = true; });
      const commitPrice = () => {
        if (!priceDirty) return;
        priceDirty = false;
        onQuantity?.(line.id, "unitPrice", price.value);
      };
      price.addEventListener("change", commitPrice);
      price.addEventListener("blur", commitPrice);
      body.push(field("Enhetspris, eks. mva", price));
    }
    if (editable) {
      body.push(
        el("p", { class: "qty-label" }, `Planlagt, ${line.unit}`),
        stepper(line.planned, `Planlagt ${line.label}`, (value) => onQuantity?.(line.id, "planned", value)),
        el("p", { class: "qty-label" }, `Utført hittil, ${line.unit}`),
        stepper(line.done, `Utført ${line.label}`, (value) => onQuantity?.(line.id, "done", value)),
      );
    } else {
      body.push(el("p", {}, `Planlagt ${formatQty(line.planned)} ${line.unit}. Utført ${formatQty(line.done)} ${line.unit}.`));
    }
    body.push(
      el("p", { class: "meta" }, `Avvik ${deviation}. Estimert ${formatKr(line.plannedSum)}. Påløpt ${formatKr(line.doneSum)}.`),
    );
    lines.append(el("article", { class: "qty-line" }, body));
  }

  const log = el("ol", { class: "cost-log" });
  if (!history.length) log.append(el("li", {}, "Ingen endringer er logget ennå."));
  for (const entry of history.slice(0, 15)) {
    log.append(el("li", {}, [entry.when, entry.byName || "Einar", entry.text].filter(Boolean).join(" · ")));
  }

  return el("section", { class: "card continue cost-box" }, [
    el("h2", { class: "h-app" }, "Nåværende kostnad"),
    el("p", { class: "meta" }, editable
      ? (showToCustomer
        ? "Mengdene oppdateres med en gang. Kunden ser det samme, men kan ikke endre tallene."
        : "Mengdene oppdateres med en gang. Kunden ser ikke denne oversikten.")
      : "Einar oppdaterer mengdene. Du kan ikke endre mengder eller priser."),
    ...extras,
    agreed,
    approved.length
      ? el("div", { class: "stack" }, approved.map((row) => el("p", { class: "meta" }, `Godkjent: ${row.title}${row.name ? ` – ${row.name}` : ""} ${formatKr(row.exVat)} eks. mva`)))
      : el("p", { class: "meta" }, "Ingen godkjente poster i Tilbud og endringer ennå."),
    moneyLine("Estimert total", summary.estimated.exVat, summary.estimated.incVat),
    moneyLine("Påløpt hittil", summary.incurred.exVat, summary.incurred.incVat),
    el("p", { class: diffClass }, `Differanse mot opprinnelig tilbud: ${signedKr(summary.differenceExVat)} eks. mva, ${signedKr(summary.differenceIncVat)} inkl. mva`),
    showPreview && summary.previewDeltaExVat
      ? el("p", { class: "cost-preview" }, `Forhåndsvisning hvis du godkjenner valget: ${formatKr(summary.preview.exVat)} eks. mva, ${formatKr(summary.preview.incVat)} inkl. mva. Det er ${signedKr(summary.previewDeltaExVat)} eks. mva mot nåværende estimat.`)
      : null,
    lines,
    el("h3", { class: "h-app" }, "Historikk"),
    log,
    history.length > 15 ? el("p", { class: "meta" }, "Hele historikken ligger i PDF-rapporten.") : null,
  ]);
}
