# smoke:pack의 진입점·`publishConfig.exports` 손동기화가 세 곳이다

Status: deferred
Origin: RD-023 DELTA-03(2026-09-25). 코드 읽기로 추정한 유지보수 위험이고 실제로 한 곳을 빠뜨린 사례는 아직 없다.

## 현상

패키지에 진입점을 더하면 세 곳을 손으로 맞춘다.

1. 패키지 `package.json`의 `exports`(`development` 포함)
2. 같은 파일의 `publishConfig.exports`(`development`를 뺀 판)
3. `scripts/pack-smoke.mjs`의 `ENTRY_POINTS`(주 소비자) 또는 `BRIDGE_ENTRY_POINTS`(dom-bridge 소비자)

(1)-(2)가 어긋나 tarball `exports`에서 진입점 키가 빠지면, `smoke:pack`의 정적 exports 검사는 원리적으로 못 잡는다: tarball에 남은 `exports`의 대상 파일이 있는지만 보므로 빠진 키는 검사 대상에 없다. 빠진 진입점이 (3)의 목록에 있으면 Node import 검사(와 같은 목록을 쓰는 Vite 해석 검사)가 `ERR_PACKAGE_PATH_NOT_EXPORTED`류 실패로 잡고, (3)에도 없으면 `smoke:pack`은 통과한다. (1)-(2) 키 일치와 `publishConfig.exports`의 `development` 조건 부재는 배포 패키지 6종 모두 L0 시험이 본다(`packages/pyodide-dom-bridge/src/package-boundary.test.ts` "배포 패키지 6종의 tarball exports(publishConfig)는 …", RD-023 사후 리뷰 2026-09-25). 남은 손동기화는 (3)이다.

## 재개 조건

진입점을 추가했는데 한 곳을 빠뜨려 `smoke:pack`이 늦게 실패한 사례가 나올 때. 그 전에는 조사하지 않는다.

## Comments

- 2026-09-25 등록 시점 분류: `deferred`. 규칙 본문은 `docs/design/09-testing.md` 9.8.3.
- 2026-09-25 RD-023 사후 리뷰: "정적 exports 검사와 Vite 해석 검사가 드러낸다" 서술을 정정했다(정적 검사는 빠진 키를 못 잡고, (3)에 있으면 Node import·Vite 해석이 잡는다). (1)-(2) 키 일치 L0 시험을 dom-bridge 한 곳에서 6개 패키지 전체로 넓혔다. `pack-smoke.mjs`는 없는 exports 대상 목록을 발견 즉시 로그로 찍는다. 상태는 `deferred` 유지((3) 손동기화가 남는다).
