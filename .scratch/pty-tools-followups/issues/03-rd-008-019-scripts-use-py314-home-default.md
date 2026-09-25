# rd-008·rd-019 스크립트가 `PY314` 환경변수와 홈 절대경로 기본값을 쓴다

Status: deferred
Origin: RD-025 DELTA-04(2026-09-26). 코드 읽기로 확인한 규칙 불일치이고 거짓 결과를 관찰한 것은 아니다.

## 현상

`apps/demo/e2e/pty/rd-008/pty_cancel.py`와 `apps/demo/e2e/pty/rd-019/pty_type_ahead.py`는 `os.environ.get("PY314", "<홈 절대경로>/python3.14")`로 인터프리터를 정하고 docstring에도 같은 경로가 있다. `apps/demo/e2e/pty/tools/`는 `--python` > `PTY_PYTHON` > `PATH`의 `python3.14`와 버전 게이트(`--allow-version-mismatch`)를 쓴다. 두 스크립트는 자립형이고 결과가 사람 판정이라 RD-025 범위 밖이었다. `apps/demo/e2e/pty/README.md`가 "인터프리터는 `PY314`"로 차이를 명시한다.

## 재개 조건

3.15 재측정을 착수하기로 사용자가 정했을 때(ADR-0007). 그때 두 스크립트가 `tools/ptyrepl.py`와 같은 3단 규칙·버전 게이트를 쓰도록 맞춘다.

## Comments
