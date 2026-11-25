<div align="center">

# dsh-manage-session

**Console de sessions · archivage et corbeille — gérez les sessions actives et archivées au même endroit**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Français** · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> Extension DeepSeek Harness (DSH) maintenue par la communauté, non officielle.

Ce document décrit **2.0.16**. Voir le [journal](CHANGELOG.md) pour les changements publiés.

## Aperçu des fonctions

Mettez de côté les sessions inutiles en archive et reprenez-les à tout moment ; la suppression passe par une corbeille, jamais par un effacement irréversible.

- **Vue des sessions archivées** : la portée « Archivé » du panneau liste toutes les sessions archivées, groupées et comptées par espace de travail.
- **Recherche par espace de travail** : puces d’espace, préfixe `workspace:` et filtre sur titre/chemin pour garder des dizaines de projets exploitables.
- **Restaurer et supprimer** : restaurer = désarchiver (retour dans la barre latérale) ; supprimer = archiver → corbeille → retrait de l’uuid, réversible.
- **Corbeille et compactage périodique** : `trash` déplace vers `~/.dsh/trash/manage-session/<lot>/`, `compact` fusionne les lots par jour/semaine/mois en `.tar.zst`, `restore` les remet en place.
- **Favoris et actions groupées** : étoiles, vue « favoris uniquement », archivage et suppression par lot (double confirmation).
- **Premier affichage instantané + bilan santé à quatre portes** : titres sans I/O et complétion par flux de trames (373 ms pour 252 sessions) ; intégrité des journaux, cache de projection, JSON sans perte, fin de lecture à froid.

## Aperçus

![Console : groupes par espace de travail et sélection multiple](assets/new-manager.png)

![Vue archivée : les sessions archivées au même endroit](assets/old-archive.png)

![Ancienne barre latérale : emplacement de l’entrée](assets/left-sidebar-old.png)

## Installation

**Hôte pris en charge** : `engines.dsh` = `>=0.1.0-rc.2 <0.3.0-0` ; les branches `0.1.x` et `0.2.x` sont vérifiées.

### Laisser un agent l’installer (recommandé)

```text
Installe la dernière version de dsh-manage-session dans le profil DSH que j’utilise, depuis le registre npm officiel, puis confirme la version et indique-moi comment recharger.
```

### Installation / mise à jour manuelle

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Redémarrez DSH ensuite (les extensions hôte se chargent au démarrage), puis rafraîchissez l’interface pour voir l’entrée « Gestion des sessions ».

## Configuration

Espace de noms de réglages `manage-session` :

- `enabled` (`true`) — Interrupteur principal ; désactivé, le panneau et toutes les routes fenced ne sont pas enregistrés
- `historyFiles` (`true`) — Chemins d’écriture archiver / désarchiver / supprimer (corbeille)
- `healthCheck` (`true`) — Bilan santé à quatre portes et prescriptions de réparation
- `directDelete` (`false`) — Afficher ou non une ligne « Supprimer » dans le menu de session (désactivé par défaut)

**Emplacement de l’entrée** : dans l’emplacement d’outils en haut de la barre latérale s’il existe, sinon en pied de barre.

## Utilisation

- **Archiver une session** — Sélectionnez puis « Archiver » ; elle quitte la barre latérale aussitôt. Une session active est arrêtée puis archivée.
- **Restaurer une session** — Sélectionnez dans la portée « Archivé » puis « Désarchiver » ; elle revient dans son espace.
- **Supprimer une session** — Deux clics sur « Supprimer » ; la session va dans la corbeille et son uuid quitte la comptabilité immédiatement.
- **Rechercher un espace** — Cliquez une puce d’espace, ou saisissez `workspace:motclé` dans la recherche.
- **Favoris** — Cliquez l’étoile ; activez « favoris uniquement » dans le menu d’affichage.

## Archivage, suppression et nettoyage (script déterministe)

Lancez le script hôte fermé pour un nettoyage complet ; il ne fait jamais de `rm` direct sur les données de session :

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` classe en lecture seule : `orphan-id` (en comptabilité, absent du disque) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` déplace vers la corbeille et nettoie la comptabilité ; `compact --window week` fusionne les lots par période et vide les dossiers restaurables directement.
- `restore --archive <période> [--ids ...]` restaure ; `ledger` est le registre append-only de toutes les opérations.
- **Zone des tombstones** : `tombstones` n’affiche que les suppressions incomplètes (`pending-cleanup`) ; `forget` retire les entrées dont l’entité a disparu.

## Stockage et routes

Les fichiers de l’hôte sont sauvegardés avant écriture ; aucun index de sessions propre, la recherche vient de `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Ensemble archivé et appartenance aux espaces (fichier hôte)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Registre de nettoyage (append-only, un uuid par ligne)
- `~/.dsh/trash/manage-session/` — Corbeille : dossiers de lots + `archive/*.tar.zst`

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

## Points d’attention

- La suppression reste irréversible : la corbeille restaure tout, mais après `compact` il faut restaurer depuis `.tar.zst` ; détruire un lot exige `--yes`.
- « Sans titre » n’est pas un résidu de suppression : les sessions sans message et les sessions à id encodé `im:` n’ont simplement pas de titre.
- Le script refuse `trash/compact/restore` tant qu’un processus hôte tourne (`--allow-running` pour forcer).

## Questions fréquentes

### Aucune entrée après installation ?

Redémarrez DSH ; vérifiez le profil utilisé et que `cordis.patch.yml` ne désactive pas `dsh-manage-session`.

### Archiver ou supprimer ?

Archiver met de côté et se défait ; supprimer passe par la corbeille, retire la comptabilité, et reste restaurable depuis l’archive.

### Coexistence avec d’autres extensions d’archivage ?

Oui. L’ensemble archivé est un état partagé de l’hôte : les deux lisent les mêmes données, avec des entrées séparées.

## Licence

Distribué sous [MIT License](LICENSE).

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

