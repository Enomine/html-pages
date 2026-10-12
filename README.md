# html-pages

GitHub Pages로 HTML 파일을 바로 띄워 보는 용도의 저장소입니다.

- 공개 주소: https://enomine.github.io/html-pages/
- `main` 브랜치 루트(`/`)를 그대로 서빙합니다. 별도 빌드 없음.
- `.nojekyll` 이 있어 Jekyll 처리 없이 파일이 그대로 올라갑니다.

## 구조

폴더 하나가 한 그룹입니다. `index.html` 이 그룹별 목차를 보여줍니다.

```
ConanExile/                  코난 엑자일 맵 지도 (한국어)
  exiled-lands-ko.html         추방자의 땅 (페이지, ~1.2MB)
  exiled-lands/tiles/z/x/y.jpg   지도 타일 피라미드 (zoom 0~3, 3,012장)
  exiled-lands/icons/            마커 아이콘
  siptah-ko.html               시프타 섬 (페이지, ~1.1MB)
  siptah/tiles/, icons/, img/    타일 · 아이콘 · 설명에 들어가는 사진
  map-app.js                   두 지도가 공유하는 뷰어 코드 (Leaflet 1.9)
vendor/leaflet-1.9.4/        Leaflet 라이브러리 (CDN 의존 없음)
tools/build_map.py           단일 파일 지도 HTML → 타일 지도로 변환하는 스크립트
tools/maps.json              지도별 변환 설정 (원본 경로, 좌표 범위, 출처 표기)
tools/test_build_map.py      변환 스크립트 테스트
```

## 지도 페이지 다시 만들기

원본은 지도 이미지 한 장과 모든 데이터를 base64로 넣은 단일 HTML(20~36MB)입니다.
그대로 올리면 줌마다 154메가픽셀 이미지를 다시 그려서 느리므로, 스크립트가
타일·아이콘·사진을 파일로 빼내고 Leaflet 1.9 + `map-app.js`를 쓰는 작은 페이지로 바꿉니다.

```powershell
# 원본 HTML 경로는 tools/maps.json 의 src 에 적혀 있습니다 (기본: Downloads 폴더)
python -I tools/build_map.py --all          # 두 지도 모두
python -I tools/build_map.py exiled-lands   # 하나만
python -m unittest tools.test_build_map     # 스크립트 테스트
```

뷰어 동작(필터·검색·좌표 표시)은 `ConanExile/map-app.js` 한 곳에서 고칩니다.
마커는 화면 범위 안의 것만 DOM에 올리고 이동·줌이 끝날 때 갱신합니다.

## 파일 추가하기

1. 그룹 폴더(없으면 새로 만들기) 아래에 HTML 파일을 넣습니다. 파일명은 영문 slug 권장 (URL이 깔끔함).
2. `index.html` 해당 그룹 목록에 링크를 한 줄 추가합니다.
3. 커밋·푸시하면 1분 안쪽으로 반영됩니다.

예: `ConanExile/foo.html` → https://enomine.github.io/html-pages/ConanExile/foo.html

## 크기 제한

GitHub는 파일 하나 100MB가 상한이고 50MB부터 경고합니다. 그 아래면 쪼개지 않고 그대로 올려도 됩니다.
다만 수십 MB짜리 단일 HTML은 브라우저에서 느리니, 지도류는 위 스크립트처럼 타일로 나누는 편이 낫습니다.
