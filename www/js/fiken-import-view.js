import { button, el, field } from "./dom.js";
import { fikenUnreachableMessage, filterFikenProjects } from "./fiken-import.js";

export function renderFikenPicker({
  onList,
  onPick,
  buttonLabel = "Hent fra Fiken",
  pickLabel = "Bruk",
  intro = "",
  emptyText = "Fiken har ingen åpne prosjekter å hente.",
  removeOnPick = false,
}) {
  const note = el("p", { class: "meta" });
  const results = el("div", { class: "stack fiken-results" });
  const search = el("input", {
    type: "search",
    placeholder: "Søk på navn, nummer eller kunde",
    maxlength: "120",
    autocomplete: "off",
    enterkeyhint: "search",
  });
  const panel = el("div", { class: "stack", hidden: true }, [
    field("Søk", search),
    results,
  ]);
  let cards = [];
  let loading = false;

  function draw() {
    const shown = filterFikenProjects(cards, search.value);
    results.replaceChildren();
    if (!shown.length) {
      results.append(el("p", { class: "meta" }, search.value.trim() ? "Ingen treff." : emptyText));
      return;
    }
    for (const card of shown) {
      const customer = card.customerName || card.contactName || "Uten kunde";
      const line = [card.number ? `Nr. ${card.number}` : "", customer].filter(Boolean).join(" · ");
      const use = button(pickLabel, { class: "btn btn-primary btn-block" });
      use.addEventListener("click", async () => {
        use.disabled = true;
        try {
          const kept = await onPick?.(card);
          if (kept === false) {
            use.disabled = false;
            return;
          }
          if (removeOnPick) {
            cards = cards.filter((item) => Number(item.projectId) !== Number(card.projectId));
            draw();
            if (!cards.length) note.textContent = "Ingen flere Fiken-prosjekter i listen.";
          } else {
            use.disabled = false;
          }
        } catch (error) {
          use.disabled = false;
          note.textContent = error?.message || "Kunne ikke bruke prosjektet.";
        }
      });
      results.append(el("article", { class: "fiken-pick" }, [
        el("div", { class: "row-body" }, [
          el("span", { class: "row-title" }, card.name || "Uten navn"),
          el("span", { class: "row-text" }, line),
          card.address ? el("span", { class: "row-text" }, card.address) : null,
        ]),
        use,
      ]));
    }
  }

  search.addEventListener("input", draw);

  const loadButton = button(buttonLabel, { class: "btn btn-ghost btn-block" });
  loadButton.addEventListener("click", async () => {
    if (loading) return;
    loading = true;
    loadButton.disabled = true;
    note.textContent = "Henter prosjekter fra Fiken…";
    try {
      const result = await onList?.();
      cards = Array.isArray(result?.projects) ? result.projects : [];
      panel.hidden = false;
      search.value = "";
      draw();
      note.textContent = cards.length
        ? (intro || `${cards.length} ${cards.length === 1 ? "prosjekt" : "prosjekter"} fra Fiken.`)
        : emptyText;
    } catch (error) {
      panel.hidden = true;
      note.textContent = fikenUnreachableMessage(error);
    } finally {
      loading = false;
      loadButton.disabled = false;
    }
  });

  return el("section", { class: "stack fiken-picker" }, [loadButton, note, panel]);
}
