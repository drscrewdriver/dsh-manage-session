# Changelog

## 2.0.21

**수정: 인코딩된 ID 세션(`im:` / `imu:`)이 완전히 삭제되지 않음(장부는 지워졌는데 디렉터리는 남음).**

- 원인: 호스트가 `session-` 접두사만 제거했는데, `im:` 세션의 디렉터리 이름은 `~XXXX` 인코딩(`im~003A…~0040im.wechat`)이라 위치를 찾지 못했고 사후 검증도 “삭제됨”으로 오판했습니다.
- 수정: 호스트에 `encodeSegment` / `decodeSegment`를 추가하고 디렉터리 색인에 4가지 키(원명/접두사 제거/디코딩 id/디코딩+제거)를 등록; `locateSessionUsage`와 투영 캐시 파일 탐색도 후보로 매칭합니다.
- 함께 수정: `im:` 세션의 제목 읽기(캐시 파일명도 인코딩명이라 항상 miss였음).

## 2.0.20

**정리 명령을 절대 경로 자동 조합으로 변경: `node_modules/...` 하드코딩도, profile로 cd도 필요 없습니다.**

- 호스트 `session-tombstones`가 `scriptPath`를 반환: 패키지의 `lib/index.js` 위치에서 `../scripts/session-purge.mjs`를 도출.
- 패널은 반환된 경로로 명령을 조합하며, 공백이 있으면 자동으로 큰따옴표를 붙입니다. 구버전 호스트는 상대 경로로 폴백.
- 문구를 "profile에서 실행"에서 "바로 실행(아래는 현재 설치 경로)"로 변경.

## 2.0.19

**정리 탭 명령표: 각 줄에 “읽기 전용 / 쓰기·복원 가능 / 파괴적”을 표시하고 설명을 붙였습니다.**

- 5개 명령을 `pre` 하나에 몰아넣지 않고(조회와 삭제 구분 불가 지적), 한 줄씩 **분류 배지 + 명령 + 설명 + 개별 복사**.
- 분류: `list` / `tombstones` / `ledger` = **읽기 전용**; `trash` / `compact` / `restore` = **쓰기·복원 가능**; `purge --batch --yes` = **파괴적**(복구 불가).
- 상단에 범례를 추가하고 “전체 복사”는 유지합니다.

## 2.0.18

**정리 영역을 탭으로 이동: 관리 화면 하단에서 “검진” 옆 백그라운드 탭으로.**

- 패널이 3탭: **관리 / 검진 / 정리**. `historyFiles=false`면 정리 탭, `healthCheck=false`면 검진 탭을 숨깁니다.
- 탭 내용: 삭제가 덜 된 항목 목록 + 다시 삭제 / 묘비 철회 + 5개 명령 일괄 복사 + 대장 경로(DSH 종료 후 실행 안내).
- 독립 컴포넌트 `cleanup-panel.tsx`(자체 스타일)로 분리: 탭 전환 시 관리 화면 언마운트에 영향받지 않고, 관리 화면은 세션 목록만 남습니다.

## 2.0.17

**관리 화면에 "정리 영역" 추가: 덜 지운 항목을 보여 주고 바로 처리하며, 삭제 명령도 복사할 수 있습니다.**

- 패널 하단에 "정리 영역": `session-tombstones`는 **삭제가 덜 된 항목**(`pending-cleanup` / 무효 묘비)만 반환하고 uuid·이유·상태를 행으로 보여 줍니다.
- 행 동작: **다시 삭제**(purge 재사용: 보관 → detach → 삭제 → 사후 검증)와 **묘비 철회**(실체가 없을 때만 표시, host에서 재검증).
- 명령 복사: `list / trash / compact / tombstones / ledger` 다섯 줄을 한 번에 복사(DSH 종료 후 profile에서 실행하라고 안내). 대장 경로도 표시합니다.
- 신규 메서드: `session-tombstones`(읽기 전용), `session-tombstone-forget`(쓰기, 실체가 남아 있으면 거부). `historyFiles` 스위치 아래에서 동작합니다.

## 2.0.16

**README 단일 소스 생성(10개 언어) + 작업공간 검색 접두사 + archive 키워드 보강.**

