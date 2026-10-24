import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { firebaseConfig } from "./kunde/firebase-config.js";
import { leadDocument, leadError, leadFileName, leadId } from "./www/js/lead.js";

const form = document.getElementById("henvendelse");
if (form) {
  const app = initializeApp(firebaseConfig, "henvendelse");
  const db = getFirestore(app);
  const storage = getStorage(app);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const photo = data.get("photo");
    const input = {
      name: data.get("name"),
      phone: data.get("phone"),
      email: data.get("email"),
      place: data.get("place"),
      text: data.get("text"),
      file: photo && photo.size ? photo : null,
    };
    const status = form.querySelector(".form-status");
    const problem = leadError(input);
    if (problem) {
      status.hidden = false;
      status.textContent = problem;
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    status.hidden = false;
    status.textContent = "Sender…";
    try {
      const id = leadId();
      let fileName = "";
      let contentType = "";
      if (input.file) {
        fileName = leadFileName(input.file.name, input.file.type);
        contentType = input.file.type;
        await uploadBytes(ref(storage, `henvendelser/${id}/${fileName}`), input.file, { contentType });
      }
      await setDoc(doc(db, "henvendelser", id), {
        ...leadDocument({ id, ...input, fileName, contentType }),
        createdAt: serverTimestamp(),
      });
      form.hidden = true;
      const thanks = document.getElementById("henvendelse-takk");
      if (thanks) thanks.hidden = false;
      if (typeof gtag === "function") gtag("event", "generate_lead", { method: "skjema" });
    } catch (error) {
      console.error(error);
      status.textContent = "Henvendelsen ble ikke sendt. Send en e-post til post@einar-borsheim.com.";
      button.disabled = false;
    }
  });
}
