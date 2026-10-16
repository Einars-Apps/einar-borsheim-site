import { button, el, icon } from "./dom.js";
import { captureInputToMillis, captureInputValue, gpsLabel, photoWhen } from "./place.js";
import {
  DELETE_OTHERS_CONFIRM,
  DELETE_PHOTO_CONFIRM,
  groupPhotos,
  isTrashedPhoto,
  moreLabel,
  photoKey,
} from "./photos.js";

function iconButton(name, label, className, onClick) {
  const node = el("button", { type: "button", class: className, "aria-label": label, title: label });
  node.append(icon(name));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function shotButton(photo, onOpen) {
  const full = photo.url || "";
  const src = photo.thumbUrl || full;
  const image = src
    ? el("img", { class: "photo-shot", src, alt: photo.caption || "Bilde" })
    : null;
  if (image) {
    image.addEventListener("error", () => {
      if (image.dataset.full !== "1" && full && image.src !== full && !image.src.endsWith(full)) {
        image.dataset.full = "1";
        image.src = full;
        return;
      }
      const tries = Number(image.dataset.tries || 0);
      if (!full || tries >= 3) return;
      image.dataset.tries = String(tries + 1);
      const join = full.includes("?") ? "&" : "?";
      image.src = `${full}${join}retry=${tries + 1}`;
    });
  }
  const open = el("button", { type: "button", class: "photo-open", "aria-label": "Vis bildet stort" });
  open.append(image || el("p", { class: "empty" }, "Bilde uten lenke"));
  open.addEventListener("click", () => onOpen());
  return open;
}

function captionField(photo, onCaption) {
  const input = el("input", {
    type: "text",
    value: photo.caption || "",
    maxlength: "300",
    placeholder: "Bildetekst",
  });
  input.addEventListener("change", () => onCaption(photo, input.value));
  return input;
}

function selectBox(photo, selected, onToggle) {
  const box = el("input", { type: "checkbox", "aria-label": "Velg bildet" });
  box.checked = selected.has(photoKey(photo));
  box.addEventListener("change", () => onToggle(photo));
  return el("label", { class: "photo-pick" }, [box, el("span", {}, "Velg")]);
}

export function renderPhotoBoard(state, handlers) {
  const photos = state.photos || [];
  const stacks = groupPhotos(photos);
  const trashed = photos.filter((photo) => isTrashedPhoto(photo));
  const expanded = state.selecting ? new Set(stacks.map((stack) => stack.id)) : (state.expanded || new Set());
  const selected = state.selected || new Set();
  const root = el("div", { class: "photo-board stack" });
  const active = photos.filter((photo) => !isTrashedPhoto(photo));

  if (active.length > 1) {
    const tools = el("div", { class: "photo-toolbar" });
    if (!state.selecting) {
      tools.append(button("Velg flere og grupper", {
        class: "btn btn-ghost",
        onClick: () => handlers.onSelectMode(),
      }));
    } else {
      const chosen = active.filter((photo) => selected.has(photoKey(photo))).length;
      tools.append(button("Grupper valgte", {
        class: "btn btn-primary",
        disabled: chosen < 2,
        onClick: () => handlers.onGroup(),
      }));
      tools.append(button("Avbryt", {
        class: "btn btn-ghost",
        onClick: () => handlers.onSelectMode(),
      }));
    }
    root.append(tools);
  }

  const grid = el("div", {
    class: stacks.length > 1 ? "photo-grid photo-grid-pair" : "photo-grid",
  });
  for (const stack of stacks) {
    grid.append(stackCard(stack, { expanded: expanded.has(stack.id), selecting: !!state.selecting, selected, showNote: state.showNote !== false }, handlers));
  }
  if (stacks.length) root.append(grid);
  else if (!trashed.length && state.emptyText) root.append(el("p", { class: "empty" }, state.emptyText));

  if (trashed.length) {
    const bin = el("section", { class: "card photo-bin stack" }, [
      el("h2", { class: "h-app" }, "Papirkurv"),
      el("p", { class: "meta" }, "Bildene kan hentes tilbake. De vises ikke i rapporten eller for kunden."),
    ]);
    for (const photo of trashed.slice().sort((a, b) => photoKey(a).localeCompare(photoKey(b)))) {
      const thumb = (photo.thumbUrl || photo.url) ? el("img", { src: photo.thumbUrl || photo.url, alt: "" }) : el("span", {}, "Bilde");
      bin.append(el("div", { class: "photo-bin-row" }, [
        thumb,
        el("div", { class: "stack" }, [
          el("p", { class: "meta" }, [photoWhen(photo), photo.caption || photo.comment || "Uten tekst"].filter(Boolean).join(" · ")),
          timeField(photo, handlers.onTakenAt),
          button("Gjenopprett", {
            class: "btn btn-ghost",
            onClick: () => handlers.onRestore(photo),
          }),
        ]),
      ]));
    }
    root.append(bin);
  }
  return root;
}

function stackCard(stack, ui, handlers) {
  const best = stack.best;
  const openAt = (photo) => {
    const list = ui.expanded ? stack.photos : [best];
    const index = Math.max(0, list.findIndex((entry) => photoKey(entry) === photoKey(photo)));
    openPhotoViewer(list, index);
  };
  const tools = el("div", { class: "photo-tools" });
  if (ui.selecting) tools.append(selectBox(best, ui.selected, handlers.onToggleSelect));
  tools.append(bestButton(best, true, () => handlers.onBest(best, stack)));
  tools.append(iconButton("trash", "Slett bilde", "photo-trash", () => {
    if (!window.confirm(DELETE_PHOTO_CONFIRM)) return;
    handlers.onTrash(best);
  }));
  if (stack.others.length) {
    tools.append(button(ui.expanded ? "Skjul" : moreLabel(stack.others.length), {
      class: "btn btn-ghost",
      onClick: () => handlers.onToggleExpand(stack.id),
    }));
    tools.append(button("Slett de andre", {
      class: "btn btn-danger",
      onClick: () => {
        if (!window.confirm(DELETE_OTHERS_CONFIRM)) return;
        handlers.onTrashOthers(stack);
      },
    }));
  }
  if (ui.showNote && handlers.onOpenItem) {
    tools.append(button("Notat", { class: "btn btn-ghost", onClick: () => handlers.onOpenItem(best) }));
  }
  const card = el("article", { class: "photo-card", dataset: { stack: stack.id } }, [
    shotButton(best, () => openAt(best)),
    tools,
    captionField(best, handlers.onCaption),
    photoMeta(best),
    timeField(best, handlers.onTakenAt),
  ]);
  if (ui.expanded) {
    const more = el("div", { class: "photo-more stack" });
    for (const photo of stack.others) {
      const rowTools = el("div", { class: "photo-tools" });
      if (ui.selecting) rowTools.append(selectBox(photo, ui.selected, handlers.onToggleSelect));
      rowTools.append(bestButton(photo, false, () => handlers.onBest(photo, stack)));
      rowTools.append(iconButton("trash", "Slett bilde", "photo-trash", () => {
        if (!window.confirm(DELETE_PHOTO_CONFIRM)) return;
        handlers.onTrash(photo);
      }));
      more.append(el("div", { class: "photo-alt stack" }, [
        shotButton(photo, () => openAt(photo)),
        rowTools,
        captionField(photo, handlers.onCaption),
        photoMeta(photo),
        timeField(photo, handlers.onTakenAt),
      ]));
    }
    card.append(more);
  }
  return card;
}

function openMap(url) {
  const Browser = window.Capacitor?.Plugins?.Browser;
  if (Browser?.open) {
    Browser.open({ url }).catch(() => window.open(url, "_blank", "noopener"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

export function mapAnchor(place) {
  const node = el("a", {
    class: "photo-map",
    href: place.href,
    target: "_blank",
    rel: "noopener",
  }, place.text);
  node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMap(place.href);
  });
  return node;
}

function timeField(photo, onTakenAt) {
  if (typeof onTakenAt !== "function") return null;
  const input = el("input", {
    type: "datetime-local",
    class: "photo-time",
    "aria-label": "Opptakstid",
    value: captureInputValue(photo.takenAt),
  });
  input.dataset.photo = photoKey(photo);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => {
    const millis = captureInputToMillis(input.value);
    if (millis == null) return;
    onTakenAt(photo, millis);
  });
  return el("label", { class: "photo-time-label" }, [el("span", {}, "Opptakstid"), input]);
}

function photoMeta(photo) {
  const line = el("p", { class: "meta photo-meta" });
  const bits = [photo.step, photoWhen(photo), photo.approved === false ? "Venter" : ""].filter(Boolean);
  if (bits.length) line.append(document.createTextNode(bits.join(" · ")));
  const place = gpsLabel(photo);
  if (place) {
    if (bits.length) line.append(document.createTextNode(" · "));
    line.append(mapAnchor(place));
  }
  if (!bits.length && !place) return null;
  return line;
}

function bestButton(photo, pressed, onClick) {
  const node = button("Beste", {
    class: pressed ? "btn photo-best is-best" : "btn photo-best",
    icon: "star",
    onClick,
  });
  node.setAttribute("aria-pressed", pressed ? "true" : "false");
  return node;
}

export function mountPhotoBoard(host, handlers) {
  let photos = [];
  let expanded = new Set();
  let selecting = false;
  let selected = new Set();
  let showNote = true;
  let emptyText = "";

  function paint() {
    const active = document.activeElement;
    const editingKey = active?.classList?.contains("photo-time") ? active.dataset.photo || "" : "";
    const editingValue = editingKey ? active.value : "";
    host.replaceChildren(renderPhotoBoard({
      photos,
      expanded,
      selecting,
      selected,
      showNote,
      emptyText,
    }, {
      ...handlers,
      onToggleExpand(id) {
        if (expanded.has(id)) expanded.delete(id);
        else expanded.add(id);
        paint();
      },
      onSelectMode() {
        selecting = !selecting;
        if (!selecting) selected.clear();
        paint();
      },
      onToggleSelect(photo) {
        const key = photoKey(photo);
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        paint();
      },
      onGroup() {
        const chosen = photos.filter((photo) => selected.has(photoKey(photo)));
        Promise.resolve(handlers.onGroup?.(chosen)).finally(() => {
          selecting = false;
          selected.clear();
          paint();
        });
      },
    }));
    if (!editingKey) return;
    const next = [...host.querySelectorAll(".photo-time")].find((node) => node.dataset.photo === editingKey);
    if (!next) return;
    next.value = editingValue;
    next.focus();
  }

  return {
    update(next, options = {}) {
      photos = next || [];
      if (options.showNote != null) showNote = options.showNote;
      if (options.emptyText != null) emptyText = options.emptyText;
      paint();
    },
  };
}

let closeViewer = null;

export function openPhotoViewer(photos, startIndex = 0) {
  const list = (photos || []).filter((photo) => photo && photo.url);
  if (!list.length) return null;
  closeViewer?.();
  let index = Math.min(Math.max(0, startIndex), list.length - 1);
  let scale = 1;
  let panX = 0;
  let panY = 0;
  const points = new Map();
  let pinchStart = 0;
  let pinchScale = 1;
  let swipe = null;

  const image = el("img", { class: "viewer-img", alt: "" });
  const stage = el("div", { class: "viewer-stage" });
  const count = el("p", { class: "viewer-count" }, "");
  const facts = el("p", { class: "viewer-facts" });
  const overlay = el("div", { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Bildefremviser" });
  stage.append(image);

  function apply() {
    image.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
  function resetZoom() {
    scale = 1;
    panX = 0;
    panY = 0;
    apply();
  }
  function show() {
    const photo = list[index];
    image.src = photo.url;
    image.alt = photo.caption || "Bilde";
    count.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : "";
    const bits = [];
    if (photoWhen(photo)) bits.push(el("span", {}, photoWhen(photo)));
    if (photo.caption) bits.push(el("span", {}, photo.caption));
    const place = gpsLabel(photo);
    if (place) bits.push(mapAnchor(place));
    facts.replaceChildren(...bits);
    facts.hidden = bits.length === 0;
    overlay.dataset.index = String(index);
    resetZoom();
  }
  function step(delta) {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    index = next;
    show();
  }
  function zoomBy(factor) {
    scale = Math.min(6, Math.max(1, scale * factor));
    if (scale === 1) {
      panX = 0;
      panY = 0;
    }
    apply();
  }
  function close() {
    if (overlay.dataset.closing === "1") return;
    overlay.dataset.closing = "1";
    if (closeViewer === close) closeViewer = null;
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPop);
    overlay.remove();
  }
  function onPop() {
    close();
  }
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (history.state?.viewer) history.back();
      else close();
    } else if (event.key === "ArrowRight") step(1);
    else if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "+" || event.key === "=") zoomBy(1.2);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / 1.2);
  }
  function distance() {
    const pair = [...points.values()];
    if (pair.length < 2) return 0;
    return Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
  }

  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  stage.addEventListener("pointerdown", (event) => {
    try { stage.setPointerCapture(event.pointerId); } catch { /* syntetiske og avbrutte pekere */ }
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size >= 2) {
      pinchStart = distance();
      pinchScale = scale;
      swipe = null;
    } else {
      swipe = { x: event.clientX, y: event.clientY };
    }
  });
  stage.addEventListener("pointermove", (event) => {
    if (!points.has(event.pointerId)) return;
    const previous = points.get(event.pointerId);
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size >= 2 && pinchStart) {
      const next = distance();
      scale = Math.min(6, Math.max(1, pinchScale * (next / pinchStart)));
      if (scale === 1) {
        panX = 0;
        panY = 0;
      }
      apply();
      return;
    }
    if (points.size === 1 && scale > 1 && previous) {
      panX += event.clientX - previous.x;
      panY += event.clientY - previous.y;
      apply();
    }
  });
  stage.addEventListener("pointerup", (event) => {
    const start = swipe;
    points.delete(event.pointerId);
    if (points.size < 2) pinchStart = 0;
    if (scale <= 1 && start && points.size === 0) {
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    }
    if (!points.size) swipe = null;
  });
  stage.addEventListener("pointercancel", (event) => {
    points.delete(event.pointerId);
    swipe = null;
  });

  const bar = el("div", { class: "viewer-bar" }, [
    count,
    button("Lukk", {
      class: "btn btn-ghost viewer-close",
      onClick: () => {
        if (history.state?.viewer) history.back();
        else close();
      },
    }),
  ]);
  const nav = el("div", { class: "viewer-nav" }, [
    button("Forrige", { class: "btn btn-ghost", onClick: () => step(-1) }),
    button("Større", { class: "btn btn-ghost", onClick: () => zoomBy(1.2) }),
    button("Mindre", { class: "btn btn-ghost", onClick: () => zoomBy(1 / 1.2) }),
    button("Neste", { class: "btn btn-ghost", onClick: () => step(1) }),
  ]);
  overlay.append(bar, stage, facts, nav);
  const previous = history.state && typeof history.state === "object" ? history.state : {};
  history.pushState({ ...previous, viewer: true }, "");
  closeViewer = close;
  window.addEventListener("keydown", onKey);
  window.addEventListener("popstate", onPop);
  document.body.append(overlay);
  show();
  return overlay;
}
