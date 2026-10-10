# Backup av Internkontroll

Dette lager en lokal ZIP med hele databasen (prosjekter, bilder, dokumenter, meldinger, referanser og maler) og filene fra Storage. Firebase er fortsatt hoveddatabasen. ZIP-filen er kopien på PC-en din.

Nøkkelen `backup/service-account.json` skal aldri legges i git. Den gir full tilgang til databasen.

## Engangsoppsett

1. Installer [Node.js](https://nodejs.org/) på PC-en.
2. Åpne prosjektmappen i en terminal og kjør `npm install` én gang.
3. Gå til [Firebase Console → tjenestekontoer](https://console.firebase.google.com/project/einar-borsheim-internkon-ee8b6/settings/serviceaccounts/adminsdk).
4. Klikk **Generate new private key** og bekreft.
5. Døp den nedlastede filen til `service-account.json` og legg den i mappen `backup/`.

## Kjøre én gang

Fra prosjektmappen:

```
npm run backup
```

Filen havner i `backups/backup-ÅÅÅÅ-MM-DD-tt-mm-ss.zip`.

Vil du legge kopien rett i en OneDrive-mappe (så den synkroniseres til den bærbare PC-en og til skyen):

```
set BACKUP_DIR=%USERPROFILE%\OneDrive\Internkontroll-backup
npm run backup
```

## Automatisk på Windows (Oppgaveplanlegger)

1. Lag mappen `%USERPROFILE%\OneDrive\Internkontroll-backup` (eller en annen mappe du deler med den bærbare PC-en).
2. Åpne `backup\kjor-backup.bat` i Notisblokk hvis du vil endre `BACKUP_DIR`. Standard er OneDrive-mappen over.
3. Åpne **Oppgaveplanlegger** → **Opprett enkel oppgave**.
4. Navn: `Internkontroll backup`.
5. Utløser: ukentlig, for eksempel søndag kl. 18.
6. Handling: **Start et program**.
7. Program: `C:\Windows\System32\cmd.exe`
8. Argumenter: `/c "D:\sti\til\einar-borsheim-site\backup\kjor-backup.bat"`
   Bytt ut stien med der prosjektet ligger på PC-en.
9. Kryss av for «Åpne dialogboksen Egenskaper», og huk av **Kjør selv om brukeren ikke er logget på** bare hvis PC-en står på. Ellers holder det at oppgaven kjører når du er logget inn.
10. På fanen **Innstillinger**: «Kjør oppgaven så snart som mulig hvis en planlagt start blir utelatt».

Etter kjøring ligger ZIP-filen i OneDrive-mappen. OneDrive laster den opp til skyen og ned på den bærbare PC-en når den er på nett. Du kan også peke `BACKUP_DIR` mot en delt mappe eller en USB-disk.

Ikke legg `service-account.json` i OneDrive-mappen. Den skal bare ligge lokalt i `backup/`.
