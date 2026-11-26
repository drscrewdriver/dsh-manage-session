<div align="center">

# dsh-manage-session

**Console delle sessioni · archivio e cestino — sessioni attive e archiviate in un unico posto**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Italiano** · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> Plugin DeepSeek Harness (DSH) mantenuto dalla community, non un prodotto ufficiale DeepSeek AI.

Questo documento descrive **2.0.23**. Modifiche pubblicate nel [changelog](CHANGELOG.md).

## Funzionalità

Metti da parte le sessioni che non servono nell’archivio e riprendile quando vuoi; l’eliminazione passa da un cestino, mai da una cancellazione irreversibile.

- **Vista sessioni archiviate**: l’ambito «Archiviate» del pannello elenca tutte le sessioni archiviate, raggruppate e contate per workspace.
- **Ricerca per workspace**: chip dei workspace, prefisso `workspace:` e filtro su titolo/percorso per gestire decine di progetti.
- **Ripristino ed eliminazione**: ripristino = annulla archiviazione (torna in barra laterale); eliminazione = archivia → cestino → rimozione dell’uuid, reversibile.
- **Cestino e compattazione periodica**: `trash` sposta in `~/.dsh/trash/manage-session/<lotto>/`, `compact` unisce i lotti per giorno/settimana/mese in `.tar.zst`, `restore` li riporta indietro.
- **Preferiti e azioni multiple**: stella, vista «solo preferiti», archiviazione ed eliminazione multiple (doppia conferma).
- **Prima visualizzazione istantanea + controllo salute a quattro porte**: titoli senza I/O e completamento a flusso di frame (373 ms su 252 sessioni); integrità log, cache di proiezione, JSON senza perdite, chiusura in lettura fredda.

## Schermate

![Console: gruppi per workspace e selezione multipla](assets/new-manager.png)

![Vista archivio: sessioni archiviate insieme](assets/old-archive.png)

![Vecchia barra laterale: posizione dell’ingresso](assets/left-sidebar-old.png)

## Installazione

**Host supportati**: `engines.dsh` è `>=0.1.0-rc.2 <0.3.0-0`; le linee `0.1.x` e `0.2.x` sono verificate.

### Fai installare a un agente (consigliato)

```text
Installa l’ultima versione di dsh-manage-session nel profilo DSH che uso, dal registro npm ufficiale, poi conferma la versione e dimmi come ricaricare.
```

### Installazione / aggiornamento manuale

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Riavvia DSH (i plugin host si caricano all’avvio) e aggiorna l’interfaccia per vedere la voce «Gestione sessioni».

## Configurazione

Namespace delle impostazioni `manage-session`:

- `enabled` (`true`) — Interruttore principale; spento, il pannello e tutte le rotte fenced non vengono registrati
- `historyFiles` (`true`) — Percorsi di scrittura archivia / annulla / elimina (cestino)
- `healthCheck` (`true`) — Controllo salute a quattro porte e prescrizioni di riparazione
- `directDelete` (`false`) — Mostrare o meno la riga «Elimina» nel menu di sessione (predefinito spento)

**Posizione dell’ingresso**: slot strumenti in alto nella barra laterale se disponibile, altrimenti in basso.

## Uso

- **Archiviare una sessione** — Seleziona e premi «Archivia»; sparisce subito dalla barra laterale. Le sessioni attive vengono fermate prima.
- **Ripristinare una sessione** — Seleziona nell’ambito «Archiviate» e premi «Annulla archiviazione»; torna nel suo workspace.
- **Eliminare una sessione** — Due clic su «Elimina»; va nel cestino e l’uuid esce subito dalla contabilità.
- **Cercare un workspace** — Clicca un chip o digita `workspace:parola` nella ricerca.
- **Preferiti** — Clicca la stella; attiva «solo preferiti» nel menu di visualizzazione.

## Archivio, eliminazione e pulizia (script deterministico)

Per una pulizia completa esegui lo script a host chiuso; non esegue mai `rm` diretto sui dati di sessione:

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` classifica in sola lettura: `orphan-id` (in contabilità, assente su disco) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` sposta nel cestino e ripulisce la contabilità; `compact --window week` unisce i lotti per periodo e svuota le cartelle ripristinabili direttamente.
- `restore --archive <periodo> [--ids ...]` ripristina; `ledger` è il registro append-only di ogni pulizia.
- **Area delle lapidi**: `tombstones` mostra solo le eliminazioni incomplete (`pending-cleanup`); `forget` rimuove le voci senza entità.

## Archivio dati e rotte

I file dell’host vengono salvati prima di ogni scrittura; nessun indice di sessioni proprio, la ricerca arriva da `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Insieme archiviato e appartenenza ai workspace (file host)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Registro di pulizia (append-only, un uuid per riga)
- `~/.dsh/trash/manage-session/` — Cestino: cartelle dei lotti + `archive/*.tar.zst`

```text
session-catalog            session-catalog-stream
session-history-list       session-history-archive
session-history-prune      session-history-purge
session-history-favorites-list / session-history-favorite-set

session-health-status      session-health-scan
session-health-session     session-health-repair
session-health-source-migrate

settings-describe          settings-mutate
```

## Note

- L’eliminazione resta definitiva: il cestino ripristina tutto, ma dopo `compact` si ripristina da `.tar.zst`; distruggere un lotto richiede `--yes`.
- «Senza titolo» non è un residuo di eliminazione: sessioni senza messaggi e sessioni con id codificato `im:` non hanno titolo per natura.
- Con un processo host attivo lo script rifiuta `trash/compact/restore` (`--allow-running` per forzare).

## Domande frequenti

### Nessun ingresso dopo l’installazione?

Riavvia DSH; verifica il profilo usato e che `cordis.patch.yml` non disabiliti `dsh-manage-session`.

### Archiviare o eliminare?

Archiviare mette da parte ed è reversibile; eliminare passa dal cestino, toglie la contabilità e resta ripristinabile dall’archivio.

### Coesiste con altri plugin di archiviazione?

Sì. L’insieme archiviato è stato condiviso dell’host: entrambi leggono gli stessi dati con ingressi separati.

## Licenza

Rilasciato con [MIT License](LICENSE).

<details>
<summary>Build from source</summary>

```powershell
git clone https://github.com/drscrewdriver/dsh-manage-session.git
Set-Location .\dsh-manage-session
pnpm install --frozen-lockfile
npm run build
dsh plugin --profile web add .
```

</details>

