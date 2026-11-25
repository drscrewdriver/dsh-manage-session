<div align="center">

# dsh-manage-session

**Консоль сессий · архив и корзина — активные и архивные сессии в одном месте**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · **Русский** · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> Плагин DeepSeek Harness (DSH), поддерживаемый сообществом; не официальный продукт DeepSeek AI.

Документ описывает **2.0.19**. Опубликованные изменения — в [журнале](CHANGELOG.md).

## Возможности

Ненужные сессии уходят в архив и возвращаются в любой момент; удаление идёт через корзину, а не через безвозвратную очистку.

- **Просмотр архивных сессий**: область «Архив» в панели перечисляет все архивные сессии с группировкой и счётчиками по рабочим пространствам.
- **Поиск по рабочему пространству**: чипы пространств, префикс `workspace:` и фильтр по заголовку/пути удерживают десятки проектов.
- **Восстановление и удаление**: восстановить = разархивировать (возврат в панель); удалить = архивировать → корзина → удаление uuid из учёта, обратимо.
- **Корзина и периодическое сжатие**: `trash` переносит в `~/.dsh/trash/manage-session/<партия>/`, `compact` объединяет партии по дню/неделе/месяцу в `.tar.zst`, `restore` возвращает обратно.
- **Избранное и пакетные действия**: звёздочка, режим «только избранное», пакетная архивация и удаление (двойное подтверждение).
- **Мгновенный первый экран + проверка здоровья по четырём воротам**: источники заголовков без I/O и потоковая дочитка кадрами (373 мс на 252 сессии); целостность логов, кэш проекций, JSON без потерь, завершение холодного чтения.

## Скриншоты

![Консоль: группы по пространствам и пакетный выбор](assets/new-manager.png)

![Архив: архивные сессии в одном месте](assets/old-archive.png)

![Старая панель: расположение входа](assets/left-sidebar-old.png)

## Установка

**Поддержка хоста**: `engines.dsh` — `>=0.1.0-rc.2 <0.3.0-0`; линии `0.1.x` и `0.2.x` проверены.

### Поручить установку агенту (рекомендуется)

```text
Установи последнюю версию dsh-manage-session в используемый мной профиль DSH из официального npm-реестра, затем подтверди версию и расскажи, как перезагрузить.
```

### Ручная установка / обновление

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

Затем перезапустите DSH (плагины хоста загружаются при старте) и обновите интерфейс — появится вход «Управление сессиями».

## Настройки

Пространство настроек `manage-session`:

- `enabled` (`true`) — Общий выключатель; при выключении панель и все fenced-маршруты не регистрируются
- `historyFiles` (`true`) — Пути записи: архивировать / разархивировать / удалить (корзина)
- `healthCheck` (`true`) — Проверка здоровья по четырём воротам и рецепты починки
- `directDelete` (`false`) — Показывать ли строку «Удалить» в меню сессии (по умолчанию выключено)

**Расположение входа**: верхний слот инструментов боковой панели, иначе нижняя панель.

## Использование

- **Архивировать сессию** — Выберите и нажмите «Архивировать» — сессия сразу исчезает из панели. Активные сначала останавливаются.
- **Восстановить сессию** — Выберите в области «Архив» и нажмите «Разархивировать» — вернётся в своё пространство.
- **Удалить сессию** — Два нажатия «Удалить»: сессия уходит в корзину, uuid сразу покидает учёт.
- **Поиск пространства** — Нажмите чип или введите `workspace:слово` в поиске.
- **Избранное** — Нажмите звёздочку; включите «только избранное» в меню вида.

## Архив, удаление и очистка (детерминированный скрипт)

Для полной очистки запускайте скрипт при закрытом хосте; он никогда не делает прямой `rm` данных сессий:

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list` классифицирует только для чтения: `orphan-id` (в учёте, нет на диске) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash` переносит в корзину и чистит учёт; `compact --window week` объединяет партии по периоду и опустошает напрямую восстанавливаемые каталоги.
- `restore --archive <период> [--ids ...]` восстанавливает; `ledger` — append-only журнал всех действий.
- **Зона надгробий**: `tombstones` показывает только неполные удаления (`pending-cleanup`); `forget` убирает записи без сущности.

## Хранение и маршруты

Файлы хоста резервируются перед записью; своего индекса сессий нет — поиск даёт `dsh-search-index`.

- `~/.dsh/storages/workspace.json` — Архивное множество и принадлежность пространствам (файл хоста)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — Журнал очистки (append-only, один uuid на строку)
- `~/.dsh/trash/manage-session/` — Корзина: каталоги партий + `archive/*.tar.zst`

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

## Важно

- Удаление в итоге необратимо: корзина вернёт всё, но после `compact` восстановление идёт из `.tar.zst`; окончательное уничтожение партии требует `--yes`.
- «Без названия» — не след удаления: сессии без сообщений и сессии с кодированным id `im:` просто не имеют заголовка.
- Пока процесс хоста запущен, скрипт отказывает в `trash/compact/restore` (`--allow-running` — принудительно).

## Частые вопросы

### После установки нет входа?

Перезапустите DSH; проверьте, что плагин стоит в используемом профиле и `cordis.patch.yml` не отключает `dsh-manage-session`.

### Архив или удаление?

Архив просто убирает и всегда возвращается; удаление переносит в корзину, чистит учёт и остаётся восстанавливаемым из архива.

### Совместимость с другими архивными плагинами?

Да. Архивное множество — общее состояние хоста: оба читают одни данные, входы независимы.

## Лицензия

Проект распространяется по [MIT License](LICENSE).

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

