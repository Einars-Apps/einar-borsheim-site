export const FDV_LOCKED_TEXT = "FDV-rapporten blir tilgjengelig her når prosjektet er ferdig og sluttoppgjøret er på plass. Takk for et godt samarbeid!";

export function paymentIsPaid(payment) {
  return payment?.status !== "sendt";
}

function paymentList(payments) {
  return Array.isArray(payments) ? payments : [];
}

function finalInvoices(payments) {
  return paymentList(payments).filter((payment) => payment && payment.sluttfaktura === true);
}

function projectFinished(project) {
  const status = project?.status;
  return status === "fullfort" || status === "done";
}

// Åpen når prosjektet er ferdig og sluttoppgjøret er på plass.
// Med merket sluttfaktura: den må være betalt. Uten merke: alle fakturaer må være betalt.
// fdvUnlocked er Einars manuelle åpning. Bilder og andre dokumenter bruker ikke denne funksjonen.
export function fdvNaturalOpen({ project, payments } = {}) {
  if (!projectFinished(project)) return false;
  const finals = finalInvoices(payments);
  if (finals.length) return finals.every(paymentIsPaid);
  const list = paymentList(payments);
  if (!list.length) return false;
  return list.every(paymentIsPaid);
}

export function fdvDownloadOpen({ project, payments } = {}) {
  return fdvNaturalOpen({ project, payments }) || project?.fdvUnlocked === true;
}

export function fdvOpenReason({ project, payments } = {}) {
  if (fdvNaturalOpen({ project, payments })) {
    if (finalInvoices(payments).length) return "sluttfaktura";
    return "ferdig";
  }
  if (project?.fdvUnlocked === true) return "override";
  return "locked";
}

export function fdvReasonText(reason) {
  if (reason === "override") return "Nedlastingen er åpen fordi du har låst den opp manuelt.";
  if (reason === "sluttfaktura") return "Nedlastingen er åpen fordi sluttfakturaen er betalt.";
  if (reason === "ferdig") return "Nedlastingen er åpen fordi oppdraget er ferdig og alle fakturaene er betalt.";
  return FDV_LOCKED_TEXT;
}
