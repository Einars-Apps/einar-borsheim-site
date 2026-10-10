// Lokal kopi av Firestore og Storage.
// Kjør: npm run backup
// Mappe: BACKUP_DIR, ellers backups/ i prosjektet.
// Nøkkel: backup/service-account.json (ikke i git). Se backup/README.md.
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const archiver = require("archiver");

const KEY_PATH = path.join(__dirname, "service-account.json");
const OUTPUT_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(__dirname, "..", "backups");

if (!fs.existsSync(KEY_PATH)) {
  console.error("Mangler backup/service-account.json. Se backup/README.md.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
  storageBucket: "einar-borsheim-internkon-ee8b6.firebasestorage.app",
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

function serialize(value) {
  if (value == null) return value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return value.toDate().toISOString();
      } catch {
        /* vanlige objekter */
      }
    }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = serialize(item);
    return out;
  }
  return value;
}

async function dumpCollection(ref) {
  const snap = await ref.get();
  const docs = [];
  for (const doc of snap.docs) {
    const entry = { id: doc.id, ...serialize(doc.data()) };
    const subs = await doc.ref.listCollections();
    if (subs.length) {
      entry._subcollections = {};
      for (const sub of subs) {
        entry._subcollections[sub.id] = await dumpCollection(sub);
      }
    }
    docs.push(entry);
  }
  return docs;
}

async function run() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const workDir = path.join(OUTPUT_DIR, `backup-${stamp}`);
  fs.mkdirSync(workDir, { recursive: true });

  console.log("Henter databasen…");
  const roots = ["projects", "references", "photoTemplates", "adminDevices", "mail"];
  const exportData = { exportedAt: new Date().toISOString(), collections: {} };
  for (const name of roots) {
    console.log(`  ${name}`);
    exportData.collections[name] = await dumpCollection(db.collection(name));
  }
  fs.writeFileSync(path.join(workDir, "firestore-export.json"), JSON.stringify(exportData, null, 2));

  console.log("Laster ned filer fra Storage…");
  const [files] = await bucket.getFiles({ prefix: "projects/" });
  for (const file of files) {
    if (file.name.endsWith("/")) continue;
    const destPath = path.join(workDir, "files", file.name);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await file.download({ destination: destPath });
  }
  console.log(`  ${files.length} filer lastet ned.`);

  console.log("Pakker til ZIP…");
  const zipPath = `${workDir}.zip`;
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(workDir, false);
    archive.finalize();
  });

  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`\nFerdig. Backup lagret: ${zipPath}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Backup feilet:", err);
  process.exit(1);
});
