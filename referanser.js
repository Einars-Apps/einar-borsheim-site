import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { firebaseConfig } from "./kunde/firebase-config.js";
import { formatDay } from "./www/js/logic.js";
import { applyPublicSections, realReviewQuotes } from "./www/js/public-refs.js";

const KIND = {
  bilde: "Bilde",
  endring: "Endring",
  avvik: "Avvik",
  kunde: "Fra oppdraget",
};

const lists = [...document.querySelectorAll("[data-referanser]")];
if (lists.length) {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  onSnapshot(
    query(collection(db, "references"), orderBy("updatedAt", "desc")),
    (snap) => {
      const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      showReferences(items);
    },
    (error) => {
      console.error(error);
      showReferences([]);
    }
  );
}

function showReferences(items) {
  const { references } = applyPublicSections(document, items);
  for (const list of lists) {
    list.replaceChildren();
    if (!references) continue;
    const limit = Number(list.dataset.limit || 0);
    const shown = limit ? items.slice(0, limit) : items;
    for (const item of shown) list.append(card(item, limit ? 4 : 12));
  }
  if (references && document.body.dataset.page === "referanser") writeJsonLd(items);
  else document.getElementById("referanse-jsonld")?.remove();
}

function card(item, photoLimit) {
  const article = document.createElement("article");
  article.className = "ref-card";
  const heading = document.createElement("h3");
  heading.textContent = item.name || "Oppdrag";
  article.append(heading);

  const bits = [item.location, item.completedAt ? `Ferdig ${formatDay(item.completedAt)}` : ""].filter(Boolean);
  if (bits.length) {
    const meta = document.createElement("p");
    meta.className = "ref-meta";
    meta.textContent = bits.join(" · ");
    article.append(meta);
  }
  if (item.summary) {
    const summary = document.createElement("p");
    summary.textContent = item.summary;
    article.append(summary);
  }
  if (item.ratingCount) {
    const rating = document.createElement("p");
    rating.className = "ref-rating";
    rating.textContent = `Kundevurdering ${item.ratingAvg} av 5${item.ratingCount > 1 ? ` (${item.ratingCount})` : ""}`;
    article.append(rating);
  }

  const photos = (item.photos || []).filter((photo) => String(photo.url || "").startsWith("https://")).slice(0, photoLimit);
  if (photos.length) {
    const grid = document.createElement("div");
    grid.className = "ref-photos";
    for (const photo of photos) {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = photo.url;
      image.alt = photo.caption || item.name || "Referansebilde";
      image.loading = "lazy";
      figure.append(image);
      if (photo.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = photo.caption;
        figure.append(caption);
      }
      grid.append(figure);
    }
    article.append(grid);
  }

  const tasks = (item.tasks || []).filter((task) => task.title || task.text).slice(0, 6);
  if (tasks.length) {
    const list = document.createElement("ul");
    list.className = "ref-tasks";
    for (const task of tasks) {
      const li = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = `${KIND[task.kind] || "Notat"}. `;
      li.append(label, document.createTextNode(task.title || task.text));
      list.append(li);
    }
    article.append(list);
  }

  const quotes = realReviewQuotes(item.ratings).slice(0, 2);
  for (const rating of quotes) {
    const quote = document.createElement("blockquote");
    quote.textContent = `${"★".repeat(rating.stars || 0)} ${rating.text}`;
    article.append(quote);
  }
  return article;
}

function writeJsonLd(items) {
  const old = document.getElementById("referanse-jsonld");
  if (old) old.remove();
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Referanser fra Einar A Børsheim",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "CreativeWork",
        name: item.name || "Oppdrag",
        description: item.summary || "",
        image: (item.photos || []).find((photo) => String(photo.url || "").startsWith("https://"))?.url,
        review: realReviewQuotes(item.ratings).slice(0, 3).map((rating) => ({
          "@type": "Review",
          reviewBody: rating.text || "",
          reviewRating: {
            "@type": "Rating",
            ratingValue: rating.stars,
            bestRating: 5,
          },
        })),
      },
    })),
  };
  const script = document.createElement("script");
  script.id = "referanse-jsonld";
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.append(script);
}
