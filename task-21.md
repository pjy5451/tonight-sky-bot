status: fixed
attempts: 1
pr: 25
branch: task-21-sky-map
title: [task-21] 하늘 지도

## 최근 피드백

<!-- CURSOR_AUTOMATION_ID: fc5fe75e-dcf2-11f1-ba91-f63b1661ac50 | RUN_ID: bc-af08aeed-f3f0-46f1-b4d2-730bc2d4a723 -->
[QA] 반려

npm ci 성공, npm test 158 통과, npm run build 성공. origin/main의 21번은 `[ ]`이고 이 PR에서만 `[x]`로 바꾸었다. 기존 테스트 파일의 `it(` 줄 수는 base와 같고, 추가는 `tests/iss-passes.test.ts` 1개와 `tests/sky-map.test.ts` 7개뿐이다. 단언을 지우거나 약하게 만들지 않았다. 워크플로·package.json·`public/_headers` 변경 없다. 브라우저 번들에 celestrak.org·thespacedevs.com·innerHTML 없고, 별 목록은 `stars.json`만 읽는다.

완료 기준:
- 적경·적위→고도·방위: `horizontalFromJ2000`는 `Rotation_EQJ_HOR` 뒤 `HorizonFromVector("normal")`이다. 테스트 기준(`Rotation_EQJ_EQD` 뒤 `Horizon` "normal")과 서울 2026-11-12T12:00Z 별 2887개, 다른 위도·시각 격자에서 오차가 1e-12° 수준이라 ±0.5°를 만족한다. 통과.
- 별 데이터: `public/data/stars.json` 96,870바이트, 별 2887개, 시각등급 최대 5.5. HR 2491 적경 6.752472시·적위 -16.71611°·등급 -1.46으로 BSC와 맞다. README에 출처·라이선스가 있다. 통과.
- 센서 없을 때 드래그: `data-view-bearing`이 바뀌는 테스트가 있고, 이벤트가 안 동하면 실패한다. 통과.
- 기존 테스트: 158 통과. 통과.

반려 이유: '폰을 하늘로'의 iOS 권한 요청이 동작하지 않는다. 클릭 핸들러가 `const request = DeviceOrientationEvent.requestPermission; request()`처럼 정적 메서드를 떼어 호출한다. 빌드 결과도 `let t=e.requestPermission; t().then(...)`이다. iOS에서 이 메서드는 생성자의 정적 메서드라 `this`가 생성자가 아니면 TypeError가 동기적으로 난다. `.catch`는 그 예외를 받지 못하고, 권한 대화상자가 뜨지 않으며 지도가 폰 방향을 따라가지 않는다. 지금 테스트는 requestPermission이 없는 jsdom이라 이 분기를 타지 않는다. 나침반은 상대 alpha만으로는 방위를 못 구하므로, 권한 없이 그래도 지도가 안 돌아간다.

이렇게 고친다:
1. `src/sky-map.ts` 클릭 핸들러에서 `DeviceOrientationEvent.requestPermission(true)`를 생성자 메서드로 바로 호출한다. 함수를 변수에 담아 호출하지 않는다. 인자 `true`는 자력계·`webkitCompassHeading` 권한이다. Promise가 "granted"일 때만 리스너를 붙인다. "denied", 거절, 동기 예외는 모두 잡아 센서 불가 안내를 보이고 드래그는 남긴다. 클릭 핸들러 밖으로 예외가 새어 나가게 두지 않는다.
2. 테스트를 더한다. `requestPermission`이 있는 가짜 생성자를 버튼 클릭 전에 `globalThis.DeviceOrientationEvent`에 넣고, 호출 때 `this`가 그 생성자이고 첫 인자가 `true`인지 확인한다. `resolve("granted")` 뒤에 `webkitCompassHeading: 90`, `absolute: false`인 `deviceorientation`을 보내 `data-view-bearing`이 `"90.0"`인지 본다. `"denied"`와 동기 throw에서는 `aria-pressed`가 `"false"`이고 센서 불가 문구가 나오며 `click()`가 예외를 던지지 않는지 본다. 거절 뒤에 드래그하면 `data-view-bearing`이 바뀌는지 본다. 메서드를 떼어 호출하면 이 테스트가 실패해야 한다. 기존 드래그·절대 방향 테스트는 그대로 둔다.

<div><a href="https://cursor.com/agents/bc-af08aeed-f3f0-46f1-b4d2-730bc2d4a723?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/automations/fc5fe75e-dcf2-11f1-ba91-f63b1661ac50"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/view-automation-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/view-automation-light.png"><img alt="View Automation" width="141" height="28" src="https://cursor.com/assets/images/view-automation-dark.png"></picture></a>&nbsp;</div>

<sub>Sent by Cursor Automation: QA</sub>
