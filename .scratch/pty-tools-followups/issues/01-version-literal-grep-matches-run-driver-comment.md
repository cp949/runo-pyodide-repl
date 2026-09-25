# 13.8 버전 리터럴 grep이 `run-driver.py` 주석 1건을 잡아 "0줄" 주장과 어긋난다

Status: done
Origin: RD-025 DELTA-04(2026-09-26). 이 RD가 만든 줄이 아니라 커밋되어 있던 상태다.

## 현상

`docs/design/13-version-upgrade.md` 13.8의 확인 명령을 그대로 돌리면 1줄이 나온다(2026-09-26 실측).

```bash
git grep -n '314\.0\.7' -- packages apps/demo/src scripts ':!packages/pyodide-repl/src/terminal/import-gate-corpus.ts' \
  | grep -v '^packages/pyodide-core/package.json:[0-9]*: *"pyodide": "\^314\.0\.7"'
```

```
packages/pyodide-core/src/worker/run-driver.py:100:    # `dont_inherit=True`: ... (pyodide 314.0.7의 `_base.py`·
```

13.8은 "출력이 0줄이어야 한다", "주석 포함"이라고 적는다. 결함 없는 코드에서 확인 명령이 실패하므로 `open`(도구 결함, 거짓 실패 재현) 조건을 충족한다.

## 완료 기준

13.8의 명령이 0줄을 출력한다. 둘 중 하나로 맞춘다.

- (a) `run-driver.py:100` 주석에서 버전 리터럴을 뺀다(예: "pyodide의 `_base.py`"). 다른 소스 줄은 바꾸지 않는다.
- (b) 13.8의 허용 목록에 그 파일을 넣고 사유를 적는다.

(a)를 권고한다. 규칙("버전 리터럴은 코드·시험에 두지 않는다")을 그대로 유지한다. 단 `packages/pyodide-core/src` 주석을 고치는 커밋은 `pnpm check-dist`가 동기 브리지 라이브러리 이름을 거른다(`docs/traps/TRP-076`) — 이 줄에는 해당 이름이 없다.

## Comments

- 2026-09-26 해결: (a)를 적용했다. `packages/pyodide-core/src/worker/run-driver.py:100`의 주석 `pyodide 314.0.7의 `_base.py`·`를 `현재 고정 버전 pyodide의 `_base.py`·`로 바꿨다. 13.8의 확인 명령은 0줄(종료 코드 1 = grep 미일치)이다. 13.8 본문은 고치지 않았다(허용 목록 변경 없음). L0 전체 통과(`check-types` 14/14·`lint` 8/8·`test --concurrency=1` 21/21·`build` 7/7).
