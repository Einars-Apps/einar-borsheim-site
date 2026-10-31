import { button, el, field, icon } from "./dom.js";
import { formatKr } from "./offers.js";
import { householdAllocation } from "./households.js";
import { renderHouseholdAllocation } from "./household-view.js";
import {
  formatQty,
  nextInstallmentNumber,
  partialFinalText,
  paymentBalance,
  paymentInstallments,
  paymentProgress,
  paymentStatusLabel,
  paymentTotals,
  signedKr,
  signedQty,
} from "./cost.js";
import { buildCustomerHistory, customerPostSummary, extraTilleggText, unitWord } from "./cost-history.js";
import { formatDay } from "./logic.js";

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
  const step = el("div", { class: "qty-step" }, [minus, input, plus]);
  return step;
}

function lockStepper(step) {
  step.classList.add("is-locked");
  step.querySelectorAll("button, input").forEach((node) => { node.disabled = true; });
  return step;
}

function confirmUnlock(label, onYes) {
  document.querySelector(".unlock-dialog")?.remove();
  const root = el("div", { class: "sheet-back unlock-dialog" }, [
    el("div", {
      class: "sheet",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "unlock-title",
    }, [
      el("h2", { id: "unlock-title" }, "Låse opp endelig pris?"),
      el("p", {}, `${label} er merket ferdig. Prisen er endelig og kan være fakturert. Hvis du låser opp, kan tallene endres igjen. Endringen blir logget.`),
      el("div", { class: "payment-actions" }, [
        button("Avbryt", { class: "btn btn-ghost", onClick: () => root.remove() }),
        button("Lås opp likevel", {
          class: "btn btn-danger",
          onClick: () => {
            root.remove();
            onYes();
          },
        }),
      ]),
    ]),
  ]);
  document.body.append(root);
  root.querySelector("button")?.focus();
}

function parseAmount(value) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

function todayInputValue() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function householdCaption(payment, households) {
  if (!households?.length) return "";
  const id = String(payment?.householdId || "");
  const match = households.find((row) => row.id === id);
  if (match) return `Husstand: ${match.name}`;
  return "Fordeles etter andel";
}

function paymentForm(onAddPayment, nextNumber, households = []) {
  const date = el("input", { type: "date", required: true, value: todayInputValue(), "aria-label": "Dato" });
  const amount = el("input", { type: "text", inputmode: "decimal", "aria-label": "Beløp" });
  const inkl = el("input", { type: "radio", name: "payment-vat", value: "inkl" });
  const eks = el("input", { type: "radio", name: "payment-vat", value: "eks" });
  const sendt = el("input", { type: "radio", name: "payment-status", value: "sendt" });
  const betalt = el("input", { type: "radio", name: "payment-status", value: "betalt" });
  sendt.checked = true;
  const invoice = el("input", { type: "text", maxlength: "39", "aria-label": "Fakturanummer" });
  const note = el("input", { type: "text", maxlength: "299", "aria-label": "Notat" });
  const finalInvoice = el("input", { type: "checkbox" });
  const household = el("select", { "aria-label": "Husstand" });
  household.append(el("option", { value: "" }, "Fordeles etter andel"));
  for (const row of households) household.append(el("option", { value: row.id }, row.name));
  const status = el("p", { class: "meta", role: "status" });
  const panel = el("form", { class: "payment-form", hidden: true }, [
    el("p", { class: "payment-amount" }, `Delfaktura ${nextNumber}`),
    field("Beløp", amount),
    el("fieldset", { class: "payment-vat" }, [
      el("legend", {}, "Er beløpet inkl. eller eks. mva?"),
      el("label", { class: "checkline" }, [inkl, el("span", {}, "Inkl. mva")]),
      el("label", { class: "checkline" }, [eks, el("span", {}, "Eks. mva")]),
    ]),
    field("Dato", date),
    field("Fakturanummer (valgfritt)", invoice),
    el("fieldset", { class: "payment-vat" }, [
      el("legend", {}, "Status"),
      el("label", { class: "checkline" }, [sendt, el("span", {}, "Sendt")]),
      el("label", { class: "checkline" }, [betalt, el("span", {}, "Betalt")]),
    ]),
    households.length ? field("Husstand (valgfritt)", household) : null,
    el("label", { class: "checkline" }, [finalInvoice, el("span", {}, "Dette er sluttfakturaen")]),
    field("Notat (valgfritt)", note),
    status,
    button("Lagre delfaktura", { class: "btn btn-primary btn-block", type: "submit" }),
  ]);
  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = parseAmount(amount.value);
    const vat = inkl.checked ? "inkl" : eks.checked ? "eks" : "";
    if (!date.value) {
      status.textContent = "Velg dato.";
      return;
    }
    if (parsed == null) {
      status.textContent = "Skriv beløpet.";
      return;
    }
    if (!vat) {
      status.textContent = "Velg om beløpet er inkl. eller eks. mva.";
      return;
    }
    const [year, month, day] = date.value.split("-").map(Number);
    if (!year || !month || !day) {
      status.textContent = "Velg dato.";
      return;
    }
    try {
      await onAddPayment?.({
        paidAt: new Date(year, month - 1, day, 12, 0, 0),
        amount: parsed,
        vat,
        invoiceNumber: invoice.value.trim().slice(0, 39),
        note: note.value.trim().slice(0, 299),
        status: betalt.checked ? "betalt" : "sendt",
        installment: nextNumber,
        householdId: household.value,
        sluttfaktura: finalInvoice.checked === true,
      });
    } catch (error) {
      console.error(error);
      status.textContent = "Delfakturaen ble ikke lagret.";
      return;
    }
    amount.value = "";
    invoice.value = "";
    note.value = "";
    inkl.checked = false;
    eks.checked = false;
    sendt.checked = true;
    betalt.checked = false;
    finalInvoice.checked = false;
    household.value = "";
    panel.hidden = true;
    status.textContent = "Delfakturaen er lagret.";
  });
  const open = button("Ny delfaktura", {
    class: "btn btn-primary btn-block",
    onClick: () => {
      panel.hidden = !panel.hidden;
    },
  });
  return el("div", { class: "stack" }, [open, panel]);
}

