<div align="center">

# dsh-manage-session

**세션 콘솔 · 아카이브와 휴지통 — 활성/보관 세션을 한곳에서 관리**

[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)

[![npm](https://img.shields.io/npm/v/dsh-manage-session.svg?label=npm)](https://www.npmjs.com/package/dsh-manage-session)
[![downloads](https://img.shields.io/npm/dt/dsh-manage-session.svg?label=downloads)](https://www.npmjs.com/package/dsh-manage-session)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH Web plugin](https://img.shields.io/badge/DSH-Web%20plugin-0f766e.svg)](https://github.com/drscrewdriver/dsh-manage-session)
[![DSH >=0.1.0-rc.2 <0.3.0-0](https://img.shields.io/badge/DSH-%3E%3D0.1.0--rc.2%20%3C0.3.0--0-2563eb.svg)](https://github.com/drscrewdriver/dsh-manage-session)

</div>

> 커뮤니티가 관리하는 DeepSeek Harness(DSH) 플러그인이며 DeepSeek AI 공식 제품이 아닙니다.

이 문서는 **2.0.26** 기준입니다. 변경 내역은 [기록](CHANGELOG.md)을 참고하세요.

## 기능 개요

당분간 쓰지 않는 세션은 보관하고 필요할 때 되살립니다. 삭제는 휴지통을 거치며 되돌릴 수 없는 즉시 삭제는 하지 않습니다.

- **보관 세션 보기**: 패널의 “보관” 범위에서 모든 보관 세션을 작업공간별로 묶어 개수와 함께 보여줍니다.
- **작업공간 검색**: 작업공간 칩, `workspace:` 접두사, 제목/경로 부분 일치로 수십 개 프로젝트도 즉시 좁힙니다.
- **복원과 삭제**: 복원=보관 해제(사이드바 복귀), 삭제=보관 → 휴지통 이동 → 장부에서 uuid 제거(복원 가능).
- **휴지통과 주기 압축**: `trash`가 `~/.dsh/trash/manage-session/<배치>/`로 옮기고, `compact`가 일/주/월 단위로 `.tar.zst`에 병합하며 `restore`로 되돌립니다.
- **즐겨찾기와 일괄 작업**: 별표, 즐겨찾기만 보기, 일괄 보관/일괄 삭제(2단계 확인).
- **즉시 표시 + 4중 점검**: 제로 I/O 제목 소스 + 프레임 스트리밍 보충(252개 세션 첫 화면 373ms). 로그 무결성/투영 캐시/무손실 JSON/콜드 리드 점검.

## 화면

![관리 화면: 작업공간별 그룹과 일괄 선택](assets/new-manager.png)

![보관 보기: 보관 세션 모아 관리](assets/old-archive.png)

![구버전 사이드바: 진입 위치 비교](assets/left-sidebar-old.png)

## 설치

**호스트 지원**: `engines.dsh`는 `>=0.1.0-rc.2 <0.3.0-0`이며 `0.1.x`/`0.2.x` 두 계열 모두 검증했습니다.

### Agent에게 설치시키기(권장)

```text
dsh-manage-session 최신 버전을 현재 사용 중인 DSH 프로필에 공식 npm 레지스트리로 설치하고, 버전 확인과 재로딩 방법을 알려주세요.
```

### 수동 설치/업데이트

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

dsh plugin --profile web add dsh-manage-session@latest --registry=https://registry.npmjs.org/
```

설치 후 DSH를 재시작하세요(호스트 플러그인은 시작 시 로드됩니다). 화면을 새로고침하면 “세션 관리” 진입점이 보입니다.

## 설정

설정 네임스페이스는 `manage-session`입니다.

- `enabled` (`true`) — 전체 스위치. 끄면 패널과 모든 fenced 라우트가 등록되지 않음
- `historyFiles` (`true`) — 보관/보관 해제/삭제(휴지통) 쓰기 경로
- `healthCheck` (`true`) — 4중 점검과 수리 처방
- `directDelete` (`false`) — 사이드바 세션 메뉴에 “삭제” 행 표시 여부(기본 꺼짐)

**진입 위치**: 호스트가 상단 도구 슬롯을 제공하면 “플러그인” 행 뒤, 아니면 하단으로 배치됩니다.

## 사용법

- **세션 보관** — 선택 후 “보관”. 사이드바에서 즉시 사라지며 실행 중 세션은 활동 중지 후 보관됩니다.
- **세션 복원** — “보관” 범위에서 선택 후 “보관 해제”. 원래 작업공간으로 돌아갑니다.
- **세션 삭제** — “삭제”를 두 번 눌러 확정. 휴지통으로 옮기고 uuid는 장부에서 즉시 제거됩니다.
- **작업공간 검색** — 작업공간 칩을 누르거나 검색창에 `workspace:키워드`를 입력합니다.
- **즐겨찾기** — 별표로 등록하고 보기 메뉴에서 “즐겨찾기만”을 켭니다.

## 보관·삭제·정리(결정적 스크립트)

호스트를 종료한 뒤 스크립트를 실행하는 편이 확실합니다. 스크립트는 세션 데이터를 직접 `rm`하지 않습니다.

```bash
node node_modules/dsh-manage-session/scripts/session-purge.mjs list
node node_modules/dsh-manage-session/scripts/session-purge.mjs trash --class empty-session --archive-first
node node_modules/dsh-manage-session/scripts/session-purge.mjs compact --older-than 7 --window week
node node_modules/dsh-manage-session/scripts/session-purge.mjs restore --archive <period> [--ids <id,...>]
node node_modules/dsh-manage-session/scripts/session-purge.mjs ledger
```

- `list`는 읽기 전용 분류: `orphan-id`(장부만/실체 없음) / `empty-session` / `untitled-session` / `encoded-id` / `ok`.
- `trash`는 휴지통으로 옮기고 장부를 정리합니다. `compact --window week`는 주기별로 병합 재압축하고 바로 복원 가능한 흩어진 디렉터리를 비웁니다.
- `restore --archive <주기> [--ids ...]`로 복원하고, `ledger`는 모든 정리 작업의 append-only 대장입니다.
- **묘비 영역**: `tombstones`는 삭제가 덜 된 항목(`pending-cleanup`)만 보여 주고, `forget`은 실체가 없는 묘비를 제거합니다.

## 저장 위치와 라우트

호스트 파일은 쓰기 전에 자동 백업합니다. 자체 세션 색인은 없고 검색은 `dsh-search-index`가 담당합니다.

- `~/.dsh/storages/workspace.json` — 보관 집합과 작업공간 소속(호스트 파일)
- `~/.dsh/storages/manage-session/purge-ledger.jsonl` — 정리 대장(append-only, uuid 단위)
- `~/.dsh/trash/manage-session/` — 휴지통: 배치 디렉터리 + `archive/*.tar.zst`

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

## 주의 사항

- 삭제는 최종적으로 되돌릴 수 없습니다. 휴지통에서 복원되지만 `compact` 이후에는 `.tar.zst`에서 복원하며, 배치 영구 파기는 `--yes`가 필요합니다.
- “제목 없음”은 삭제 잔해가 아닙니다. 메시지 0건의 빈 세션과 `im:` 인코딩 ID 세션은 원래 제목이 없습니다.
- 호스트가 실행 중이면 스크립트는 `trash/compact/restore`를 거부합니다(`--allow-running`으로 명시적 우회).

## 자주 묻는 질문

### 설치 후 진입점이 없어요

DSH를 재시작하고, 현재 프로필에 설치되었는지와 `cordis.patch.yml`에서 `dsh-manage-session`을 비활성화하지 않았는지 확인하세요.

### 보관과 삭제의 차이

보관은 잠시 치우는 것이고 언제든 복원됩니다. 삭제는 휴지통으로 옮기고 장부도 정리하지만 압축 후에도 아카이브에서 복원할 수 있습니다.

### 다른 보관 플러그인과 함께 써도 되나요?

가능합니다. 보관 집합은 호스트 공유 상태라 두 플러그인이 같은 데이터를 읽고 진입점은 각자 독립입니다.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)를 따릅니다.

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

