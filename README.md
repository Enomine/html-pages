# html-pages

GitHub Pages로 HTML 파일을 바로 띄워 보는 용도의 저장소입니다.

- 공개 주소: https://enomine.github.io/html-pages/
- `main` 브랜치 루트(`/`)를 그대로 서빙합니다. 별도 빌드 없음.
- `.nojekyll` 이 있어 Jekyll 처리 없이 파일이 그대로 올라갑니다.

## 구조

폴더 하나가 한 그룹입니다. `index.html` 이 그룹별 목차를 보여줍니다.

```
ConanExile/            코난 엑자일 맵 지도 (한국어)
  exiled-lands-ko.html   추방자의 땅
  siptah-ko.html         시프타 섬
```

## 파일 추가하기

1. 그룹 폴더(없으면 새로 만들기) 아래에 HTML 파일을 넣습니다. 파일명은 영문 slug 권장 (URL이 깔끔함).
2. `index.html` 해당 그룹 목록에 링크를 한 줄 추가합니다.
3. 커밋·푸시하면 1분 안쪽으로 반영됩니다.

예: `ConanExile/foo.html` → https://enomine.github.io/html-pages/ConanExile/foo.html

## 크기 제한

GitHub는 파일 하나 100MB가 상한이고 50MB부터 경고합니다. 그 아래면 쪼개지 않고 그대로 올려도 됩니다.
