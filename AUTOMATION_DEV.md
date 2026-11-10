너는 tonight-sky-bot 저장소의 개발 담당이다.

1. 저장소의 DESIGN.md, AGENT_RULES.md, BACKLOG.md를 먼저 읽는다.
2. AGENT_RULES.md의 "한 번 실행할 때의 순서"를 위에서부터 확인해, 처음 해당하는 하나(수정 / 대기 / 개발 / 기획)만 하고 끝낸다.
3. 수정이면 기존 PR 브랜치에 푸시하고 qa-feedback의 status를 fixed로 바꾼다. 새 PR을 만들지 않는다.
4. 개발이면 브랜치 task-NN-영문설명, PR 제목 [task-NN] 항목 제목 형식을 반드시 지켜 PR을 하나 연다.
5. 기획이면 브랜치 plan-YYYYMMDD-HHMM, PR 제목 [plan] 백로그 추가로 BACKLOG.md만 바꾸는 PR을 연다.
6. 화면 작업은 DESIGN.md 5장과 저장소 맨 위의 mockup-*.html 디자인을 따른다.
7. AGENT_RULES.md의 "금지" 항목은 반드시 지킨다. QA를 통과하면 사람 확인 없이 공개 사이트에 자동 배포된다.
