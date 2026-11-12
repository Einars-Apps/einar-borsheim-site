// Gruppering av like bilder, valg av beste bilde, og hvilke bilder som vises utad.
// Papirkurven for ett bilde er feltet trashed på bildedokumentet. Filen i Storage blir liggende
// til hele prosjektet slettes, så bildet kan hentes tilbake.

export const SIMILAR_MS = 60 * 1000;
export const DELETE_PHOTO_CONFIRM = "Slette bildet?";
export const DELETE_OTHERS_CONFIRM = "Slette de andre bildene?";

export function photoMillis(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        const time = value.toDate().getTime();
        if (Number.isFinite(time)) return time;
      } catch {
        /* vanlig tall eller seconds under */
      }
    }
    if (typeof value.seconds === "number") {
      return Math.round(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
    }
  }
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

export function isTrashedPhoto(photo) {
  return photo?.trashed === true;
}

export function photoKey(photo) {
  if (!photo) return "";
  const id = photo.id || photo.url || photo.caption || "bilde";
  return `${photo.itemId || ""}/${id}`;
}

function norm(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function manualGroup(photo) {
  return String(photo?.groupId || "").trim();
}

export function captureMillis(photo) {
  return photoMillis(photo?.takenAt) ?? photoMillis(photo?.uploadedAt) ?? photoMillis(photo?.createdAt);
}

export function uploadTimestamps(now, takenAt) {
  return {
    createdAt: now,
    uploadedAt: now,
    takenAt: takenAt || null,
  };
}

export function needsExifBackfill(photo) {
  if (!photo?.ref || !photo.url || isTrashedPhoto(photo)) return false;
  if (photoMillis(photo.takenAt) != null) return false;
  return photo.exifChecked !== true;
}

function compareCapture(a, b, oldest) {
  const left = captureMillis(a);
  const right = captureMillis(b);
  if (left == null && right == null) return photoKey(a).localeCompare(photoKey(b));
  if (left == null) return 1;
  if (right == null) return -1;
  if (left !== right) return oldest ? left - right : right - left;
  return photoKey(a).localeCompare(photoKey(b));
}

function newestFirst(a, b) {
  return compareCapture(a, b, false);
}

export function sortPhotos(photos, direction = "newest") {
  const list = (photos || []).filter((photo) => photo && photoKey(photo));
  const oldest = direction === "oldest";
  return list.slice().sort((a, b) => compareCapture(a, b, oldest));
}

function pickBest(sortedNewestFirst) {
  const marked = sortedNewestFirst.filter((photo) => photo.best === true);
  return (marked.length ? marked : sortedNewestFirst)[0] || null;
}

function stackId(members) {
  const manuals = [...new Set(members.map(manualGroup).filter(Boolean))];
  if (manuals.length === 1 && members.every((photo) => manualGroup(photo) === manuals[0])) {
    return `grp:${manuals[0]}`;
  }
  return `auto:${members.map(photoKey).sort()[0]}`;
}

export function groupPhotos(photos) {
  const list = (photos || []).filter((photo) => photo && !isTrashedPhoto(photo) && photoKey(photo));
  const parent = list.map((_, index) => index);
  function find(index) {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  }
  function unite(left, right) {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  }

  const manualBuckets = new Map();
  const auto = [];
  list.forEach((photo, index) => {
    const manual = manualGroup(photo);
    if (manual) {
      const previous = manualBuckets.get(manual);
      if (previous == null) manualBuckets.set(manual, index);
      else unite(previous, index);
    } else auto.push(index);
  });

  function link(map, key, index) {
    if (!key) return;
    const previous = map.get(key);
    if (previous == null) map.set(key, index);
    else unite(previous, index);
  }
  const byItem = new Map();
  const byStep = new Map();
  const byComment = new Map();
  for (const index of auto) {
    const photo = list[index];
    link(byItem, String(photo.itemId || "").trim(), index);
    link(byStep, norm(photo.step), index);
    link(byComment, norm(photo.comment || photo.caption || ""), index);
  }

  const timed = auto
    .map((index) => ({ index, time: captureMillis(list[index]) }))
    .filter((entry) => entry.time != null)
    .sort((a, b) => a.time - b.time || photoKey(list[a.index]).localeCompare(photoKey(list[b.index])));
  for (let index = 1; index < timed.length; index += 1) {
    if (timed[index].time - timed[index - 1].time <= SIMILAR_MS) unite(timed[index - 1].index, timed[index].index);
  }

  const groups = new Map();
  list.forEach((photo, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(photo);
  });

  const stacks = [...groups.values()].map((members) => {
    const sorted = members.slice().sort(newestFirst);
    const best = pickBest(sorted);
    return {
      id: stackId(members),
      photos: sorted,
      best,
      others: sorted.filter((photo) => photoKey(photo) !== photoKey(best)),
    };
  });
  stacks.sort((a, b) => newestFirst(a.best, b.best));
  return stacks;
}

export function representativePhotos(photos) {
  const visible = (photos || []).filter((photo) => photo && !isTrashedPhoto(photo) && photo.approved !== false);
  return groupPhotos(visible).map((stack) => stack.best).filter(Boolean);
}

export function publicPhotos(photos) {
  const visible = (photos || []).filter((photo) => (
    photo && !isTrashedPhoto(photo) && photo.approved !== false && photo.url
  ));
  return groupPhotos(visible).map((stack) => stack.best).filter(Boolean);
}

export function photoUrl(photo) {
  return String(photo?.url || photo?.thumbUrl || "").trim();
}

// Admin deler et bilde ved å sette approved: true (opplasting gjør det med en gang).
// shared og visibleToCustomer teller også, om de er brukt. Papirkurv og bilder uten lenke gjør ikke.
export function photoIsShared(photo, { parentShared = false } = {}) {
  if (!photo || isTrashedPhoto(photo)) return false;
  if (!photoUrl(photo)) return false;
  if (photo.approved === true || photo.shared === true || photo.visibleToCustomer === true) return true;
  if (photo.approved === false || photo.shared === false || photo.visibleToCustomer === false) return false;
  return parentShared === true;
}

export function sharedWithCustomer(photos) {
  return (photos || []).filter((photo) => photoIsShared(photo));
}

export function photoTag(photo) {
  const step = String(photo?.step || "").trim();
  const caption = String(photo?.caption || photo?.comment || "").trim();
  if (step && caption && step.toLowerCase() !== caption.toLowerCase()) return `${step} · ${caption}`;
  return step || caption;
}

function parentIsShared(item) {
  return item?.approved === true || item?.shared === true || item?.visibleToCustomer === true;
}

function withItemContext(photo, item) {
  if (!item) return photo;
  return {
    ...photo,
    itemId: photo.itemId || item.id || "",
    step: photo.step || item.step || "",
    comment: photo.comment || photo.caption || item.text || "",
    itemText: item.text || "",
    itemTitle: item.title || "",
  };
}

// Alle bilder kunden skal se: underposter på notater (også kind bilde), bilder lagret
// på selve posten, forsidebilde, og eldre bilder rett under prosjektet.
export function collectSharedPhotos({ items = [], photosByItem = {}, legacy = [] } = {}) {
  const flat = [];
  const seenKeys = new Set();
  const seenUrls = new Set();
  function add(photo, item, fromParent) {
    const tagged = withItemContext(photo, item);
    if (!photoIsShared(tagged, { parentShared: fromParent && parentIsShared(item) })) return;
    const key = photoKey(tagged);
    const url = photoUrl(tagged);
    if ((key && seenKeys.has(key)) || (url && seenUrls.has(url))) return;
    if (key) seenKeys.add(key);
    if (url) seenUrls.add(url);
    flat.push(tagged);
  }
  for (const item of items || []) {
    if (!item?.id) continue;
    for (const photo of photosByItem[item.id] || []) add(photo, item, true);
    for (const photo of Array.isArray(item.photos) ? item.photos : []) add(photo, item, true);
    const cover = String(item.coverUrl || "").trim();
    if (!cover) continue;
    add({
      id: `cover-${item.id}`,
      url: cover,
      thumbUrl: cover,
      caption: item.text || "",
      step: item.step || "",
      createdAt: item.createdAt || null,
      uploadedAt: item.createdAt || null,
    }, item, true);
  }
  for (const photo of legacy || []) add(photo, null, false);
  return flat;
}

export const GALLERY_PAGE_NARROW = 6;
export const GALLERY_PAGE_WIDE = 9;
export const GALLERY_WIDE_MIN = 720;

export function galleryPageSize(width) {
  return Number(width) >= GALLERY_WIDE_MIN ? GALLERY_PAGE_WIDE : GALLERY_PAGE_NARROW;
}

export function galleryPageCount(total, pageSize) {
  const size = Math.max(1, Number(pageSize) || 1);
  const count = Math.max(0, Number(total) || 0);
  if (!count) return 1;
  return Math.ceil(count / size);
}

export function galleryShowsPager(total, pageSize) {
  return (Number(total) || 0) > Math.max(1, Number(pageSize) || 1);
}

export function galleryPage(photos, page, pageSize) {
  const list = photos || [];
  const size = Math.max(1, Number(pageSize) || 1);
  const pages = galleryPageCount(list.length, size);
  const index = Math.min(Math.max(1, Number(page) || 1), pages);
  const start = (index - 1) * size;
  return { page: index, pages, start, photos: list.slice(start, start + size) };
}

export function galleryPageLabels(pages, current) {
  const total = Math.max(1, Number(pages) || 1);
  const page = Math.min(Math.max(1, Number(current) || 1), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => String(index + 1));
  const wanted = new Set([1, total, page - 1, page, page + 1].filter((n) => n >= 1 && n <= total));
  const labels = [];
  let previous = 0;
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (previous && n - previous > 1) labels.push("…");
    labels.push(String(n));
    previous = n;
  }
  return labels;
}

