import { button, el } from "./dom.js";
import {
  PORTAL_JUMPS,
  PORTAL_SECTIONS,
  offerSendNote,
  portalSectionVisible,
} from "./portal-visibility.js";

export function renderPortalNav() {
  const nav = el("nav", { id: "portal-nav", class: "portal-nav", "aria-label": "Hopp til seksjon" });
  fillPortalNav(nav);
  return nav;
}

export function fillPortalNav(nav, root = document) {
  if (!nav) return;
  nav.replaceChildren();
  for (const jump of PORTAL_JUMPS) {
    const target = root.getElementById?.(jump.id);
    if (!target || !target.isConnected || target.hidden) continue;
    nav.append(el("a", { href: `#${jump.id}` }, jump.label));
  }
  nav.hidden = nav.childElementCount === 0;
}

export function renderCustomerVisibility({ project, items = [], onToggle, onSetAll } = {}) {
  const rows = PORTAL_SECTIONS.map((section) => {
    const box = el("input", { type: "checkbox" });
    box.checked = portalSectionVisible(project, section.id);
    box.addEventListener("change", () => onToggle?.(section.id, box.checked === true, box));
    const wrap = el("div", { class: "visibility-row" }, [
      el("label", { class: "checkline" }, [box, el("span", {}, section.label)]),
    ]);
    if (section.id === "tilbudEndringer") {
      wrap.append(el("p", { class: "meta visibility-note" }, offerSendNote(items)));
    }
    if (section.id === "kostnad") {
      wrap.append(el("p", { class: "meta visibility-note" }, "Av som standard. Samme bryter som «Vis kostnad for kunden i portalen»."));
    }
    return wrap;
  });
  return el("section", { class: "card continue portal-visibility" }, [
    el("h2", { class: "h-app" }, "Synlig for kunden"),
    el("p", { class: "meta" }, "Kryss av det kunden skal se i portalen og i Se som kunde. Kunden kan ikke endre dette. Skjul alt hvis du vil teste før kunden ser seksjonene."),
    el("div", { class: "action-row" }, [
      button("Vis alt", { class: "btn btn-ghost", onClick: () => onSetAll?.(true) }),
      button("Skjul alt", { class: "btn btn-ghost", onClick: () => onSetAll?.(false) }),
    ]),
    ...rows,
  ]);
}
