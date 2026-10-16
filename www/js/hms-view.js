import { button, el } from "./dom.js";
import { formatWhen } from "./logic.js";
import {
  activeHmsDocs,
  customerHmsDocs,
  hmsKindLabel,
  isTrashedHms,
  sortHmsDocs,
} from "./hms.js";

function fileLinks(doc, onOpen) {
  if (!doc?.url) return null;
  const open = el("a", { href: doc.url, target: "_blank", rel: "noopener" }, "Åpne");
  const download = el("a", { href: doc.url, download: doc.name || "hms", rel: "noopener" }, "Last ned");
  open.addEventListener("click", (event) => {
    if (!onOpen) return;
    event.preventDefault();
    onOpen(doc.url);
  });
  return el("div", { class: "action-row" }, [open, download]);
}

function hmsCard(doc, handlers, trashed) {
  const image = !trashed && doc.url && String(doc.contentType || "").startsWith("image/")
    ? el("img", { class: "hms-preview", src: doc.url, alt: "" })
    : null;
  const bits = [
    hmsKindLabel(doc.name, doc.contentType),
    formatWhen(doc.createdAt),
    !trashed && doc.visibleToCustomer === true ? "Vises for kunden" : "",
  ].filter(Boolean);
  const card = el("article", { class: "card continue hms-doc" }, [
    image,
    el("h2", {}, doc.name || "Dokument"),
    el("p", { class: "meta" }, bits.join(" · ")),
    fileLinks(doc, handlers.onOpen),
  ]);
  if (trashed) {
    card.append(button("Gjenopprett", {
      class: "btn btn-ghost",
      onClick: () => handlers.onRestore?.(doc),
    }));
    return card;
  }
  if (handlers.onToggle) {
    const box = el("input", { type: "checkbox", "aria-label": "Vis for kunde" });
    box.checked = doc.visibleToCustomer === true;
    box.addEventListener("change", () => handlers.onToggle(doc, box.checked));
    card.append(el("label", { class: "checkline" }, [box, el("span", {}, "Vis for kunde")]));
  }
  if (handlers.onTrash) {
    card.append(button("Slett", {
      class: "btn btn-danger",
      onClick: () => {
        if (!window.confirm("Slette dokumentet?")) return;
        handlers.onTrash(doc);
      },
    }));
  }
  return card;
}

export function renderHmsBoard(docs, handlers = {}) {
  const active = sortHmsDocs(activeHmsDocs(docs));
  const trashed = sortHmsDocs((docs || []).filter((doc) => isTrashedHms(doc)));
  const root = el("div", { class: "stack hms-board" });
  if (!active.length) root.append(el("p", { class: "empty" }, "Ingen HMS-dokumenter ennå."));
  for (const doc of active) root.append(hmsCard(doc, handlers, false));
  if (trashed.length) {
    root.append(el("section", { class: "card photo-bin stack" }, [
      el("h2", { class: "h-app" }, "Papirkurv"),
      el("p", { class: "meta" }, "Dokumentene kan hentes tilbake. Kunden ser dem ikke."),
      ...trashed.map((doc) => hmsCard(doc, handlers, true)),
    ]));
  }
  return root;
}

export function renderCustomerHms(docs, onOpen) {
  const visible = sortHmsDocs(customerHmsDocs(docs));
  if (!visible.length) return null;
  return el("section", { class: "k-card k-stack", id: "hms" }, [
    el("h2", {}, "HMS"),
    el("p", { class: "muted" }, "Dokumenter som er delt for dette prosjektet."),
    ...visible.map((doc) => el("article", {}, [
      el("h3", {}, doc.name || "Dokument"),
      el("p", { class: "muted" }, [hmsKindLabel(doc.name, doc.contentType), formatWhen(doc.createdAt)].filter(Boolean).join(" · ")),
      String(doc.contentType || "").startsWith("image/") && doc.url
        ? el("img", { class: "hms-preview", src: doc.url, alt: doc.name || "HMS" })
        : null,
      fileLinks(doc, onOpen),
    ])),
  ]);
}