- README는 `docs/readme/i18n.mjs`(문안)와 `scripts/gen-readme.mjs`(골격)에서 생성하며, `scripts/check-readme.mjs`가 버전 일치·제목 동형·archive 키워드·링크·files 화이트리스트를 검사합니다(`prepublishOnly`에 연결).
- 검색창에서 `工作区:` / `workspace:` 접두사를 지원합니다(반각/전각 콜론). cwd만 비교하고 그 외 입력은 제목/경로 부분 일치로 처리합니다.
- `description` / `keywords` / `dsh.plugin.json` 문구를 archive·보관·휴지통·restore를 포함하도록 통일했습니다(패키지명 변경이나 alias 패키지는 사용하지 않음).
- **묘비 영구 저장 + 콜드 재사용 프로브**: 삭제 결과를 `~/.dsh-manage-session-index/retired-tombstones.jsonl`에(createdAt/cwd/state 포함) 기록합니다. `deleted`는 재시작 후에도 숨기고, 같은 id라도 신원이 다르면 새 세션으로 판단해 묘비를 철회합니다.
- **삭제 후 사후 검증**: 실제로 지운 항목만 `deleted`로 기록하고, 디렉터리/캐시가 남아 있으면 `pending-cleanup`(**숨기지 않음**)으로 두고 패널에 "미완전 삭제 N건"을 표시합니다.
- **묘비 영역 정리**: 스크립트에 `tombstones`(미완전 삭제만 표시)와 `forget`(실체가 없는 항목만 허용)를 추가했고, `trash` 성공과 `restore`는 해당 묘비를 자동으로 철회합니다.

## 2.0.15

**결정론적 정리 스크립트(휴지통 버전, "파일은 지웠는데 uuid가 남는" 유령 행 수정).**

- `scripts/session-purge.mjs` 추가: 호스트 종료 후 실행하며 **세션 데이터를 직접 rm하지 않습니다** —— `list`(읽기 전용 분류: `orphan-id` / `empty-session` / `untitled-session` / `encoded-id` / `ok`) → `archive`(아카이브 집합에 쓰고 재검증) → `trash`(세션 디렉터리와 투영 캐시를 `~/.dsh/trash/manage-session/<batch>/`로 통째 이동하고 `manifest.json` 기록, 이후 장부에서 uuid 제거) → `compact`(주기 day/week/month 단위로 만료 배치를 하나의 `archive/<주기>.tar.zst`로 병합 재압축하고, 바로 복원 가능한 흘어진 디렉터리를 비움) → `restore`(휴지통 또는 아카이브에서 그대로 복원) → `ledger`(append-only 대장: uuid / cwd / 바이트 / sha256).
- 순서는 "아카이브 → 재검증 → 파일 이동 → 장부 정리"로 고정되며 어느 단계에서 실패해도 재시도 가능한 상태로 멈춥니다. `purge`는 실체가 없는 유령 uuid 전용이고, 배치 영구 삭제는 `purge --batch <이름> --yes`가 필요합니다.
- 호스트 프로세스가 실행 중이면 trash/compact/restore를 거부합니다(`--allow-running`으로 명시적 우회). 이동 대상은 `<dshHome>/sessions/<workspace>/<session>/`의 직접 하위 항목만 허용합니다.
- 세션 id ↔ 디렉터리 이름 양방향 인코딩(`~XXXX`)을 지원해 `im:` 가상 세션도 목록·휴지통·복원이 가능합니다.

## 2.0.14

**관리대 상호작용 세 가지 수정(사용자 피드백).**

- **일괄 작업 바가 떠 있는 컨트롤에 가려지지 않음**: 하단 전체 폭 바(버튼이 오른쪽 끝으로 밀리던 형태)를 왼쪽 아래에 떠 있는 카드로 변경(`batchInfo` 를 `flex:0 1 auto` 로, 버튼은 「N개 선택」 바로 뒤). 10px 위로 올리고 테두리/그림자를 넣어 오른쪽 아래의 보기 전환(세그먼트/카드/접기)과 겹치지 않습니다.
- **더블 클릭으로 열기, 한 번 클릭은 선택만(오터치 방지)**: 행 클릭으로 세션을 바로 열지 않습니다 — 한 번 클릭은 카드 선택만, 열려면 더블 클릭(또는 키보드 Enter/스페이스). 실제로 열 때는 먼저 패널 페이지를 닫고(`layout.selectPanel(null)`) 다음 프레임에 `uiWorkspace.openSession` 으로 넘깁니다(호스트가 「세션을 먼저 바꾸고 마지막에 패널을 닫아」 첫 클릭이 무효였던 문제를 회피).
- **내비게이션 내결함성(이상하게 튕겨나가지 않음)**: 내비게이션 서비스 부재/삭제된 세션/서비스 예외는 패널 안의 오류 띠(`manage.open.failed`: 「{id}」을 열 수 없음: 이유)로 바뀌며 수동으로 닫을 수 있습니다. 패널, 선택, 스크롤 위치는 그대로 유지됩니다.

## 2.0.13

**첫 화면 즉시 표시 + 제목의 프레임 단위 스트리밍 보완.**

