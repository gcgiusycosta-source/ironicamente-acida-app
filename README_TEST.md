# Ironicamente Acida — V1 Master locale

Questa è la build **da testare prima della pubblicazione su GitHub**.

## Avvio in locale
La PWA non va aperta con doppio clic su `index.html`, perché IndexedDB, Service Worker e alcuni import funzionano correttamente solo da un piccolo server locale.

Da questa cartella:

```bash
python -m http.server 8080
```

poi aprire `http://localhost:8080`.

## Test V1 da eseguire su iPhone dopo una pubblicazione temporanea
1. Home → Crea da template → frase dalla banca → formato → anteprima → export.
2. Home → Crea da foto → foto → Acida Soft → frase → sticker → firma → export.
3. Verificare che la frase esportata passi in “Già usate”.
4. Aggiungere una nuova frase direttamente dall’app.
5. Aggiungere uno sticker singolo dal telefono.
6. Importare un pacchetto ZIP di sticker senza modificare l’app.
7. Salvare un progetto, chiudere, riaprire e modificarlo.
8. Duplicare un progetto.
9. Esportare backup contenuti e backup completo.
10. Ripristinare un backup.

## Dati locali
Frasi, stato d’uso, preferiti, sticker aggiunti, progetti e impostazioni sono salvati in **IndexedDB** sul dispositivo. GitHub ospiterà solo il programma.

## Starter Pack incluso
- 240 frasi, 30 per ciascuna delle 8 categorie.
- 4 frasi già usate e quindi escluse dai suggerimenti normali.
- 48 sticker iniziali divisi in 4 famiglie grafiche.
