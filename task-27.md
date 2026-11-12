status: fix-needed
attempts: 1
pr: 28
branch: task-27-drop-tagline
title: [task-27] 부제 문구 걷어내기

## 최근 피드백

<!-- CURSOR_AUTOMATION_ID: fc5fe75e-dcf2-11f1-ba91-f63b1661ac50 | RUN_ID: bc-bf0a9b8c-235e-4941-9a3f-e95148ab1b93 -->
[QA] 반려

npm ci 성공. npm test 182개 통과. npm run build 성공.
origin/main의 27번은 [ ]이다. 같은 저장소 PR이고 브랜치는 task-27-drop-tagline이다. 워크플로·package.json·public/_headers 변경 없음. 브라우저 fetch는 data JSON만이다.

완료 기준:
- 화면 부제: 충족. h1은 날짜·지역이다. 2026-11-12T03:00:00Z 한국어는 `11월 12일 (목)`, 영어는 `11/12 (Thu)`. 장소가 있으면 ` · 서울` / ` · Seoul`. `.eyebrow`와 brandTagline은 없다. 언어 전환이 제목을 다시 그린다.
- `<title>`·매니페스트 이름: 충족. 둘 다 Argonova.
- 메타 설명: 충족. `선택한 위치의 밤하늘과 위성 위치, 로켓 발사 시각.`
- DESIGN.md 5장 금지 규칙: 충족. 요구 문장과 날짜·지역 제목 규칙이 있다.
- 텍스트 검색: 충족. `탐험`과 `하늘, 위성, 발사 일정`은 DESIGN.md 금지 문장 한 줄뿐이다. tests/copy.test.ts가 검사한다. 다른 테스트 파일의 it 개수는 origin/main과 같고, 추가는 copy 1개와 i18n 1개뿐이다.
- 공유 문구: 미충족. public/og.png(1200×630, og:image·twitter:image)에 `오늘 밤, 하늘을 탐험하다`가 그대로 그려져 있다. 텍스트 검색은 png 픽셀을 보지 않는다.

고칠 것:
public/og.png를 다시 만들어 부제 줄을 지운다. 앰버 별, Argonova 단어, 배경 #05070D, 1200×630은 유지한다. tests/share.test.ts 용량(5KB 초과, 600KB 이하)을 맞춘다. 새 npm 패키지는 넣지 않는다. 이미지를 그리는 글자 원본을 저장소에 두면 그 원본에도 `탐험`과 `하늘, 위성, 발사 일정`이 있으면 안 된다.

<div><a href="https://cursor.com/agents/bc-bf0a9b8c-235e-4941-9a3f-e95148ab1b93?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/automations/fc5fe75e-dcf2-11f1-ba91-f63b1661ac50"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/view-automation-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/view-automation-light.png"><img alt="View Automation" width="141" height="28" src="https://cursor.com/assets/images/view-automation-dark.png"></picture></a>&nbsp;</div>

<sub>Sent by Cursor Automation: QA</sub>

