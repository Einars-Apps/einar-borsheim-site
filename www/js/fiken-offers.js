function cloneLine(line) {
  return {
    id: line.id,
    label: line.label,
    unit: line.unit || "stk",
    planned: line.planned,
    done: line.done,
    unitPrice: line.unitPrice,
    source: line.source || "",
    manual: line.manual === true,
  };
}

function differs(current, incoming) {
  return current.label !== incoming.label
    || current.planned !== incoming.planned
    || current.unitPrice !== incoming.unitPrice
    || current.source !== incoming.source;
}

export function mergeFikenLines(existing, incoming, { overwriteManual = false } = {}) {
  const lines = (existing || []).map(cloneLine);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const conflicts = [];
  for (const raw of incoming || []) {
    const incomingLine = cloneLine(raw);
    const current = byId.get(incomingLine.id);
    if (!current) {
      lines.push({ ...incomingLine, done: incomingLine.done || 0, manual: false });
      byId.set(incomingLine.id, lines[lines.length - 1]);
      continue;
    }
    if (!differs(current, incomingLine)) continue;
    if (current.manual && !overwriteManual) {
      conflicts.push({ id: current.id, label: current.label, source: incomingLine.source });
      continue;
    }
    current.label = incomingLine.label;
    current.unit = incomingLine.unit || current.unit;
    current.planned = incomingLine.planned;
    current.unitPrice = incomingLine.unitPrice;
    current.source = incomingLine.source;
    current.manual = false;
  }
  return { lines, conflicts };
}
