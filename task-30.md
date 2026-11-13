status: fix-needed
attempts: 0
pr: 33
branch: task-30-tonight-timeline
title: [task-30] 오늘 밤 타임라인

## 사람 메모 (2026-11-13)

사람이 막힌 상태를 풀고 다시 맡긴다. 아래 "최근 피드백"의 "고칠 것" 1~3을 그대로 따른다. 핵심은 하나다: 행성 남중을 computeTonightSky 결과(그 순간 지평선 위 행성)로 거르지 말고, 금성·화성·목성·토성 네 개 모두 SearchHourAngle로 일몰~다음 일출 창 안의 남중을 직접 구한 뒤 그때 고도가 0°보다 큰 것만 넣는다. 테스트도 행성을 토성 하나로 고정하지 말고 화성·목성이 들어가는지 확인한다.

## 최근 피드백

<!-- CURSOR_AUTOMATION_ID: fc5fe75e-dcf2-11f1-ba91-f63b1661ac50 | RUN_ID: bc-abaa6f8f-bcf6-42e7-830c-7b29789cf371 -->
[QA] 반려

npm ci 성공, npm test 197 통과, npm run build 성공. origin/main의 30번은 [ ]였다. 기존 테스트의 it(는 추가만 있고 지운 단언은 없다. 워크플로·package.json·public/_headers 변경 없음. 브라우저 외부 API·비밀값·기능 삭제 없음.

통과:
- 서울 37.6°N 127.0°E, 2026-11-12 12:00 KST. 천문 박명 끝 18:53:39 KST, 반올림 18:54. 한국천문연구원 서울 2026-11-12 천문박명 저녁 18:54와 −0.34분. 시민 17:51:21(연구원 17:52, −0.64분), 항해 18:22:47(연구원 18:23, −0.20분).
- 일몰 17:23:39, 달 짐 19:06:44(연구원 19:07). 아침 달뜨기 09:59는 일몰 전이라 창 밖.
- 시민 박명 끝은 sunCenterAltitudeCrossing −6°라 오늘 밤 행성 시각과 같다.
- 카운트다운은 1초(COUNTDOWN_UPDATE_MS) 마다 T−시:분:초. 지난 행은 흐리게. 알림 받기 버튼 없음.
- ISS 픽스처는 시간순, 추천은 최고 고도 하나. 표준 등급 −1.3(1000 km, 위상각 90°) 유지.

반려: 밝은 행성 남중이 빠졌다. buildTonightTimeline이 남중을 computeTonightSky의 그 시각 지평선 위 행성만 구한다. 12:00 KST에는 토성만 양수라 화성·목성이 누락된다. 테스트가 행성을 saturn 하나로 고정해 이 누락을 통과시킨다.

같은 장소·시각의 창은 일몰 17:23:39부터 다음 일출 07:09:12까지다. 그 안에서 고도가 양수인 남중은 세 개다.
- 토성 21:41:16, 고도 53.40°(반올림 53) — 포함
- 화성 06:53:05, 고도 67.56°(반올림 68), 뜨는 시각 00:02 — 빠짐
- 목성 06:56:16, 고도 66.08°(반올림 66), 뜨는 시각 00:11 — 빠짐
금성 남중 10:25는 일출 뒤라 제외가 맞다. 23:00 KST(2026-11-12T14:00:00.000Z)에도 화성·목성은 아직 지평선 아래여서, 지금 코드는 저녁 내내 이 두 남중을 보여 주지 않는다.

고칠 것:
1. 금성·화성·목성·토성 네 개 모두 SearchHourAngle(body, observer, 0, sunset, 1)로 남중을 구한다. 시각이 일몰 이상·다음 일출 미만이고, 그 시각 Horizon(..., "normal") 고도가 0°보다 클 때만 넣는다. sky.planets로 거르지 않는다.
2. 박명 끝은 sunCenterAltitudeCrossing을 유지한다. 일몰은 computeTonightSky를 유지한다.
3. 순서 기댓값을 sunset → civil → nautical → astronomical → moonset → saturn → mars → jupiter로 바꾼다. 고도 반올림은 토성 53, 화성 68, 목성 66. 한국천문연구원 ±2분, 화면 18:54, 시민 박명=행성 시각, 카운트다운, 지난 행, 알림 버튼 없음, ISS 최고 고도 하나 단언은 지우지 않는다.
4. 2026-11-12T14:00:00.000Z(한국시간 23:00)에도 화성·목성 남중이 있는지 테스트를 더한다. 이 시각에 두 행성은 지평선 아래다.

<div><a href="https://cursor.com/agents/bc-abaa6f8f-bcf6-42e7-830c-7b29789cf371?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/automations/fc5fe75e-dcf2-11f1-ba91-f63b1661ac50"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/view-automation-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/view-automation-light.png"><img alt="View Automation" width="141" height="28" src="https://cursor.com/assets/images/view-automation-dark.png"></picture></a>&nbsp;</div>

<sub>Sent by Cursor Automation: QA</sub>