function paymentProgressView(progress) {
  const showBar = progress.hasTotal || progress.totalInc > 0 || progress.paidInc > 0;
  if (!showBar) return null;
  const ratio = progress.totalInc > 0 ? Math.max(0, Math.min(1, progress.paidInc / progress.totalInc)) : (progress.paidInc > 0 ? 1 : 0);
  const percent = Math.round(ratio * 100);
  const fill = el("div", { class: progress.dueInc < 0 ? "pay-fill pay-fill-over" : "pay-fill" });
  fill.style.width = `${percent}%`;
  const over = progress.dueInc < 0 || progress.dueEx < 0;
  return el("div", { class: "pay-progress" }, [
    el("p", { class: "payment-figure" }, `Betalt ${formatKr(progress.paidInc)} av ${formatKr(progress.totalInc)}`),
    el("div", {
      class: "pay-track",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(percent),
      "aria-label": `Betalt ${formatKr(progress.paidInc)} av ${formatKr(progress.totalInc)}`,
    }, [fill]),
    el("p", { class: over ? "payment-figure payment-over" : "payment-figure pay-due" }, over
      ? `Gjenstår ${formatKr(progress.dueInc)}. Det er betalt mer enn totalen.`
      : `Gjenstår ${formatKr(progress.dueInc)}`),
    el("p", { class: "meta" }, `${formatKr(progress.paidEx)} eks. mva betalt. ${formatKr(progress.dueEx)} eks. mva gjenstår.`),
  ]);
}