- `session-catalog`는 `sessionQuery.readTitleSnapshots`(로그 전체를 풀어 마지막 제목을 fold하는 계약. 실측 252 세션 / 858 MB / 12.4초)를 더 이상 호출하지 않습니다. 제목은 I/O 없는 3단계로 해결합니다: 활성 세션의 라이브 투영 → `sessionProjectionCache` 체크포인트 → 세션별 캐시 파일. 모두 없을 때만 `pending`이 됩니다. 실측: 243/252는 첫 응답에 제목이 있고(세 서비스가 모두 없고 캐시 파일만 쓸 때도 373 ms), `pending`은 9건.
- fenced 메서드 **`session-catalog-stream`** 추가(`text/event-stream`, POST 전용): `pending`을 DRS 방식의 **프레임 단위**로 읽습니다 — 선두 256 KB 창에서 `session/title` 프레임이 나올 때까지만 압축을 풀고, 프레임마다 `await`(스레드 풀)하며 8프레임마다 제어를 놓아줍니다. 창은 ×4로 8 MB / 32프레임 / 8초 예산까지. 실측: 9건 중 5건을 558 KB·35프레임·26 ms로 보완, 최종 커버리지 248/252(나머지 4건은 정말로 `session/title`이 없음).
- `titleSource` 필드 추가: `live` / `cache` / `pending` / `none`(구 클라이언트는 무시 가능).
- 중단 가능: 패널을 닫거나 클라이언트 abort → `req|res.close`가 `AbortController`를 발동해 호스트가 즉시 읽기를 멈춥니다(`aborted after N frames`).
- 프로세스 내 제목 memo(5분 TTL, `live`는 넣지 않고 `none`은 부정 결로로 보관). 정리 후에는 id 단위, 보관/해제 후에는 전량 무효화.
- 덤으로 고침: `runtime.sessionQuery`를 지연 getter로(서비스가 늦게 붙을 때 영원히 `undefined`이던 것).

## 1.0.0

`dsh-session-steward` 0.5.7에서 복제·개명한 독립 패키지의 첫 버전입니다(구 패키지 이력은 해당
저장소 CHANGELOG 참조). 이 패키지의 정체성은 **세션 매니저**: 활성·보관 세션의 통합 관리와 전문 검색.

### 정체성과 이름

- 패키지명 / 플러그인 id: `dsh-session-steward` → `dsh-manage-session`. 표시 이름: 세션 관리(9개 언어 동기화).
- 설정 네임스페이스: `session-steward` → `manage-session`, `switch-search` → `manage-session-search`.
- 라우트 접두사: `/session-steward/api` → `/manage-session/api`, `/switch-search/api` → `/manage-session-search/api`.
- 저장소: 색인·묘비 기본 디렉터리 `~/.dsh-switch-search` → `~/.dsh-manage-session-index`,
  즐겨찾기 `session-steward-favorites.json` → `manage-session-favorites.json`(구 패키지와 충돌 없음).
- 스타일 접두사 `dss_`/`dsws_` → `dms_`/`dmss_`. 스타일시트 id와 data 속성도 개명.

### 신규: 진입점 위치(상단 도구 슬롯 / 하단 대체)

- 호스트가 상단 도구 행(`sidebar.panellist` 패널 행 + `main` 페이지 슬롯)을 선언하면 검색·관리 두
  진입점이 **패널 행**으로 「플러그인」 행 바로 뒤, 「더 보기」 런처 앞(order 5/6)에 놓이고 클릭 시
  메인 열에 전체 페이지로 열립니다. 페이지의 「닫기」는 대화로 복귀합니다.
- 해당 슬롯이 없는 호스트(구버전/간소 레이아웃)는 사이드바 하단(`sidebar.footer.action`)으로 대체되어
  플로팅 대화상자를 엽니다.
- 판정은 로드 시점(`slots.specDynamic`로 두 좌석 확인). 슬롯이 늦게 생기면 하단 진입점을 제거하고 상단 전환.
- 패널 행/페이지는 설정 스위치(`enabled` / `search` / `healthCheck`)와 연동되어 즉시 반영됩니다.

### 부수 변경

- 패널에 전체 페이지 형태(`variant: 'page'`) 추가: 오버레이·부동 배치를 제거하고 메인 열을 채웁니다.
  대화상자 형태는 그대로입니다.
- 문서 개편: README / INSTALL 4개 언어 동기화(정체성·진입점·라우트·설정 표). 호환 절은
  `scripts/sync-hosts.mjs` 단일 소스 생성 유지.
- 지원 호스트 화이트리스트 불변: `engines.dsh`는 0.1.0-rc.2 ~ 0.2.1-rc.3 rc 열거.
