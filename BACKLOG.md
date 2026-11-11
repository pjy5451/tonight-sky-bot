# 백로그

에이전트는 위에서부터 `- [ ]` 항목을 하나씩 처리한다. 완료되면 같은 PR에서 `- [x]`로 바꾼다.
사람은 새 작업을 맨 아래에 같은 형식으로 추가한다.

- [x] **01 프로젝트 골격** — Vite + TypeScript 정적 웹앱. vitest. package-lock.json 커밋. npm 스크립트 `dev`, `build`(결과물 `dist/`), `test`, `fetch-data`(지금은 `public/data/`에 빈 JSON을 쓰는 스텁)를 만든다. vite `base: './'`. PR용 CI `.github/workflows/ci.yml`(npm ci → test → build, pull_request 트리거). 모바일 우선 어두운 테마 레이아웃과 탭 3개(오늘 밤 / 위성 지구본 / 발사 일정) 빈 화면. 하단에 데이터 출처 표기 자리. / 완료 기준: CI 통과, `npm run build` 후 `dist/index.html` 생성, 탭 전환 테스트.
- [x] **02 위치 선택** — 브라우저 위치 권한으로 위도·경도 받기, 거부 시 시·도 17개 목록에서 선택(시·도청 위치를 대표 좌표로, 출처 주석). 좌표는 소수점 1자리로 반올림해 localStorage에 저장하고 다음 방문 때 재사용. 위치를 서버로 보내지 않는다. / 완료 기준: 반올림·저장·불러오기 단위 테스트.
- [x] **14 Argonova 디자인 적용** — 화면 이름을 Argonova로 바꾸고(큰 제목·`<title>`·매니페스트 이름, 부제 "오늘 밤, 하늘을 탐험하다"), DESIGN.md 5장의 색·글꼴(Noto Sans KR, Space Grotesk)·카드 모양과 `mockup-today.html`·`mockup-globe.html`·`mockup-launches.html`의 공통 틀(위쪽 보조 문구+큰 제목, 아래 탭 바 `#0E1428`, 현재 탭 주황)을 전체 화면에 적용. 아직 기능이 없는 탭은 목업과 같은 모양의 카드에 '준비 중' 문구만 넣는다. 기존 기능(탭 전환, 위치 선택)은 유지. 1024px 이상 PC 레이아웃은 12번에서 하므로 여기서는 하지 않는다. / 완료 기준: 제목이 Argonova인지·탭 바가 화면 아래에 있는지 테스트, 기존 테스트 모두 통과, 390px 너비에서 가로 스크롤 없음.
- [x] **03 데이터 수집** — `npm run fetch-data`가 CelesTrak GP JSON(GROUP=stations)을 `public/data/tle.json`으로, Launch Library 2(The Space Devs) 공개 API의 다가오는 발사 20개를 `public/data/launches.json`으로 저장. 각 파일에 `fetched_at` 기록. 요청 실패 시 `{"error": "...", "items": []}`를 쓰고 종료 코드 0으로 끝낸다(빌드를 막지 않음). 브라우저는 외부 API를 직접 부르지 않고 이 JSON만 읽는다. / 완료 기준: fetch를 모킹한 성공·실패 테스트.
- [x] **04 오늘 밤 패널** — astronomy-engine으로 선택 위치의 일몰·일출 시각, 달 위상(%)과 모양, 지평선 위에 있는 금성·화성·목성·토성과 16방위 한글 방향. 시각은 한국시간 표시. / 완료 기준: 고정 날짜·좌표 테스트로 일몰 ±2분 이내.
- [ ] **05 ISS 통과 예측** — satellite.js와 tle.json으로 앞으로 3일 밤의 ISS 통과 목록: 시작·최고·종료 시각, 16방위 방향, 최고 고도. 조건: 최고 고도 10° 이상, 관측자 위치 태양 고도 −6° 이하, ISS가 햇빛을 받는 구간. 아래 기준값 날짜의 TLE를 테스트 픽스처로 저장해 사용. / 완료 기준: 기준값과 시각 오차 ±1분 이내. / 기준값: (사람이 채움)
- [x] **06 실시간 위성 지구본** — globe.gl(three.js 기반)로 3D 지구 위에 ISS와 stations 그룹 위성의 현재 위치를 표시하고 몇 초마다 갱신. ISS는 강조하고 궤도선 표시. 지구 텍스처는 저장소에 포함(외부 CDN 의존 금지). 모바일에서 부드럽게 동작하도록 갱신 주기 조절. / 완료 기준: 위성 위치 계산 함수 단위 테스트, 빌드 통과.
- [ ] **07 발사 일정** — launches.json으로 다가오는 발사 목록: 발사체, 운영사, 발사장, 한국시간 발사 시각, 카운트다운, 생중계 링크(있으면). 데이터가 비었거나 오류면 안내 문구. / 완료 기준: 한국시간 변환·카운트다운 단위 테스트, 빈 데이터 테스트.
- [ ] **08 유성우 캘린더** — 주요 유성우 극대일 정적 테이블. 오늘 밤 패널에 다음 유성우까지 D-day 한 줄. / 완료 기준: 날짜 계산 테스트.
- [ ] **09 공유·홈 화면 추가** — 페이지 제목·설명·og 이미지, 파비콘, 웹 앱 매니페스트(홈 화면에 추가 가능). / 완료 기준: 빌드 결과물에 매니페스트와 메타 태그 존재 확인 테스트.
- [ ] **10 품질 점검** — 로딩·오류 상태 표시, 기본 접근성(대비, 버튼 라벨), 데이터 갱신 시각 표시, README에 사이트 주소와 구조 설명. / 완료 기준: 각 탭의 오류 상태 테스트, README 갱신.
- [ ] **11 보안 헤더** — Cloudflare Pages용 `public/_headers`: Content-Security-Policy(`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()`. 빌드 결과 `dist/_headers`에 포함되어야 한다. 지구본 텍스처 등이 막히면 외부 주소를 허용하지 말고 이미지를 `public/`에 넣어 같은 출처로 쓴다. / 완료 기준: 빌드 후 `dist/_headers` 존재와 헤더 값 테스트, 각 탭이 CSP에 막히지 않는지 확인한 내용을 PR 본문에.
- [ ] **12 PC 반응형 레이아웃** — DESIGN.md 5-1과 `mockup-desktop.html`대로, 화면 너비 1024px 이상은 위쪽 메뉴 + 한 화면 대시보드, 미만은 지금의 폰 탭 구조. / 완료 기준: 390px·1440px 너비에서 레이아웃 테스트(1440px에서 탭 바 숨김·위쪽 메뉴 표시), 두 너비 모두 가로 스크롤 없음.
- [ ] **13 영어 지원** — DESIGN.md 7장 0번. 화면 글자를 한국어·영어 사전 파일로 분리하고, KO·EN 버튼으로 바꾸며 선택을 localStorage에 저장. 첫 방문은 브라우저 언어가 한국어면 한국어, 아니면 영어. 방위·날짜·시각도 언어에 맞게 표시. / 완료 기준: 두 사전의 키가 같은지 테스트, 언어 전환 테스트, 영어 모드에 한글이 남지 않는지 테스트.
