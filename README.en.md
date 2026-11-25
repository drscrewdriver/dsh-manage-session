<div align="center">

# dsh-manage-session

**Session console · archive & recycle bin — manage active and archived sessions in one place**

[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> A community-maintained DeepSeek Harness (DSH) plugin, not an official DeepSeek AI product.

This document describes **2.0.19**. See the [changelog](CHANGELOG.md) for released changes.

## What it does

Put sessions you do not need aside as archived, bring them back anytime; delete goes through a recycle bin instead of an irreversible wipe.

- **Archived-sessions view**: the in-panel "Archived" scope lists every archived session, grouped and counted by workspace.
- **Workspace search**: workspace chips, a `workspace:` prefix and title/path substring filtering keep dozens of projects filterable.
- **Restore and delete**: restore = unarchive (back to the sidebar); delete = archive first → move to the recycle bin → drop the uuid from bookkeeping, reversible.
- **Recycle bin and periodic compaction**: `trash` moves a session into `~/.dsh/trash/manage-session/<batch>/`, `compact` merges aged batches per day/week/month into `.tar.zst`, `restore` puts them back.
- **Favorites and batch actions**: star favorites, favourites-only view, batch archive and batch delete (two-step confirm).
- **Instant first paint + four-gate health check**: zero-I/O title sources plus frame-streamed backfill (373 ms for 252 sessions); log integrity / projection cache / lossless JSON / cold-read checkup.

## Screenshots

![Manager: grouped by workspace with batch selection](assets/new-manager.png)

![Archived view: archived sessions in one place](assets/old-archive.png)

![Legacy sidebar: where the entry lives](assets/left-sidebar-old.png)

## Install

**Host support**: `engines.dsh` is `>=0.1.0-rc.2 <0.3.0-0`; both the `0.1.x` and `0.2.x` lines are verified.

### Let an agent install it (recommended)

```text
Install the latest dsh-manage-session into the DSH profile I am using, from the official npm registry, then confirm the version and tell me how to reload.
```

### Manual install / update

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Restart DSH afterwards (host plugins load at startup), then refresh the UI to see the "Session Manager" entry.

## Configuration

Settings namespace `manage-session`:

- `enabled` (`true`) — Master switch; when off the panel and every fenced route stay unregistered
- `historyFiles` (`true`) — Archive / unarchive / delete (recycle bin) write paths
- `healthCheck` (`true`) — Four-gate health check and repair prescriptions
- `directDelete` (`false`) — Whether the sidebar session menu shows a "Delete" row (off by default)

**Entry position**: the sidebar top tool slot when the host provides one, otherwise the footer.

## Usage

- **Archive a session** — Select and hit "Archive"; the sidebar hides it at once. Active sessions are stopped then archived automatically.
- **Restore a session** — Select inside the "Archived" scope and hit "Unarchive"; it returns to its workspace.
- **Delete a session** — Hit "Delete" twice; the session moves to the recycle bin and its uuid leaves bookkeeping immediately.
- **Search a workspace** — Click a workspace chip, or type `workspace:keyword` in the search box.
- **Favorites / favourites-only** — Click the star to favourite; tick "Favourites only" in the view menu.

## Archive, delete and cleanup (deterministic script)

Run the script with the host closed for a full cleanup; it never `rm`s session data directly:

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` classifies read-only: `orphan-id` (in bookkeeping, gone from disk) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` moves sessions to the bin and drops their bookkeeping; `compact --window week` merges aged batches per period and empties the directly restorable dirs.
- `restore --archive <period> [--ids ...]` puts them back; `ledger` is the append-only record of every cleanup action.
- **Tombstone area**: `tombstones` lists only incomplete deletions (`pending-cleanup`); `forget` drops tombstones whose entity is already gone.

## Storage and routes

Host files are backed up before any write; no session index of its own — search comes from `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Archive set and workspace membership (host file)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Cleanup ledger (append-only, one uuid per line)
- `~/.dsh/trash/manage-session/` — Recycle bin: batch dirs + `archive/*.tar.zst`

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

## Caveats

- Deletion is irreversible in the end: the bin restores anything, but after `compact` you restore from `.tar.zst`; destroying a batch permanently needs `--yes`.
- Untitled is not a deletion leftover: zero-message sessions and `im:` encoded-id sessions simply have no title.
- The script refuses `trash/compact/restore` while a host process is alive (`--allow-running` overrides).

## FAQ

### No entry after installing?

Restart DSH; make sure it went into the profile you run, and that `cordis.patch.yml` does not disable `dsh-manage-session`.

### Archive vs delete?

Archiving only sets it aside and can be undone; deleting moves it to the recycle bin, drops bookkeeping, and stays restorable from the archive.

### Can it coexist with other archive plugins?

Yes. The archive set is shared host state, so both read the same data while keeping separate entries.

## License

Released under the [MIT License](LICENSE).

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