export function renderPaymentSummary({
  id = "",
  payments = [],
  summary = null,
  showBalance = false,
  prominent = false,
  editable = false,
  households = [],
  onAddPayment,
  onDeletePayment,
  onMarkPaid,
  onAssignHousehold,
  onToggleSluttfaktura,
} = {}) {
  const paid = paymentTotals(payments);
  const balance = showBalance && summary ? paymentBalance(summary, payments) : null;
  const progress = paymentProgress(summary, payments);
  const rows = paymentInstallments(payments);
  const list = el("ul", { class: "payment-list" });
  if (!rows.length) list.append(el("li", { class: "meta" }, "Ingen delfakturaer ennå."));
  for (const payment of rows) {
    const amount = Number(payment.amount);
    const labeled = payment.vat === "inkl" || payment.vat === "eks";
    const vatLabel = payment.vat === "inkl" ? "inkl. mva" : payment.vat === "eks" ? "eks. mva" : "mva er ikke merket";
    const when = formatDay(payment.paidAt) || payment.when || "Uten dato";
    const state = payment.status === "sendt" ? "sendt" : "betalt";
    list.append(el("li", { class: "payment-row" }, [
      el("p", { class: "payment-amount" }, `Delfaktura ${payment.number}`),
      el("p", {}, `${when} · ${formatKr(amount)} ${vatLabel}`),
      payment.invoiceNumber ? el("p", { class: "meta" }, `Faktura ${payment.invoiceNumber}`) : el("p", { class: "meta" }, "Uten fakturanummer"),
      el("p", {}, el("span", { class: `pay-status pay-status-${state}` }, paymentStatusLabel(state))),
      payment.sluttfaktura === true ? el("p", {}, el("span", { class: "pay-status pay-status-slutt" }, "Sluttfaktura")) : null,
      householdCaption(payment, households) ? el("p", { class: "meta" }, householdCaption(payment, households)) : null,
      payment.note ? el("p", { class: "meta" }, payment.note) : null,
      labeled ? null : el("p", { class: "meta" }, "Beløpet er ikke med i summen, fordi mva ikke er merket."),
      editable && payment.id && households.length ? field("Husstand", (() => {
        const select = el("select", { "aria-label": `Husstand for delfaktura ${payment.number}` });
        select.append(el("option", { value: "" }, "Fordeles etter andel"));
        for (const row of households) {
          const option = el("option", { value: row.id }, row.name);
          if (row.id === payment.householdId) option.selected = true;
          select.append(option);
        }
        select.addEventListener("change", () => onAssignHousehold?.(payment.id, select.value));
        return select;
      })()) : null,
      editable && payment.id ? button(payment.sluttfaktura === true ? "Fjern sluttfaktura" : "Merk som sluttfaktura", {
        class: "btn btn-ghost",
        onClick: () => onToggleSluttfaktura?.(payment.id, payment.sluttfaktura !== true),
      }) : null,
      editable && payment.id && state === "sendt" ? button("Merk som betalt", {
        class: "btn btn-ghost",
        onClick: () => onMarkPaid?.(payment.id),
      }) : null,
      editable && payment.id ? button("Slett delfaktura", {
        class: "btn btn-ghost",
        onClick: () => {
          const remove = window.confirm("Slette denne delfakturaen? Kunden ser den ikke lenger.");
          if (!remove) return;
          onDeletePayment?.(payment.id);
        },
      }) : null,
    ]));
  }
  return el("section", { class: prominent ? "payment-box payment-hero" : "payment-box", id: id || null, "aria-label": "Betalinger" }, [
    el("h3", { class: "h-app" }, "Betalinger"),
    el("p", { class: "meta" }, editable
      ? "Ny delfaktura får neste nummer. Sendt er fakturert, men teller ikke som betalt før du merker den betalt. Merk én delfaktura som sluttfaktura. FDV-dokumentasjonen kan lastes ned når den er betalt."
      : "Einar sender delfaktura underveis. Du kan ikke endre dem."),
    paymentProgressView(progress),
    showBalance && balance ? el("p", { class: "meta" }, `Totalt for oppdraget: ${formatKr(balance.totalInc)} inkl. mva.`) : null,
    el("p", { class: "meta" }, `Betalt hittil: ${formatKr(paid.exVat)} eks. mva, ${formatKr(paid.incVat)} inkl. mva`),
    list,
    editable ? paymentForm(onAddPayment, nextInstallmentNumber(payments), households) : null,
  ]);
}

