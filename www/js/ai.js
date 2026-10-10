// KI-utkast er ikke koblet til i testversjonen.
//
// Når du vil slå det på: deploy en Cloud Function som mottar notater
// (ikke bilderådata) og kaller språkmodellen med nøkkelen KUN på serveren.
// Lim deretter inn funksjonens URL her og bygg appen på nytt.
// Ikke legg API-nøkkel i denne filen eller i appen.
export const AI_DRAFT_URL = "";

export async function requestAiDraft({ getIdToken, project, items }) {
  if (!AI_DRAFT_URL) {
    const error = new Error("KI er ikke satt opp");
    error.code = "KI_NOT_CONFIGURED";
    throw error;
  }
  const token = await getIdToken();
  const response = await fetch(AI_DRAFT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ project, items }),
  });
  if (!response.ok) throw new Error("KI-tjenesten svarte ikke");
  const data = await response.json();
  if (!data || typeof data.draft !== "string" || !data.draft.trim()) {
    throw new Error("KI-tjenesten returnerte ikke et utkast");
  }
  return data.draft.trim();
}
