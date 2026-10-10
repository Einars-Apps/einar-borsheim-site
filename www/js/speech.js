export function canSpeak() {
  return !!(
    window.Capacitor?.Plugins?.SpeechRecognition
    || window.SpeechRecognition
    || window.webkitSpeechRecognition
  );
}

export async function dictate(onText) {
  const plugin = window.Capacitor?.Plugins?.SpeechRecognition;
  if (plugin) {
    const current = await plugin.checkPermissions?.().catch(() => ({ speechRecognition: "prompt" }));
    if (current && current.speechRecognition && current.speechRecognition !== "granted") {
      const next = await plugin.requestPermissions();
      if (next.speechRecognition !== "granted") throw new Error("permission");
    }
    const result = await plugin.start({
      language: "nb-NO",
      maxResults: 1,
      partialResults: false,
      popup: true,
    });
    const spoken = (result?.matches && result.matches[0]) || "";
    if (spoken) onText(spoken);
    return;
  }

  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) throw new Error("unsupported");
  await new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = "nb-NO";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const spoken = event.results?.[0]?.[0]?.transcript || "";
      if (spoken) onText(spoken);
      resolve();
    };
    recognition.onerror = (event) => reject(new Error(event.error || "speech"));
    recognition.onend = () => resolve();
    recognition.start();
  });
}
