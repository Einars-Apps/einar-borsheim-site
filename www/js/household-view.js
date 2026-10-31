import { button, el, field } from "./dom.js";
import { formatKr } from "./offers.js";
import {
  MAX_HOUSEHOLDS,
  blankHousehold,
  formatShare,
  householdShareError,
  withEvenShares,
} from "./households.js";

function shareValue(share) {
  if (typeof share === "number") return formatShare(share);
  return String(share ?? "");
}

function moneyPair(exVat, incVat) {
  return `${formatKr(exVat)} eks. mva, ${formatKr(incVat)} inkl. mva`;
}

export function renderHouseholdAllocation({
  allocation,
  showTotal = false,
  showPayments = false,
  heading = "h2",
} = {}) {
  if (!allocation?.rows?.length || (!showTotal && !showPayments)) return null;
  const rows = allocation.rows.map((row) => {
    const who = [row.contact, row.email].filter(Boolean).join(" · ");
    const dueOver = row.dueEx < 0 || row.dueInc < 0;
    return el("article", { class: "allocation-row" }, [
      el("h3", {}, `${row.name} · ${formatShare(row.share)} %`),
      who ? el("p", { class: "meta" }, who) : null,
      showTotal ? el("p", {}, `Andel: ${moneyPair(row.exVat, row.incVat)}`) : null,
      showPayments ? el("p", {}, `Betalt hittil: ${moneyPair(row.paidEx, row.paidInc)}`) : null,
      showTotal && showPayments ? el("p", { class: dueOver ? "payment-over" : "" }, dueOver
        ? `Gjenstår: ${moneyPair(row.dueEx, row.dueInc)}. Det er betalt mer enn andelen.`
        : `Gjenstår: ${moneyPair(row.dueEx, row.dueInc)}`) : null,
    ]);
  });
  return el("div", { class: "allocation-box stack" }, [
    el(heading, { class: heading === "h2" ? "h-app" : "" }, "Fordeling mellom husstandene"),
    el("p", { class: "meta" }, "Kostnaden deles etter avtalt andel. Alle husstandene ser det samme."),
    showTotal ? el("p", { class: "payment-figure" }, `Totalt ${moneyPair(allocation.totalEx, allocation.totalInc)}.`) : null,
    ...rows,
    showPayments ? el("p", { class: "meta" }, "Betalinger uten husstand fordeles etter andelen. En betaling kan knyttes til én husstand.") : null,
  ]);
}

export function renderHouseholdEditor({ households = [], onChange, onSave, onCancel } = {}) {
  let rows = (households || []).map((row) => ({ ...row }));
  let dirty = false;
  const status = el("p", { class: "meta", role: "status" });
  const list = el("div", { class: "stack household-list" });

  function snapshot() {
    return rows.map((row) => ({ ...row }));
  }

  function refreshStatus() {
    const error = householdShareError(rows);
    if (!rows.length) {
      status.textContent = "Ingen husstander. Prosjektet vises som før, med én kundelenke.";
      return;
    }
    status.textContent = error || "Sum 100 %. Klar til å lagre.";
  }

  function publish() {
    dirty = true;
    onChange?.(snapshot());
    refreshStatus();
  }

  function drawRows() {
    list.replaceChildren();
    rows.forEach((row, index) => {
      const name = el("input", {
        type: "text",
        maxlength: "80",
        value: row.name || "",
        placeholder: "F.eks. 1. etasje",
        "aria-label": "Navn på husstand",
      });
      const contact = el("input", {
        type: "text",
        maxlength: "120",
        value: row.contact || "",
        placeholder: "Navn eller telefon",
        "aria-label": "Kontakt",
      });
      const email = el("input", {
        type: "email",
        maxlength: "200",
        value: row.email || "",
        placeholder: "kunde@example.com",
        "aria-label": "E-post",
      });
      const share = el("input", {
        type: "text",
        inputmode: "decimal",
        maxlength: "8",
        value: shareValue(row.share),
        "aria-label": "Andel i prosent",
      });
      name.addEventListener("input", () => {
        row.name = name.value;
        publish();
      });
      contact.addEventListener("input", () => {
        row.contact = contact.value;
        publish();
      });
      email.addEventListener("input", () => {
        row.email = email.value;
        publish();
      });
      share.addEventListener("input", () => {
        row.share = share.value;
        publish();
      });
      list.append(el("article", { class: "household-card" }, [
        el("p", { class: "payment-amount" }, `Husstand ${index + 1}`),
        field("Navn", name),
        field("Kontakt (valgfritt)", contact),
        field("E-post (valgfritt)", email),
        field("Andel i prosent", share),
        button("Fjern husstand", {
          class: "btn btn-ghost",
          onClick: () => {
            rows = withEvenShares(rows.filter((entry) => entry !== row));
            drawRows();
            publish();
          },
        }),
      ]));
    });
    refreshStatus();
  }

  const add = button("Legg til husstand", {
    class: "btn btn-ghost",
    onClick: () => {
      if (rows.length >= MAX_HOUSEHOLDS) {
        status.textContent = "Du kan ha opptil 8 husstander.";
        return;
      }
      rows = withEvenShares([...rows, blankHousehold(rows.length + 1)]);
      drawRows();
      publish();
    },
  });
  const even = button("Fordel likt", {
    class: "btn btn-ghost",
    onClick: () => {
      if (rows.length < 2) {
        status.textContent = rows.length ? "Én husstand har 100 %." : "Legg til en husstand først.";
        if (rows.length === 1) {
          rows = withEvenShares(rows);
          drawRows();
          publish();
        }
        return;
      }
      rows = withEvenShares(rows);
      drawRows();
      publish();
    },
  });
  const save = button("Lagre husstander", {
    class: "btn btn-primary",
    onClick: async () => {
      const error = householdShareError(rows);
      if (error) {
        status.textContent = error;
        return;
      }
      save.disabled = true;
      try {
        await onSave?.(snapshot());
      } finally {
        save.disabled = false;
      }
    },
  });
  const cancel = button("Avbryt", {
    class: "btn btn-ghost",
    onClick: () => onCancel?.(),
  });

  drawRows();
  return el("section", { class: "card continue household-box" }, [
    el("h2", { class: "h-app" }, "Husstander"),
    el("p", { class: "meta" }, "For tomannsbolig og andre som deler regningen. Legg inn navn, valgfri kontakt og andel. To husstander starter på 50/50. Andelene må bli 100 %. Alle bruker den samme kundelenken og ser det samme i portalen."),
    list,
    status,
    el("div", { class: "action-row" }, [add, even, save, cancel]),
  ]);
}
