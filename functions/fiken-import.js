function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatFikenAddress(address) {
  if (!address || typeof address !== "object") return "";
  const street = text(address.streetAddress || address.street);
  const post = text(address.postCode || address.postalCode);
  const city = text(address.city);
  const place = [post, city].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

function contactIdOf(source) {
  const raw = source?.contact?.contactId ?? source?.contactId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function contactBits(contact) {
  if (!contact || typeof contact !== "object") {
    return { name: "", email: "", phone: "", address: "" };
  }
  return {
    name: text(contact.name),
    email: text(contact.email),
    phone: text(contact.phoneNumber || contact.phone || contact.mobile),
    address: formatFikenAddress(contact.address),
  };
}

function contactNeedsFetch(project) {
  const id = contactIdOf(project);
  if (!id) return null;
  const bits = contactBits(project?.contact);
  if (bits.email || bits.phone || bits.address) return null;
  return id;
}

function cardFromFikenProject(project, fetched) {
  const embedded = contactBits(project?.contact);
  const extra = contactBits(fetched);
  const customerName = extra.name || embedded.name;
  const projectId = Number(project?.projectId);
  return {
    projectId: Number.isInteger(projectId) && projectId > 0 ? projectId : null,
    name: text(project?.name),
    number: text(project?.number),
    contactId: contactIdOf(project) || contactIdOf(fetched),
    customerName,
    customerEmail: extra.email || embedded.email,
    customerPhone: extra.phone || embedded.phone,
    address: extra.address || embedded.address,
    contactName: customerName,
  };
}

module.exports = {
  cardFromFikenProject,
  contactBits,
  contactIdOf,
  contactNeedsFetch,
  formatFikenAddress,
};
