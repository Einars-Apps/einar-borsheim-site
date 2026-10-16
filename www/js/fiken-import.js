export function fieldsFromFiken(card) {
  const customerName = String(card?.customerName || card?.contactName || "").trim();
  const projectName = String(card?.name || "").trim();
  const id = Number(card?.projectId ?? card?.fikenProjectId);
  const fikenProjectId = Number.isInteger(id) && id > 0 ? id : null;
  return {
    name: projectName || customerName || "Fiken-prosjekt",
    customerName,
    customerEmail: String(card?.customerEmail || "").trim(),
    customerPhone: String(card?.customerPhone || "").trim(),
    address: String(card?.address || "").trim(),
    fikenProjectId,
    fikenProjectName: projectName,
    fikenProjectNumber: String(card?.number || card?.fikenProjectNumber || "").trim(),
  };
}

export function linkedFikenIds(projects) {
  const ids = new Set();
  for (const project of projects || []) {
    const id = Number(project?.fikenProjectId);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

export function isFikenLinked(projects, projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return linkedFikenIds(projects).has(id);
}

export function unimportedFikenProjects(cards, localProjects) {
  const linked = linkedFikenIds(localProjects);
  return (cards || []).filter((card) => {
    const id = Number(card?.projectId);
    return Number.isInteger(id) && id > 0 && !linked.has(id);
  });
}

export function filterFikenProjects(cards, query) {
  const needle = String(query || "").trim().toLowerCase();
  const list = Array.isArray(cards) ? cards : [];
  if (!needle) return list.slice();
  return list.filter((card) => {
    const hay = [card?.name, card?.number, card?.customerName, card?.contactName, card?.address]
      .map((part) => String(part || "").toLowerCase())
      .join(" ");
    return hay.includes(needle);
  });
}

export function fikenUnreachableMessage(error) {
  const message = String(error?.message || error || "").trim();
  const lower = message.toLowerCase();
  if (
    !message
    || lower.includes("failed to fetch")
    || lower.includes("load failed")
    || lower.includes("networkerror")
    || lower.includes("network request failed")
    || lower.includes("ikke tilgjengelig")
    || lower.includes("err_internet")
  ) {
    return "Fikk ikke kontakt med Fiken. Prøv igjen om litt.";
  }
  return message.slice(0, 300);
}
