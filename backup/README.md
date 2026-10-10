# Backup av Internkontroll-data

Dette lager en lokal ZIP-fil med alle prosjekter, bilder, dokumenter og meldinger.
Skyen (Firebase) er fortsatt hoveddatabasen - dette er kun en sikkerhetskopi på PC-en din.

## Engangsoppsett

1. Gå til [Firebase Console](https://console.firebase.google.com/project/einar-borsheim-internkon-ee8b6/settings/serviceaccounts/adminsdk).
2. Klikk **"Generate new private key"** → bekreft → en JSON-fil lastes ned.
3. Omdøp filen til `service-account.json` og legg den i denne `backup/`-mappen.
   (Denne filen er i `.gitignore` og havner aldri på GitHub - hold den hemmelig, den gir full tilgang til databasen.)

## Kjøre backup

I VS Code-terminalen, fra prosjektmappen:

```
npm run backup
```

Dette lager en fil som `backups/backup-2026-10-10.zip` med:
- `firestore-export.json` – alle prosjekter, bilder-metadata, dokumenter, meldinger
- `files/` – selve bildene og dokumentene

## Automatisk, periodisk backup (valgfritt)

For å kjøre dette automatisk f.eks. hver søndag, kan du sette opp en **Windows oppgaveplanlegger**-jobb
som kjører `npm run backup` fra denne mappen. Si ifra om du vil ha hjelp til å sette opp dette.
