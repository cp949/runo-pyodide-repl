# `fit`이 높이 auto 컨테이너에서 `terminalOptions.rows`가 24가 아닐 때 행을 줄일 수 있다

Status: deferred
Origin: RD-024 병합 전 리뷰(코드 읽기·수치 실험 추정). 브라우저 미실측.

## 현상

`@xterm/addon-fit` 0.11.0 `proposeDimensions()`는 컨테이너 `height`를 셀 높이로 나눠 `Math.floor`한 값을 `rows`로 제안한다(`Math.max(1, …)`). 높이가 auto인 컨테이너는 xterm 화면 높이(현재 `rows` × 셀 높이)를 그대로 물려받는데, 셀 높이가 정수가 아니면 부동소수 오차로 나눗셈 결과가 정수 바로 아래가 되어 `floor`가 `rows - 1`을 낼 수 있다는 추정이다. `terminalOptions.rows`를 24가 아닌 값으로 주고 `fit`(기본 `true`)을 켠 뒤 컨테이너 높이를 주지 않을 때 해당한다. 수치 실험과 소스 읽기에서 나온 추정이며 브라우저에서 행 수를 재지 않았다. `react-fit-check`는 `cols`만 판정하고 demo 컨테이너는 높이 auto라 `rows`를 확인하지 않았다(`15-react.md` 15.5).

## 완료 기준

브라우저에서 높이 auto 컨테이너에 `rows`를 24가 아닌 값(예: 30)으로 주고 `fit`을 켠 화면의 `rows`가 유지되는지(또는 줄어드는지) 실측하고 결과를 기록한다. 줄어들면 문서(`15-react.md` 15.5 "고정 높이 컨테이너 전제")를 확정하거나 컴포넌트가 높이 auto 컨테이너를 다루는 방침을 정한다.

## 재개 조건

`fit`을 켜고 `rows`를 지정한 소비자 화면이 나오거나, `react-fit-check`에 `rows` 판정을 더할 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: 브라우저 미실측 추정이라 `deferred`. `15-react.md` 15.5에 "fit은 고정 높이 컨테이너를 전제, 높이 auto·`rows`≠24 행 감소는 미실측 관찰"을 적었다.
