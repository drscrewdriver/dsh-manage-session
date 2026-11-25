<div align="center">

# dsh-manage-session

**Sitzungskonsole · Archiv und Papierkorb — aktive und archivierte Sitzungen an einem Ort**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · **Deutsch** · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> Von der Community gepflegtes DeepSeek-Harness-(DSH-)Plugin, kein offizielles DeepSeek-AI-Produkt.

Dieses Dokument beschreibt **2.0.21**. Veröffentlichte Änderungen im [Changelog](CHANGELOG.md).

## Funktionsumfang

Nicht benötigte Sitzungen wandern ins Archiv und lassen sich jederzeit zurückholen; Löschen läuft über einen Papierkorb statt über ein endgültiges Auslöschen.

- **Ansicht archivierter Sitzungen**: der Bereich „Archiviert“ listet alle archivierten Sitzungen, nach Arbeitsbereich gruppiert und gezählt.
- **Suche nach Arbeitsbereich**: Arbeitsbereich-Chips, `workspace:`-Präfix und Titel-/Pfadfilter halten auch Dutzende Projekte beherrschbar.
- **Wiederherstellen und löschen**: Wiederherstellen = Wiederherstellung aus dem Archiv (zurück in die Seitenleiste); Löschen = archivieren → Papierkorb → uuid aus der Buchhaltung entfernen, umkehrbar.
- **Papierkorb und periodische Verdichtung**: `trash` verschiebt nach `~/.dsh/trash/manage-session/<stapel>/`, `compact` führt Stapel je Tag/Woche/Monat zu `.tar.zst` zusammen, `restore` holt sie zurück.
- **Favoriten und Stapelaktionen**: Stern, Nur-Favoriten-Ansicht, Stapel-Archivieren und Stapel-Löschen (zweistufige Bestätigung).
- **Sofortige Anzeige + Vier-Tore-Gesundheitsprüfung**: Titelquellen ohne I/O plus Frame-Streaming-Nachlauf (373 ms bei 252 Sitzungen); Log-Integrität, Projektionscache, verlustfreies JSON, Kaltlese-Abschluss.

## Ansichten

![Konsole: Gruppen je Arbeitsbereich und Stapelauswahl](assets/new-manager.png)

![Archivansicht: archivierte Sitzungen gebündelt](assets/old-archive.png)

![Alte Seitenleiste: Position des Einstiegs](assets/left-sidebar-old.png)

## Installation

**Host-Unterstützung**: `engines.dsh` ist `>=0.1.0-rc.2 <0.3.0-0`; die Linien `0.1.x` und `0.2.x` sind verifiziert.

### Von einem Agenten installieren lassen (empfohlen)

```text
Installiere die neueste Version von dsh-manage-session in das DSH-Profil, das ich nutze, über die offizielle npm-Registry, bestätige die Version und sage mir, wie ich neu lade.
```

### Manuelle Installation / Aktualisierung

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Danach DSH neu starten (Host-Plugins werden beim Start geladen) und die Oberfläche aktualisieren, um den Einstieg „Sitzungsverwaltung“ zu sehen.

## Konfiguration

Einstellungs-Namespace `manage-session`:

- `enabled` (`true`) — Hauptschalter; ausgeschaltet bleiben Panel und alle fenced-Routen unregistriert
- `historyFiles` (`true`) — Schreibpfade für Archivieren / Wiederherstellen / Löschen (Papierkorb)
- `healthCheck` (`true`) — Vier-Tore-Gesundheitsprüfung und Reparaturhinweise
- `directDelete` (`false`) — Ob das Sitzungsmenü der Seitenleiste eine Zeile „Löschen“ zeigt (standardmäßig aus)

**Position des Einstiegs**: oberer Werkzeug-Slot der Seitenleiste, sonst Fußleiste.

## Bedienung

- **Sitzung archivieren** — Auswählen und „Archivieren“; sie verschwindet sofort aus der Seitenleiste. Laufende Sitzungen werden zuvor gestoppt.
- **Sitzung wiederherstellen** — Im Bereich „Archiviert“ auswählen und „Wiederherstellen“; sie kehrt in ihren Arbeitsbereich zurück.
- **Sitzung löschen** — Zweimal „Löschen“; die Sitzung geht in den Papierkorb, ihre uuid verlässt sofort die Buchhaltung.
- **Arbeitsbereich suchen** — Arbeitsbereich-Chip anklicken oder `workspace:begriff` in die Suche tippen.
- **Favoriten** — Stern anklicken; im Ansichtsmenü „Nur Favoriten“ aktivieren.

## Archivieren, löschen und aufräumen (deterministisches Skript)

Für ein vollständiges Aufräumen das Skript bei geschlossenem Host ausführen; es löscht Sitzungsdaten nie direkt per `rm`:

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` klassifiziert schreibgeschützt: `orphan-id` (in der Buchhaltung, nicht auf Platte) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` verschiebt in den Papierkorb und bereinigt die Buchhaltung; `compact --window week` führt Stapel je Periode zusammen und leert die direkt wiederherstellbaren Ordner.
- `restore --archive <periode> [--ids ...]` stellt wieder her; `ledger` ist das append-only-Register aller Aufräumaktionen.
- **Grabstein-Bereich**: `tombstones` zeigt nur unvollständige Löschungen (`pending-cleanup`); `forget` entfernt Einträge, deren Entity fehlt.

## Ablage und Routen

Host-Dateien werden vor dem Schreiben gesichert; kein eigener Sitzungsindex, die Suche kommt von `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Archivmenge und Arbeitsbereichszugehörigkeit (Host-Datei)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Aufräum-Register (append-only, eine uuid pro Zeile)
- `~/.dsh/trash/manage-session/` — Papierkorb: Stapelordner + `archive/*.tar.zst`

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

## Hinweise

- Löschen bleibt endgültig: der Papierkorb stellt alles wieder her, nach `compact` jedoch aus `.tar.zst`; endgültiges Verwerfen eines Stapels braucht `--yes`.
- „Unbenannt“ ist kein Löschrest: Sitzungen ohne Nachricht und `im:`-Sitzungen mit kodierter ID haben schlicht keinen Titel.
- Solange ein Host-Prozess läuft, verweigert das Skript `trash/compact/restore` (`--allow-running` erzwingt).

## FAQ

### Kein Einstieg nach der Installation?

DSH neu starten; prüfen, ob es im genutzten Profil liegt und `cordis.patch.yml` `dsh-manage-session` nicht deaktiviert.

### Archivieren oder löschen?

Archivieren legt nur beiseite und ist umkehrbar; Löschen geht in den Papierkorb, entfernt die Buchhaltung und bleibt aus dem Archiv wiederherstellbar.

### Koexistenz mit anderen Archiv-Plugins?

Ja. Die Archivmenge ist geteilter Host-Zustand, beide lesen dieselben Daten und behalten eigene Einstiege.

## Lizenz

Veröffentlicht unter der [MIT License](LICENSE).

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

