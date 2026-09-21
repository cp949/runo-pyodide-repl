# `sys`가 REPL 전역에 새는 편차 22 제거

Status: open
Origin: RD-004 그릴링(2026-09-21). `docs/design/10-parity-deviations.md` 22.

## 현상

worker가 `sys.ps1`/`sys.ps2`를 `pyodide.runPython("import sys\nsys.ps1 = ...")`로 `pyodide.globals`(= `__main__`)에서 실행해 `sys`가 사용자 네임스페이스에 남는다. 새 세션에서 `s` Tab 후보에 `sys`가 섞인다(3.14 pty의 새 REPL에는 없다).

## 후보

- `pyodide.pyimport("sys")` 프록시에 JS에서 대입(`sysModule.ps1 = ">>> "`)하면 전역이 오염되지 않는다. 두 줄 변경.

## 완료 기준(관찰 가능)

- 새 세션에서 `pyodide.runPython("'sys' in globals()")`가 `False`.
- RD-016 브라우저 기준선(58·129 시나리오)에서 `s` Tab 후보 기대값을 갱신해도 다른 실패가 늘지 않는다.
- `10-parity-deviations.md`에서 22를 지우고 `DESIGN.md`의 편차 건수를 맞춘다.

## 등록 시점

RD-016(Tab 완성) 착수 시 함께 처리한다. 기준선 비교 규칙("변경하려면 ROADMAP 항목으로 등록")에 따라 RD-004에서는 바꾸지 않았다.
