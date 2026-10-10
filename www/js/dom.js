const ICONS = {
  back: '<path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  camera:
    '<path d="M4.5 8.5h2.2l1.2-2h8.2l1.2 2H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V10A1.5 1.5 0 0 1 5 8.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="14" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  image:
    '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m8 15 2.2-2.2a1 1 0 0 1 1.4 0L14 15l1.2-1.2a1 1 0 0 1 1.4 0L20 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/>',
  projects:
    '<path d="M4 7.5h16M4 12h16M4 16.5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  bell: '<path d="M6 16h12l-1.2-2.1V10a4.8 4.8 0 1 0-9.6 0v3.9L6 16Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 16a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  user: '<circle cx="12" cy="8.5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 19c1.2-2.6 3.4-4 6.5-4s5.3 1.4 6.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m13 7 4 4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  alert:
    '<path d="M12 4.5 3.5 19h17L12 4.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.7" r=".8" fill="currentColor"/>',
  file: '<path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 3.5V8h4.5M8 12h8M8 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  share:
    '<circle cx="7" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m9 11 5.2-3M9 13l5.2 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  account:
    '<circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 19.5c1.1-3 3.2-4.5 6.5-4.5s5.4 1.5 6.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "value") node.value = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name) {
  const wrap = document.createElement("span");
  wrap.className = "ico";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return wrap;
}

export function button(label, opts = {}) {
  const node = el("button", { type: opts.type || "button", class: opts.class || "btn" });
  if (opts.icon) node.append(icon(opts.icon));
  node.append(document.createTextNode(label));
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  if (opts.disabled) node.disabled = true;
  return node;
}

export function field(label, input) {
  return el("label", { class: "field" }, [el("span", {}, label), input]);
}

let toastTimer;
export function toast(message) {
  let node = document.getElementById("toast");
  if (!node) {
    node = el("div", { id: "toast", class: "toast", role: "status" });
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

export function sheet(title, body) {
  const root = el("div", { class: "sheet-back" }, [
    el("div", { class: "sheet", role: "dialog" }, [
      el("div", { class: "sheet-bar" }, [
        el("h2", {}, title),
        button("Lukk", { class: "btn btn-ghost", onClick: () => root.remove() }),
      ]),
      body,
    ]),
  ]);
  root.addEventListener("click", (event) => {
    if (event.target === root) root.remove();
  });
  document.body.append(root);
  return root;
}
