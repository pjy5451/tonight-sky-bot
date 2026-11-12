# Argonova

내 위치의 오늘 밤 하늘, 실시간 위성 지구본, 로켓 발사 일정을 보여 주는 정적 웹앱입니다.
한국어 표기는 아르고노바입니다.

사이트: https://argonova.pages.dev

위치는 브라우저 안에서만 계산하고, 이 기기의 localStorage에만 저장합니다. 서버로 보내지 않습니다.

## 화면

| 탭 | 내용 |
|---|---|
| 오늘 밤 | 머리 위 하늘 지도, 일몰·일출, 달 위상, 지평선 위의 밝은 행성, 다음 유성우 |
| 위성 지구본 | ISS와 우주정거장 위성의 현재 위치 |
| 발사 일정 | 다가오는 발사, 한국시간, 카운트다운, 생중계 링크 |

화면 아래에는 데이터 출처와 갱신 시각이 나옵니다. 파일을 읽지 못하거나 하늘 계산이 실패하면 각 탭에 오류 문구를 보여 줍니다. 데이터가 24시간보다 오래돼도 화면을 막지 않고, `N시간 전 데이터` 안내와 함께 계속 보여 줍니다.

## 구조

- `index.html` — 페이지 제목, 설명, 글꼴
- `src/main.ts` — 앱을 화면에 붙입니다
- `src/app.ts` — 탭, 위치 선택, 로딩·오류 표시
- `src/sky.ts` — 해·달·행성 계산 (astronomy-engine)
- `src/sky-map.ts` — 오늘 밤 탭의 둥근 전천 하늘 지도
- `src/meteors.ts` — 유성우 극대일
- `src/satellites.ts` — 위성 궤도 (satellite.js)
- `src/globe-view.ts` — 3D 지구본
- `src/launches.ts` — 발사 일정 표시
- `src/location.ts` — 시·도 좌표와 위치 저장
- `src/sources.ts` — 화면 하단의 데이터 출처와 갱신 시각
- `public/data/` — `tle.json`, `launches.json`, `catalog.json`, `stars.json`. 브라우저는 이 파일만 읽습니다
- `public/textures/` — 지구본 낮·밤 사진(처음 2K, 이어서 고해상도)과 지형·바다 텍스처. 출처는 `CREDITS.md`
- `scripts/fetch-data.js` — Cloudflare 빌드는 `data` 브랜치의 JSON을 받아 옵니다. 원본(CelesTrak, Launch Library 2)은 GitHub Actions `data-refresh`가 6시간마다 받습니다. 실패한 묶음은 이전 성공본을 덮어쓰지 않습니다. `stars.json`은 여기서 다시 받지 않습니다

## 별 목록

하늘 지도의 별 위치와 밝기는 Yale Bright Star Catalogue, 5th Revised Ed. (Hoffleit & Warren 1991)이다. NASA Astronomical Data Center가 V/50으로 배포한 자료를 썼다. 적경·적위는 J2000.0이고, 별의 위치와 시각등급은 관측된 사실 데이터라 공개 도메인으로 둔다. `public/data/stars.json`에는 시각등급 5.5보다 밝은 별만 들어 있다.

별자리 선은 Marc van der Sluys의 [ConstellationLines](https://github.com/MarcvdSluys/ConstellationLines) (CC BY 4.0)이다. 원본의 BSC 번호를 이었고, 이 등급 제한에 없는 별의 연결은 빼서 선 목록을 별 쌍으로 나눴다.

## 개발

```bash
npm ci
npm run fetch-data
npm run dev
```

`npm run fetch-data`는 기본적으로 `data` 브랜치 JSON을 받아 옵니다. 원본을 직접 받아 이전 성공본을 유지하려면 `FETCH_DATA_MODE=refresh npm run fetch-data`를 실행합니다.

## 테스트와 빌드

```bash
npm test
npm run build
```

빌드 결과물은 `dist/`에 생성됩니다. `main`에 반영되면 Cloudflare Pages가 https://argonova.pages.dev 에 배포합니다.