function commitField(input, onCommit) {
  let dirty = false;
  input.addEventListener("input", () => { dirty = true; });
  const commit = () => {
    if (!dirty) return;
    dirty = false;
    onCommit(input.value);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  return input;
}

function extraEditor(row, lines, { onDeleteExtra, onExtra }) {
  const sum = el("p", { class: "meta" }, `Linjesum ${formatKr(row.sum)} eks. mva`);
  const description = commitField(el("input", {
    type: "text",
    maxlength: "200",
    value: row.description || "",
    "aria-label": "Beskrivelse",
  }), (value) => onExtra?.(row.id, "description", value));
  const price = commitField(el("input", {
    type: "text",
    inputmode: "decimal",
    value: formatQty(row.unitPrice),
    "aria-label": "Enhetspris eks. mva",
  }), (value) => onExtra?.(row.id, "unitPrice", value));
  const quantity = commitField(el("input", {
    type: "text",
    inputmode: "decimal",
    value: formatQty(row.quantity),
    "aria-label": "Antall",
  }), (value) => onExtra?.(row.id, "quantity", value));
  const post = el("select", { "aria-label": "Knytt til post" });
  post.append(el("option", { value: "" }, "Andre tillegg"));
  for (const line of lines) {
    const option = el("option", { value: line.id }, line.label);
    if (line.id === row.postId) option.selected = true;
    post.append(option);
  }
  post.addEventListener("change", () => onExtra?.(row.id, "postId", post.value));
  return el("article", { class: "qty-line" }, [
    field("Beskrivelse", description),
    field("Enhetspris, kr eks. mva", price),
    field("Antall", quantity),
    field("Knytt til post", post),
    sum,
    button("Slett tillegg", {
      class: "btn btn-danger",
      onClick: () => onDeleteExtra?.(row.id),
    }),
  ]);
}

function extraSentence(row, history) {
  return el("p", { class: "post-tillegg" }, extraTilleggText(row, history, new Date()));
}

function splitExtras(extras, lines) {
  const ids = new Set((lines || []).map((line) => line.id));
  const linked = new Map();
  const other = [];
  for (const row of extras || []) {
    if (row.postId && ids.has(row.postId)) {
      const list = linked.get(row.postId) || [];
      list.push(row);
      linked.set(row.postId, list);
    } else {
      other.push(row);
    }
  }
  return { linked, other };
}

function historyCard(card) {
  return el("article", { class: `history-item history-${card.actor || "einar"}` }, [
    el("div", { class: "history-mark", "aria-hidden": "true" }, icon(card.icon || "file")),
    el("div", { class: "history-body" }, [
      el("p", { class: "history-who" }, card.actorLabel || "Einar"),
      el("p", { class: "history-title" }, card.title),
      ...card.lines.map((line) => el("p", {
        class: String(line).startsWith("Tillegg:") ? "post-tillegg" : "history-detail",
      }, line)),
      card.whenText ? el("p", { class: "meta" }, card.whenText) : null,
    ]),
  ]);
}

function historySection(title, lead, cards, emptyText) {
  const body = [
    el("h4", { class: "history-heading" }, title),
    el("p", { class: "meta" }, lead),
  ];
  if (!cards.length) {
    body.push(el("p", { class: "meta" }, emptyText));
    return el("section", { class: "history-section" }, body);
  }
  let day = "";
  for (const card of cards) {
    if (card.day !== day) {
      day = card.day;
      body.push(el("h5", { class: "history-day" }, card.day || "Uten dato"));
    }
    body.push(historyCard(card));
  }
  return el("section", { class: "history-section" }, body);
}

export function renderCustomerHistory({
  entries = [],
  lines = [],
  items = [],
  extras = [],
  audience = "kunde",
  logLimited = false,
  allowEmpty = false,
} = {}) {
  const model = buildCustomerHistory({
    entries,
    lines,
    items,
    extras,
    audience,
    now: new Date(),
  });
  const empty = !model.tilbud.length && !model.utfort.length && !model.details.length;
  if (empty && !allowEmpty) return null;
  const raw = el("ol", { class: "history-raw" });
  if (!model.details.length) raw.append(el("li", {}, "Ingen linjer i loggen."));
  for (const line of model.details) raw.append(el("li", {}, line));
  const sent = model.tilbud.some((card) => card.title === "Tilbudet ble sendt" || card.title === "Endringen ble sendt" || card.title === "Tillegget ble sendt");
  return el("div", { class: "history" }, [
    el("h3", { class: "h-app" }, "Historikk"),
    el("p", { class: "meta" }, "Tilbudet og det som er utført vises hver for seg. Små rettelser som ble gjort med en gang, er slått sammen."),
    sent ? el("p", { class: "meta" }, "«Sendt» vises på dagen posten ble opprettet. Godkjenningen har sin egen dato.") : null,
    historySection(
      "Tilbud / avtalt",
      "Avtalt mengde og pris.",
      model.tilbud,
      "Ingen endringer i tilbudet er logget ennå.",
    ),
    historySection(
      "Utført arbeid",
      "Det som er gjort.",
      model.utfort,
      "Ingenting er registrert som utført ennå.",
    ),
    el("details", { class: "history-details" }, [
      el("summary", {}, "Vis alle detaljer"),
      el("p", { class: "meta" }, "Hele loggen, også feilslag som ble rettet med en gang. Det samme ligger i PDF-rapporten."),
      raw,
    ]),
    logLimited ? el("p", { class: "meta" }, "Eldre linjer ligger i PDF-rapporten.") : null,
  ]);
}

function agreeQuoteActions(quotes, onAgreeQuote) {
  const nodes = [];
  for (const quote of quotes || []) {
    if (!quote) continue;
    const number = String(quote.number || "").trim();
    const name = number ? `Fiken-tilbud ${number}` : "Fiken-tilbudet";
    if (quote.agreed === true || String(quote.accepted || "").trim()) {
      const how = String(quote.accepted || "").trim() ? "Akseptert i Fiken" : "Merket som avtalt";
      nodes.push(el("p", { class: "meta" }, `${name}: ${how}.`));
      continue;
    }
    if (!onAgreeQuote || !quote.id) continue;
    nodes.push(button(`Merk ${name} som avtalt`, {
      class: "btn btn-ghost btn-block",
      onClick: () => onAgreeQuote(quote),
    }));
  }
  return nodes;
}

export function renderCostOverview({
  summary,
  history = [],
  items = [],
  audience = "kunde",
  logLimited = false,
  editable = false,
  showPreview = false,
  showToCustomer = false,
  showPayments = true,
  extras = [],
  payments = [],
  onAgreed,
  onQuantity,
  onAddExtra,
  onDeleteExtra,
  onExtra,
  onAddPayment,
  onDeletePayment,
  onMarkPaid,
  households = [],
  onAssignHousehold,
  onToggleSluttfaktura,
  quotes = [],
  onAgreeQuote,
}) {
  const lockedEx = summary.finalized?.exVat || 0;
  const lockedInc = summary.finalized?.incVat || 0;
  const approved = (summary.offers?.rows || []).filter((row) => row.status === "godkjent");
  const baseline = summary.baseline || { kind: "ingen", exVat: 0, label: "" };
  const fromLines = baseline.kind === "planlagt" || baseline.kind === "fiken";
  const agreed = editable
    ? field(fromLines ? "Egen avtalt pris, eks. mva (valgfritt)" : "Avtalt pris / grunntilbud, eks. mva", (() => {
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

  const story = buildCustomerHistory({
    entries: history,
    lines: summary.lines,
    items,
    extras: summary.extras,
    audience,
    now: new Date(),
  });
  const placed = splitExtras(summary.extras, summary.lines);
  const lines = el("div", { class: "cost-lines" });
  const ordered = [
    ...summary.lines.filter((line) => line.fromFiken),
    ...summary.lines.filter((line) => !line.fromFiken),
  ];
  for (const line of ordered) {
    const facts = story.posts[line.id];
    const shownUnit = unitWord(line.label, line.unit) || "stk";
    const deviation = `${signedQty(line.deviation)} ${shownUnit}`;
    const body = [
      el("p", { class: "cost-line-title" }, !editable && facts ? customerPostSummary(line.label, facts) : line.label),
      line.final
        ? el("p", { class: "final-badge" }, [
          partialFinalText(line) ? `${partialFinalText(line)}. ` : "",
          `Ferdig – endelig pris ${formatKr(line.doneSum)} eks. mva`,
          line.finalizedAt ? ` · Fakturert ${formatDay(line.finalizedAt)}` : "",
        ].join(""))
        : el("p", { class: "estimate-badge" }, "Estimert"),
      line.source ? el("p", { class: "meta" }, line.source) : null,
      editable && line.fromFiken ? null : el("p", { class: "meta" }, `à ${formatKr(line.unitPrice)} eks. mva`),
    ];
    if (editable && line.fromFiken) {
      const price = el("input", {
        type: "text",
        inputmode: "decimal",
        value: formatQty(line.unitPrice),
        "aria-label": `Enhetspris ${line.label}`,
        disabled: line.final ? true : null,
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
      const plannedStep = stepper(line.planned, `Planlagt ${line.label}`, (value) => onQuantity?.(line.id, "planned", value));
      const tilleggStep = stepper(line.addition || 0, `Avtalt tillegg ${line.label}`, (value) => onQuantity?.(line.id, "addition", value));
      const doneStep = stepper(line.done, `Utført ${line.label}`, (value) => onQuantity?.(line.id, "done", value));
      if (line.final) {
        lockStepper(plannedStep);
        lockStepper(tilleggStep);
        lockStepper(doneStep);
      }
      const finalBox = el("input", { type: "checkbox", "aria-label": `Ferdig – endelig pris ${line.label}` });
      finalBox.checked = line.final === true;
      finalBox.addEventListener("change", () => {
        if (finalBox.checked) {
          const target = Math.round(((Number(line.planned) || 0) + (Number(line.addition) || 0)) * 100) / 100;
          const done = Math.round((Number(line.done) || 0) * 100) / 100;
          const partial = target > done;
          const question = partial
            ? `${line.label} er bare delvis utført (${formatQty(done)} av ${formatQty(target)}). Merke den som ferdig likevel? Utført kan ikke endres etterpå, før du låser opp.`
            : `Merke «${line.label}» som ferdig med endelig pris? Utført låses til du låser opp.`;
          if (!window.confirm(question)) {
            finalBox.checked = false;
            return;
          }
          onQuantity?.(line.id, "final", true);
          return;
        }
        finalBox.checked = true;
        confirmUnlock(line.label, () => onQuantity?.(line.id, "final", false));
      });
      const invoiced = line.finalizedAt ? `Fakturert ${formatDay(line.finalizedAt)}` : (line.final ? "Fakturert" : "");
      body.push(
        el("p", { class: "qty-label" }, `Planlagt, ${shownUnit}`),
        plannedStep,
        el("p", { class: "qty-label" }, `Avtalt tillegg, ${shownUnit}`),
        tilleggStep,
        el("p", { class: "qty-label" }, `Utført hittil, ${shownUnit}`),
        doneStep,
        el("label", { class: "checkline" }, [finalBox, el("span", {}, "Ferdig – endelig pris")]),
        invoiced ? el("p", { class: "meta" }, invoiced) : null,
      );
    }
    body.push(
      el("p", { class: "meta" }, line.final
        ? `${partialFinalText(line) ? `${partialFinalText(line)}. ` : ""}Endelig pris ${formatKr(line.doneSum)} eks. mva. Det er utført mengde ganger enhetspris.`
        : `Avvik ${deviation}. Estimert ${formatKr(line.plannedSum)}. Påløpt ${formatKr(line.doneSum)}.`),
    );
    for (const tillegg of facts?.tillegg || []) body.push(el("p", { class: "post-tillegg" }, tillegg.text));
    for (const row of placed.linked.get(line.id) || []) {
      if (editable) body.push(extraEditor(row, ordered, { onDeleteExtra, onExtra }));
      else if (row.description || row.quantity || row.unitPrice) body.push(extraSentence(row, history));
    }
    lines.append(el("article", { class: line.final ? "qty-line qty-line-final" : "qty-line" }, body));
  }

  const otherExtras = editable
    ? placed.other
    : placed.other.filter((row) => row.description || row.quantity || row.unitPrice);
  const pricedExtras = (summary.extras || []).some((row) => row.description || row.quantity || row.unitPrice);
  const extraSum = el("p", { class: "cost-money" }, `Sum tilleggsarbeider: ${formatKr(summary.extrasExVat || 0)} eks. mva`);
  const extraBlock = [];
  if (editable || otherExtras.length) {
    extraBlock.push(el("h3", { class: "h-app" }, "Andre tillegg"));
    extraBlock.push(el("p", { class: "meta" }, editable
      ? "Tillegg som ikke hører til en bestemt post. Enhetspris er eks. mva. Du kan knytte et tillegg til en post."
      : "Tillegg som ikke hører til en bestemt post."));
    for (const row of otherExtras) {
      if (editable) extraBlock.push(extraEditor(row, ordered, { onDeleteExtra, onExtra }));
      else extraBlock.push(el("article", { class: "qty-line" }, [extraSentence(row, history)]));
    }
    const filled = (summary.extras || []).length > 0 && (summary.extras || []).every((row) => String(row.description || "").trim());
    if (editable && ((summary.extras || []).length === 0 || filled)) {
      extraBlock.push(button("Legg til nytt tillegg", {
        class: "btn btn-ghost btn-block",
        onClick: () => onAddExtra?.(),
      }));
    }
    if (pricedExtras) extraBlock.push(extraSum);
  } else if (pricedExtras) {
    extraBlock.push(extraSum);
  }

  return el("section", { class: "card continue cost-box" }, [
    el("h2", { class: "h-app" }, "Nåværende kostnad"),
    el("p", { class: "meta" }, editable
      ? (showToCustomer
        ? "Mengdene oppdateres med en gang. Kunden ser det samme, men kan ikke endre tallene. Utført kan justeres underveis, også med desimaler, til Ferdig – endelig pris er krysset av."
        : "Mengdene oppdateres med en gang. Kunden ser ikke denne oversikten. Utført kan justeres underveis, også med desimaler, til Ferdig – endelig pris er krysset av.")
      : "Einar oppdaterer mengdene. Du kan ikke endre mengder eller priser."),
    ...extras,
    fromLines ? el("p", { class: "meta" }, `Opprinnelig tilbud: ${formatKr(baseline.exVat)} eks. mva. ${baseline.label}. Det er planlagt mengde ganger enhetspris, uten avtalt tillegg.`) : null,
    fromLines ? el("p", { class: "meta" }, "Differansen er totalen mot det opprinnelige tilbudet. Låst sluttmengde og avtalt tillegg flytter totalen opp eller ned.") : null,
    ...agreeQuoteActions(quotes, editable ? onAgreeQuote : null),
    agreed,
    approved.length
      ? el("div", { class: "stack" }, approved.map((row) => el("p", { class: "meta" }, `Godkjent: ${row.title}${row.name ? ` – ${row.name}` : ""} ${formatKr(row.exVat)} eks. mva`)))
      : el("p", { class: "meta" }, fromLines
        ? "Ingen poster i Tilbud og endringer er godkjent av kunden ennå. Fiken-linjene er ikke den godkjenningen. Kunden godkjenner en post først når du har sendt den."
        : "Ingen godkjente poster i Tilbud og endringer ennå."),
    lockedEx || lockedInc ? moneyLine("Låst sluttpris (ferdige poster)", lockedEx, lockedInc) : null,
    moneyLine("Gjenstår (estimert)", summary.remaining?.exVat || 0, summary.remaining?.incVat || 0),
    moneyLine("Totalt", summary.estimated.exVat, summary.estimated.incVat),
    moneyLine("Påløpt hittil", summary.incurred.exVat, summary.incurred.incVat),
    el("p", { class: "meta" }, `Differanse mot opprinnelig tilbud: ${signedKr(summary.differenceExVat)} eks. mva, ${signedKr(summary.differenceIncVat)} inkl. mva`),
    showPayments ? renderPaymentSummary({
      id: "seksjon-betalinger",
      payments,
      summary,
      showBalance: true,
      editable,
      households,
      onAddPayment,
      onDeletePayment,
      onMarkPaid,
      onAssignHousehold,
      onToggleSluttfaktura,
    }) : null,
    audience === "einar" && households.length ? renderHouseholdAllocation({
      allocation: householdAllocation({
        households,
        totalEx: summary?.estimated?.exVat || 0,
        totalInc: summary?.estimated?.incVat || 0,
        payments,
      }),
      showTotal: true,
      showPayments: true,
      heading: "h3",
    }) : null,
    showPreview && summary.previewDeltaExVat
      ? el("p", { class: "cost-preview" }, `Forhåndsvisning hvis du godkjenner valget: ${formatKr(summary.preview.exVat)} eks. mva, ${formatKr(summary.preview.incVat)} inkl. mva. Det er ${signedKr(summary.previewDeltaExVat)} eks. mva mot nåværende estimat.`)
      : null,
    lines,
    extraBlock.length ? el("section", { class: "extra-box" }, extraBlock) : null,
    renderCustomerHistory({
      entries: history,
      lines: summary.lines,
      items,
      extras: summary.extras,
      audience,
      logLimited,
      allowEmpty: true,
    }),
  ]);
}
