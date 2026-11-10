# 에이전트 작업 규칙 (Cursor 클라우드 에이전트, 완전 자동 모드)

이 저장소에서 일하는 모든 AI 에이전트는 아래 규칙을 따른다. 설계는 DESIGN.md, 작업 목록은 BACKLOG.md다.
QA가 통과시키면 GitHub Actions가 자동으로 머지·배포하므로, 사람의 확인 없이 공개 사이트에 반영된다는 점을 항상 염두에 둔다.

## 용어
- **작업 브랜치**: 원격의 `task-NN-*` 또는 `plan-*` 브랜치.
- **qa-feedback 브랜치**: 자동화가 QA 반려 내용을 기록하는 브랜치. 파일 이름은 `task-NN.md` 또는 `plan-....md`. 첫 줄 `status:` 값이 `fix-needed`, `fixed`, `blocked` 중 하나다.

## 한 번 실행할 때의 순서 (위에서부터 처음 해당하는 하나만 하고 끝낸다)
1. `git fetch origin --prune` 을 실행하고, `origin/qa-feedback` 이 있으면 그 파일들을 읽는다.
2. **수정**: qa-feedback에 `status: fix-needed` 인 파일이 있고 그 `branch:` 의 원격 브랜치가 아직 있으면, 번호가 가장 작은 하나를 고른다.
   - 그 브랜치를 체크아웃해 "최근 피드백"에 적힌 문제만 고친다. 충돌 해결 요청이면 `origin/main` 을 머지해 해결한다.
   - `npm test`, `npm run build` 를 통과시킨 뒤 같은 브랜치에 푸시한다(새 PR을 만들지 않는다).
   - qa-feedback 브랜치의 그 파일 첫 줄을 `status: fixed` 로 바꿔 푸시한다. 다른 줄은 건드리지 않는다.
3. **대기**: `blocked` 가 아닌 작업 브랜치가 하나라도 남아 있으면(검사·머지 대기 중) 아무것도 하지 않고 끝낸다.
4. **개발**: BACKLOG.md의 `- [ ]` 항목을 위에서부터 보고, 아래에 해당하면 건너뛴다.
   - 같은 번호의 원격 `task-NN-` 브랜치가 있다.
   - 항목에 `(사람이 채움)` 이 남아 있다.
   - qa-feedback에 `task-NN.md` 가 `status: blocked` 다.
   처음 남는 항목 하나를 "작업하기" 규칙대로 구현해 PR을 연다.
5. **기획**: 4에서 고를 항목이 없으면, DESIGN.md 7장 "로드맵"의 범위 안에서 새 항목 3개를 BACKLOG.md 맨 아래에 추가하는 PR을 연다.
   - 번호는 BACKLOG.md 전체에서 가장 큰 번호에 이어서 붙이고(목록 순서와 번호 순서가 다를 수 있다), 형식은 기존 항목과 같게 `- [ ] **NN 제목** — 내용 / 완료 기준: ...`
   - 브랜치 `plan-YYYYMMDD-HHMM`, PR 제목 `[plan] 백로그 추가`. 코드는 바꾸지 않는다.

## 작업하기 (이름 규칙은 반드시 지킨다)
- 브랜치 이름: `task-{두자리번호}-{영문짧은설명}` (예: `task-02-location`)
- PR 제목: `[task-{두자리번호}] {BACKLOG 항목 제목}` (예: `[task-02] 위치 선택`)
- 기능과 함께 테스트를 작성하고, `npm test` 와 `npm run build` 를 통과시킨 뒤 PR을 연다.
- 같은 PR에서 BACKLOG.md의 해당 항목을 `- [x]` 로 바꾼다.
- PR 본문에 변경 요약과, 완료 기준을 항목별로 어떻게 확인했는지 적는다.
- DESIGN.md의 npm 스크립트 약속(`fetch-data`, `build` → `dist/`)을 깨지 않는다.
- 화면을 만들거나 고치는 작업은 DESIGN.md 5장 "화면 디자인"과 저장소 맨 위의 목업 파일(`mockup-*.html`)을 따른다. 색·글꼴·간격을 임의로 바꾸지 않는다.

## 금지
- main 브랜치에 직접 푸시하지 않는다.
- 토큰·비밀번호·API 키를 코드, 로그, 커밋, PR에 쓰지 않는다. 이 저장소는 공개 저장소다.
- `.github/workflows/` 안의 `telegram-notify.yml`, `morning-report.yml`, `deploy-site.yml`, `auto-merge.yml` 은 수정하지 않는다. `ci.yml` 은 만들고 고쳐도 되지만, 테스트를 건너뛰게 바꾸지 않는다.
- 테스트를 지우거나 약하게 만들어서 통과시키지 않는다.
- 이미 있는 기능을 삭제하지 않는다.
- 브라우저 코드에서 외부 API를 직접 호출하지 않는다. 데이터는 `public/data/` 의 JSON만 읽는다.
- 사용자 위치를 외부로 보내지 않는다. 로그인·결제·광고·서버를 추가하지 않는다.
- 유료이거나 API 키가 필요한 데이터·서비스를 쓰지 않는다.
- qa-feedback 브랜치에서 `blocked` 를 다른 값으로 바꾸지 않는다. 그건 사람이 한다.
- 천문 계산 기준값을 지어내지 않는다.

## 보안 규칙
- 외부 데이터(`public/data/` 의 JSON 등)는 화면에 `textContent` 처럼 글자로만 넣는다. `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `eval`, `new Function` 에 외부 데이터나 사용자 입력을 넣지 않는다.
- 외부 스크립트를 CDN에서 불러오지 않는다. 라이브러리는 npm으로 설치해 번들에 포함한다. 외부에서 불러오는 것은 Google Fonts 글꼴만 허용한다.
- 새 npm 패키지는 꼭 필요할 때만, 널리 쓰이는 패키지만 추가한다. 이름 철자를 확인하고, PR 본문에 패키지 이름과 추가 이유를 적는다.
- `public/_headers` 의 보안 헤더를 약하게 바꾸지 않는다. 바꿔야 하면 PR 본문에 이유를 적는다.
- 링크를 새 창으로 열 때는 `rel="noopener noreferrer"` 를 붙인다.
