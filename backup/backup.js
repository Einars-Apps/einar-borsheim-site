// Backup-script: eksporterer alle prosjekter (Firestore) og filer (Storage) til en lokal ZIP-fil.
// Kjøres manuelt: npm run backup
// Krever en service-account-nøkkel fra Firebase Console, se backup/README.md.
const path = require("path");
const fs = require("fs");
const admin = require("firebase-admin");
const archiver = require("archiver");

const KEY_PATH = path.join(__dirname, "service-account.json");
const OUTPUT_DIR = path.join(__dirname, "..", "backups");

if (!fs.existsSync(KEY_PATH)) {
  console.error("Mangler backup/service-account.json - se backup/README.md for hvordan du henter den.");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY_PATH)),
  storageBucket: "einar-borsheim-internkon-ee8b6.firebasestorage.app",
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function run() {
  const stamp = new Date().toISOString().slice(0, 10);
  const workDir = path.join(OUTPUT_DIR, `backup-${stamp}`);
  fs.mkdirSync(workDir, { recursive: true });

  console.log("Henter prosjekter fra Firestore...");
  const projectsSnap = await db.collection("projects").get();
  const exportData = { exportedAt: new Date().toISOString(), projects: [] };

  for (const projectDoc of projectsSnap.docs) {
    const project = { id: projectDoc.id, ...projectDoc.data() };
    console.log(`  - ${project.name || project.id}`);

    const [photosSnap, messagesSnap, documentsSnap] = await Promise.all([
      db.collection("projects").doc(projectDoc.id).collection("photos").get(),
      db.collection("projects").doc(projectDoc.id).collection("messages").get(),
      db.collection("projects").doc(projectDoc.id).collection("documents").get(),
    ]);

    project.photos = photosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    project.messages = messagesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    project.documents = documentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    exportData.projects.push(project);
  }

  fs.writeFileSync(path.join(workDir, "firestore-export.json"), JSON.stringify(exportData, null, 2));

  console.log("Laster ned filer fra Storage...");
  const [files] = await bucket.getFiles({ prefix: "projects/" });
  for (const file of files) {
    const destPath = path.join(workDir, "files", file.name);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await file.download({ destination: destPath });
  }
  console.log(`  ${files.length} filer lastet ned.`);

  console.log("Pakker til ZIP...");
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
  console.log(`\nFerdig! Backup lagret: ${zipPath}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Backup feilet:", err);
  process.exit(1);
});
