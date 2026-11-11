# Argonova

내 위치의 오늘 밤 하늘, 실시간 위성 지구본, 로켓 발사 일정을 보여 주는 정적 웹앱입니다.
한국어 표기는 아르고노바입니다.

사이트: https://argonova.pages.dev

위치는 브라우저 안에서만 계산하고, 이 기기의 localStorage에만 저장합니다. 서버로 보내지 않습니다.

## 화면

| 탭 | 내용 |
|---|---|
| 오늘 밤 | 일몰·일출, 달 위상, 지평선 위의 밝은 행성, 다음 유성우 |
| 위성 지구본 | ISS와 우주정거장 위성의 현재 위치 |
| 발사 일정 | 다가오는 발사, 한국시간, 카운트다운, 생중계 링크 |

화면 아래에는 데이터 출처와 갱신 시각이 나옵니다. 파일을 읽지 못하거나 하늘 계산이 실패하면 각 탭에 오류 문구를 보여 줍니다.

## 구조

- `index.html` — 페이지 제목, 설명, 글꼴
- `src/main.ts` — 앱을 화면에 붙입니다
- `src/app.ts` — 탭, 위치 선택, 로딩·오류 표시
- `src/sky.ts` — 해·달·행성 계산 (astronomy-engine)
- `src/meteors.ts` — 유성우 극대일
- `src/satellites.ts` — 위성 궤도 (satellite.js)
- `src/globe-view.ts` — 3D 지구본
- `src/launches.ts` — 발사 일정 표시
- `src/location.ts` — 시·도 좌표와 위치 저장
- `src/sources.ts` — 화면 하단의 데이터 출처와 갱신 시각
- `public/data/` — `tle.json`, `launches.json`. 브라우저는 이 파일만 읽습니다
- `public/textures/` — 지구본 낮·밤 사진(처음 2K, 이어서 고해상도)과 지형·바다 텍스처. 출처는 `CREDITS.md`
- `scripts/fetch-data.js` — 빌드 전에 CelesTrak과 Launch Library 2에서 JSON을 저장합니다

## 개발

```bash
npm ci
npm run fetch-data
npm run dev
```

## 테스트와 빌드

```bash
npm test
npm run build
```

빌드 결과물은 `dist/`에 생성됩니다. `main`에 반영되면 Cloudflare Pages가 https://argonova.pages.dev 에 배포합니다.
