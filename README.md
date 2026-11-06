# Famiglia

Web app (PWA) per gli impegni della famiglia. **Più famiglie separate**: chi si registra con "Nuova famiglia" crea la sua famiglia e ne è il **Capofamiglia**; il Capofamiglia invita i familiari, genera i link per una nuova password e può passare il ruolo a un altro adulto. Nessuna famiglia vede i dati delle altre.

Da **PannelloApp › Famiglie** si vedono tutte le famiglie con Capofamiglia, account e ultimo accesso, e si può creare un link nuova password per chiunque. Gli impegni non si vedono mai: il pannello nasconde anche le tabelle `famiglia_impegni` e `famiglia_copie_notturne`. Ogni impegno può essere condiviso, "occupato" (gli altri vedono solo l'orario) o privato. I membri possono avere un account (mamma, papà) oppure no (figli, "Famiglia", la nonna…).

## Prova sul PC (senza Supabase)
Doppio clic su **`Prova.bat`**: si apre una finestra (lasciala aperta) e il browser su `http://localhost:8765/?demo`.
- Dati di esempio: Mamma, Papà, Luca, Sofia, Famiglia, Nonna. Papà ha un impegno "occupato" e uno privato.
- Quello che aggiungi resta salvato in quel browser anche dopo aver chiuso tutto.
- In **Famiglia › Prova** puoi entrare come Mamma o come Papà, per vedere cosa vede l'altro degli impegni privati, e ricominciare da capo.
- Le notifiche nella prova non funzionano.

## Struttura
| File | Cosa contiene |
| --- | --- |
| `sito/index.html` | Tutta l'app: accesso, Oggi, Calendario (giorno/settimana/mese), Famiglia. |
| `sito/sw.js` | Copia offline e notifiche. Aumentare `famiglia-vN` a ogni nuova versione pubblicata. |
| `sito/manifest.webmanifest`, icone | Nome, colori e icona per "Aggiungi alla schermata Home". |
| `netlify.toml` | Dice a Netlify di pubblicare la cartella `sito`. |
| `supabase/sql/1-tabelle.sql` | Tabelle, sicurezza, copia notturna e promemoria. Si può rieseguire senza danni. |
| `supabase/sql/2-ripristino-LEGGERE-PRIMA.sql` | Solo emergenze: riporta membri e impegni a una copia notturna. |
| `supabase/functions/api/index.ts` | Edge Function "api": accesso, membri, impegni (con privacy), inviti, notifiche. |
| `Prova.bat`, `strumenti/server-locale.ps1` | Avviano la versione di prova sul PC. |
| `SEGRETI-famiglia.txt` | Chiavi delle notifiche e codice dei promemoria. Solo su questo PC, mai nel repository. |

## Supabase (progetto `bybshobzuopcfnhrjpvg`, solo per questa app)
| Tabella | Cosa contiene |
| --- | --- |
| `famiglia_famiglie` | Le famiglie: nome e Capofamiglia. |
| `famiglia_utenti` | Account (nome utente, password cifrata), ognuno di una sola famiglia. |
| `famiglia_membri` | Chi può avere impegni: nome, colore, adulto/bambino/gruppo, account collegato (se c'è). |
| `famiglia_impegni` | Gli impegni: giorno, orari, per chi, chi accompagna, visibilità, ricorrenza, promemoria. |
| `famiglia_accessi_attivi` | Un accesso per ogni telefono collegato. |
| `famiglia_link` | Inviti (7 giorni) e link per una nuova password (24 ore), una volta sola. |
| `famiglia_tentativi_falliti` | Protezione contro chi prova password a caso. |
| `famiglia_push`, `famiglia_promemoria_inviati` | Telefoni con le notifiche attive e promemoria già mandati. |
| `famiglia_copie_notturne` | Copia di membri e impegni ogni notte, tenuta 30 giorni. |

- **La privacy la fa il server**: un impegno privato non esce mai verso gli altri; per uno "occupato" agli altri arrivano solo giorno, orario e per chi.
- Un impegno condiviso lo può modificare chiunque della famiglia, ma la visibilità la cambia solo chi l'ha creato. Privati e "occupato" li modifica solo chi li ha creati.
- Promemoria: arrivano a chi l'ha creato, agli adulti con account coinvolti e a chi accompagna; se l'impegno è solo di bambini o gruppi, a tutti. Alle 20 arriva l'elenco degli impegni dei bambini di domani senza accompagnatore.

## Messa online (una volta sola)
1. **Segreti della funzione**: Supabase › Edge Functions › Secrets, aggiungi `VAPID_PUBLIC`, `VAPID_PRIVATE` e `VAPID_EMAIL` (facoltativo) copiandoli da `SEGRETI-famiglia.txt`.
2. **Tabelle**: PannelloApp › Supabase › **Esegui 1-tabelle.sql** (oppure SQL Editor › New query, incolla il file e premi Run). Aggiorna anche le tabelle di una versione precedente e genera da solo il codice dei promemoria. In fondo devono comparire due righe: `famiglia-copia-notturna` e `famiglia-promemoria`.
3. **Funzione**: PannelloApp › Supabase › **Deploy della funzione** (la prima volta: crea la Edge Function `api` e **disattiva "Verify JWT"**, come la funzione "api" di Puntuale).
4. **Sito**: pubblica la cartella `sito` su Netlify (nuovo sito collegato a questa cartella).
5. Apri il sito e scegli **Nuova famiglia? Registrati**: diventi Capofamiglia. Poi da **Famiglia** aggiungi i membri e tocca **Invita** sull'altro genitore.

## Prossimi passi (da decidere)
- Lista della spesa e cose da fare condivise.
- Lavoretti di casa per i figli.
- Allegati agli impegni (circolare, PDF della visita).
- Esportazione verso Google Calendar / Apple Calendar (link ICS).