export function viewerIndex(index, delta, length) {
  const count = Math.max(0, Number(length) || 0);
  if (!count) return 0;
  const current = Math.min(Math.max(0, Number(index) || 0), count - 1);
  const next = current + (Number(delta) || 0);
  if (next < 0 || next >= count) return current;
  return next;
}

export function annotatePhotos(items, photosByItem = {}) {
  const flat = [];
  for (const item of items || []) {
    if (!item) continue;
    for (const photo of photosByItem[item.id] || []) {
      if (!photo) continue;
      flat.push({
        ...photo,
        itemId: photo.itemId || item.id,
        step: photo.step || item.step || "",
        comment: photo.comment || photo.caption || item.text || "",
        itemText: item.text || "",
        itemTitle: item.title || "",
      });
    }
  }
  return flat;
}

export function representativeKeys(items, photosByItem) {
  return new Set(representativePhotos(annotatePhotos(items, photosByItem)).map(photoKey));
}

export function publishedPhotoKeys(items, photosByItem) {
  return new Set(publicPhotos(annotatePhotos(items, photosByItem)).map(photoKey));
}

export function moreLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return "1 til";
  return `${n} flere`;
}

export function newGroupId(now = Date.now()) {
  return `grp-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function redundantPhotoItem(item, allAnnotated, { hasComments = false } = {}) {
  if (!item || item.kind !== "bilde" || hasComments) return false;
  const keys = new Set(publicPhotos(allAnnotated).map(photoKey));
  const own = (allAnnotated || []).filter((photo) => photo.itemId === item.id);
  if (!own.length) return false;
  if (own.some((photo) => keys.has(photoKey(photo)))) return false;
  const text = norm(item.text || item.title);
  if (!text) return true;
  return (allAnnotated || [])
    .filter((photo) => keys.has(photoKey(photo)))
    .some((photo) => norm(photo.itemText || photo.itemTitle || photo.comment) === text);
}
