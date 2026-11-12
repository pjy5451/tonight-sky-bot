status: fix-needed
attempts: 1
pr: 22
branch: task-19-data-refresh
title: [task-19] 위성 데이터 안정화 (긴급)

## 최근 피드백

<!-- CURSOR_AUTOMATION_ID: fc5fe75e-dcf2-11f1-ba91-f63b1661ac50 | RUN_ID: bc-ee5cef36-1397-4b40-9cc9-604adfe89a47 -->
[QA] 반려

npm ci 성공, npm test 147개 통과, npm run build 성공. origin/main의 19번은 아직 [ ]이고, 같은 저장소의 PR이다. 보호된 워크플로 파일은 바꾸지 않았고, 빌드 결과에 celestrak.org, thespacedevs.com, raw.githubusercontent.com은 없다. 기존 테스트는 지워지지 않았다.

완료 기준:
- 실패한 묶음이 이전 성공본을 덮어쓰지 않음: 반려. stations·발사 실패, starlink 묶음 실패, 묶음 전체 실패는 테스트가 파일을 유지한다. 한국 위성 NAME 검색이 일부만 실패하면 이전 성공본을 덮어쓴다.
- 빌드용 fetch-data가 raw 요청 실패 시 저장소 파일을 쓸: 통과. 기본 모드는 mirror이고, 404이면 쓰지 않으며 CelesTrak·Launch Library를 부르지 않는다.
- 오래된 데이터 안내: 통과. 24시간 미만은 안내가 없고, 30시간 전 데이터는 `30시간 전 데이터`를 보이며 ISS 고도와 발사 제목을 계속 보여 준다.
- 기존 테스트: 통과.

고칠 것:
`collectCatalog`는 NAME 검색이 모두 실패해도 다른 묶음에서 한국 NORAD가 하나라도 들어오면 `groups.korea.ok`를 true로 둔다. 거기에는 geo의 천리안 2A·2B(43823·45246)가 포함된다. 그러면 `mergeCatalogWithPrevious`는 실패한 묶음이 없다고 보고 이전 catalog를 버리고, 6개 GP 묶음에 없어 group이 `korea`인 위성이 사라진다. NAME 요청 일부만 503인 때도 같다. 이 경우에는 이전 성공본을 그대로 두는 테스트가 없다.

1. NAME 검색이 하나라도 실패하면(`koreaErrors.length > 0`) `groups.korea.ok`를 false로 두어라. 다른 묶음에 한국 위성이 있다는 이유만으로 NAME 묶음을 성공으로 표시하지 마라. 이번에 성공한 NAME 결과와 다른 묶음의 위성은 items에 그대로 두어라.
2. `mergeCatalogWithPrevious`는 ok가 false인 `korea`에 대해, 이전 파일에서 group이 `korea`이고 NORAD가 이번 목록에 없는 행만 다시 붙여라. 이번 요청에 들어온 위성은 이전 행으로 교체하지 마라. 다른 묶음이 성공했으면 catalog 파일 전체를 이전 본으로 되돌리지 마라.
3. `tests/fetch-data.test.ts`에 모킹 테스트를 추가해라. 이전 catalog에 group이 `korea`인 위성 47932를 두고, geo는 유효한 GP 항목 43823을 200으로 돌려줘어라(`assertStation`을 통과해 koreanCount가 0보다 커지게). NAME=KOMPSAT는 38338을 200으로, NAME=CAS500은 503으로, 나머지 NAME과 나머지 GROUP은 빈 배열 200으로 두어라. `collectData({ mode: "refresh" })` 뒤에 쓴 catalog.json에 47932, 43823, 38338이 모두 있어야 한다. 기대값은 실행 후 파일에서 읽어라.

<div><a href="https://cursor.com/agents/bc-ee5cef36-1397-4b40-9cc9-604adfe89a47?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/automations/fc5fe75e-dcf2-11f1-ba91-f63b1661ac50"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/view-automation-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/view-automation-light.png"><img alt="View Automation" width="141" height="28" src="https://cursor.com/assets/images/view-automation-dark.png"></picture></a>&nbsp;</div>

<sub>Sent by Cursor Automation: QA</sub>

