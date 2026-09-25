# smoke:pack의 진입점·`publishConfig.exports` 손동기화가 세 곳이다

Status: deferred
Origin: RD-023 DELTA-03(2026-09-25). 코드 읽기로 추정한 유지보수 위험이고 실제로 한 곳을 빠뜨린 사례는 아직 없다.

## 현상

패키지에 진입점을 더하면 세 곳을 손으로 맞춘다.

1. 패키지 `package.json`의 `exports`(`development` 포함)
2. 같은 파일의 `publishConfig.exports`(`development`를 뺀 판)
3. `scripts/pack-smoke.mjs`의 `ENTRY_POINTS`(주 소비자) 또는 `BRIDGE_ENTRY_POINTS`(dom-bridge 소비자)

(1)-(2)가 어긋나면 tarball에서 진입점이 빠지는데, `smoke:pack`의 정적 exports 검사와 Vite 해석 검사는 이것을 "tarball `exports`의 대상 누락"으로만 늦게 드러낸다(Node import 검사는 (3)의 목록만 본다). dom-bridge는 `src/package-boundary.test.ts`가 (1)-(2) 키 일치를 시험한다. 다른 5개 패키지에는 같은 시험이 없다.

## 재개 조건

진입점을 추가했는데 한 곳을 빠뜨려 `smoke:pack`이 늦게 실패한 사례가 나올 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: `deferred`. 규칙 본문은 `docs/design/09-testing.md` 9.8.3.
