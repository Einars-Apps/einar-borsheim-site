// Om Referanser og anmeldelser skal vises på den offentlige siden.
// Samlingen references er det som ligger ute når et prosjekt har public: true.

export function hasPublicReferences(items) {
  return Array.isArray(items) && items.length >= 1;
}

export function realReviewQuotes(ratings) {
  return (ratings || []).filter((rating) => String(rating?.text || "").trim());
}

export function hasRealReviews(items) {
  return (items || []).some((item) => realReviewQuotes(item?.ratings).length > 0);
}

const REFERENCE_SELECTOR = "[data-referanser-nav], #referanser, [data-referanser-side]";
const REVIEW_SELECTOR = "[data-anmeldelser]";

function setHidden(root, selector, show) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  for (const node of root.querySelectorAll(selector)) node.hidden = !show;
}

export function applyPublicSections(root, items) {
  const references = hasPublicReferences(items);
  const reviews = references && hasRealReviews(items);
  setHidden(root, REFERENCE_SELECTOR, references);
  setHidden(root, REVIEW_SELECTOR, reviews);
  return { references, reviews };
}
