# Internkontroll – oppsett

Denne appen ligger i `app/`-mappen og er en frittstående PWA (Progressive Web App)
som bruker Firebase som backend for innlogging, prosjektdata og bildelagring.
Fungerer på både mobil og desktop fra samme kode.

## 1. Opprett Firebase-prosjekt
1. Gå til https://console.firebase.google.com og opprett et nytt prosjekt (gratis Spark-plan er nok).
2. I prosjektet: **Build > Authentication** → fane **Sign-in method** → aktiver **E-post/passord**.
3. Gå til fane **Users** → **Add user** → legg inn din e-post og et passord. Dette blir din innlogging (det finnes ingen offentlig registreringsside i appen, av sikkerhetshensyn).
4. **Build > Firestore Database** → **Create database** → start i produksjonsmodus.
5. **Build > Storage** → **Get started** (default bucket er fint).

## 2. Sikkerhetsregler
Lim inn innholdet i disse filene i Firebase-konsollen (kun du med innlogging får lese/skrive):

- Firestore: **Firestore Database > Rules** → lim inn [firestore.rules](app/firestore.rules)
- Storage: **Storage > Rules** → lim inn [storage.rules](app/storage.rules)

Klikk **Publish** i begge.

## 3. Koble appen til Firebase
1. I Firebase-konsollen: **Project settings** (tannhjul) → **Your apps** → velg web (`</>`) → registrer en app.
2. Kopier `firebaseConfig`-objektet du får opp.
3. Lim inn verdiene i [app/firebase-config.js](app/firebase-config.js) (bytt ut placeholder-teksten).

Disse verdiene er ikke hemmelige – de er ment å ligge i klientkoden. Tilgang styres av reglene i steg 2.

## 4. Publiser
Commit og push endringene som vanlig (GitHub Pages). Appen blir da tilgjengelig på
`https://einar-borsheim.com/app/index.html` og lenket fra hovedsiden ("Internkontroll" i menyen).

## 5. Installer som app på telefonen
1. Åpne `einar-borsheim.com/app/index.html` i Chrome (Android) eller Safari (iPhone).
2. Logg inn med e-posten/passordet du opprettet i steg 1.
3. Bruk "Legg til på Hjem-skjerm" i nettleserens meny. Ikonet havner på hjemskjermen og
   åpner appen i fullskjerm som en vanlig app.

## Bruk
- **Nytt prosjekt**: opprett så mange prosjekter du vil (f.eks. ett per byggeplass/oppdrag).
- **Legg til bilde**: åpner kamera direkte på mobil, eller filvelger på desktop. Bilder
  komprimeres automatisk før opplasting og synkroniseres til alle enheter med tilgang.
- **Kommentar**: skriv avviksbeskrivelse under hvert bilde – lagres automatisk.
- **Lag PDF-rapport**: samler alle bilder + kommentarer for prosjektet i én PDF som lastes ned.

## Kjente begrensninger (kan utvides senere ved behov)
- Krever nettforbindelse ved opplasting (ingen offline-kø ennå).
- Åpen registrering er avslått med vilje – nye brukere legges til manuelt i Firebase-konsollen.
