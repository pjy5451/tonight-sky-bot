# 오늘 밤 하늘 — 설계서

폰 브라우저로 열면 내 위치 기준 오늘 밤 하늘, 실시간 위성 지구본, 로켓 발사 일정을 보여 주는 우주 웹앱.
개발은 Cursor 클라우드 에이전트가 하고, 배포는 GitHub Pages, 진행 알림은 텔레그램으로 받는다.

## 1. 화면

| 탭 | 내용 |
|---|---|
| 오늘 밤 | 일몰·일출, 달 위상, 밝은 행성과 방향, ISS 통과 시각, 다음 유성우 D-day |
| 위성 지구본 | 3D 지구 위 ISS·우주정거장 위성 실시간 위치 |
| 발사 일정 | 다가오는 로켓 발사 목록, 한국시간 카운트다운, 생중계 링크 |

## 2. 구조 원칙
- **서버 없음.** 정적 사이트(HTML/JS)만 배포한다. 천문 계산은 사용자 브라우저에서 한다.
- **외부 API는 빌드 때만 부른다.** GitHub Actions가 하루 1회 CelesTrak과 Launch Library 2에서 데이터를 받아 JSON으로 사이트에 포함한다. 방문자가 늘어도 외부 API 호출은 늘지 않는다.
- **개인정보를 보내지 않는다.** 위치는 브라우저 안에서만 쓰고 localStorage에만 저장한다.
- **로그인·DB·입력 폼 없음.** 공격받을 서버 부분이 없다.

## 3. 기술 스택

| 구분 | 선택 |
|---|---|
| 빌드 | Vite + TypeScript |
| 테스트 | vitest |
| 천문 계산 | astronomy-engine (해·달·행성), satellite.js (위성 궤도) |
| 지구본 | globe.gl (three.js) |
| 데이터 | CelesTrak GP(stations), Launch Library 2 (The Space Devs) |
| 배포 | GitHub Pages (`.github/workflows/deploy-site.yml`) |

npm 스크립트 약속: `npm ci` → `npm run fetch-data` → `npm run build` 결과가 `dist/`. 배포 워크플로가 이 순서에 의존한다.

## 4. 자동화 구성

| 역할 | 무엇으로 | 트리거 | 하는 일 |
|---|---|---|---|
| 개발 | Cursor Automation | 예약 (평일 밤) | BACKLOG 항목 하나 구현 → PR |
| QA | Cursor Automation | PR 열림·푸시 | 테스트·완료 기준 대조 → `[QA] 통과/반려` 코멘트 |
| PR 검사 | GitHub Actions ci.yml | PR | 테스트·빌드 |
| 배포 | GitHub Actions deploy-site.yml | main 머지, 매일 03:00 KST | 데이터 수집 → 빌드 → GitHub Pages 배포 → 텔레그램 알림 |
| 알림 | GitHub Actions telegram-notify.yml | PR 열림·머지, QA 코멘트 | 텔레그램 알림 |
| 아침 보고 | GitHub Actions morning-report.yml | 매일 07:30 KST | 머지 대기·어제 머지·남은 작업 |

## 5. 원칙
- 상태는 GitHub에 둔다. 작업 목록은 BACKLOG.md, 결과물은 PR, 판정은 PR 코멘트.
- PR 하나는 작업 하나. 진행 중 브랜치가 2개 이상이면 개발 자동화는 새 작업을 시작하지 않는다.
- QA 반려 후 자동 재수정은 하지 않는다. 사람이 판단해 수정을 지시한다.
- 데이터 출처(CelesTrak, The Space Devs)를 화면 하단에 표기한다.
