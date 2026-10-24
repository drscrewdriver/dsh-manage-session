# Changelog

## 1.0.0

`dsh-session-steward` 0.5.7에서 복제·개명한 독립 패키지의 첫 버전입니다(구 패키지 이력은 해당
저장소 CHANGELOG 참조). 이 패키지의 정체성은 **세션 매니저**: 활성·보관 세션의 통합 관리와 전문 검색.

### 정체성과 이름

- 패키지명 / 플러그인 id: `dsh-session-steward` → `dsh-manage-sessions`. 표시 이름: 세션 관리(9개 언어 동기화).
- 설정 네임스페이스: `session-steward` → `manage-sessions`, `switch-search` → `manage-sessions-search`.
- 라우트 접두사: `/session-steward/api` → `/manage-sessions/api`, `/switch-search/api` → `/manage-sessions-search/api`.
- 저장소: 색인·묘비 기본 디렉터리 `~/.dsh-switch-search` → `~/.dsh-manage-sessions-index`,
  즐겨찾기 `session-steward-favorites.json` → `manage-sessions-favorites.json`(구 패키지와 충돌 없음).
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
