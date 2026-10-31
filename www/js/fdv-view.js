import { el } from "./dom.js";
import { FDV_LOCKED_TEXT } from "./fdv.js";

const LOCK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 8.5V12l2.5 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function renderFdvWait(text = FDV_LOCKED_TEXT) {
  const icon = document.createElement("span");
  icon.className = "fdv-wait-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = LOCK_SVG + CLOCK_SVG;
  return el("div", { class: "fdv-wait", role: "status" }, [
    icon,
    el("p", {}, text),
  ]);
}
