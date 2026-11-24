# Changelog

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
