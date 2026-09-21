/**
 * worker 쪽 진입점. 앱의 얇은 worker 파일이 부른다('@cp949/runo-pyodide-repl/worker').
 * 이 단계(RD-001)는 main이 보낸 초기화 프레임을 받아 console.log로 에코하는 데까지만 간다.
 * 프레임 타입·검증은 RD-002, pyodide 로드는 RD-004, REPL 루프는 RD-005가 채운다.
 */
export function runReplWorker(): void {
  // 첫 await 이전에 리스너를 건다. 첫 메시지 뒤에는 네이티브 message 채널을 쓰지 않는다(01-protocols.md 4절).
  self.addEventListener(
    "message",
    (event) => {
      const data = event.data as { kind?: unknown } | null | undefined;
      if (data?.kind !== "init") {
        console.error("[repl.worker] 첫 메시지가 init 프레임이 아니다", data);
        return;
      }
      console.log("[repl.worker] 초기화 프레임 수신", data);
    },
    { once: true },
  );
}
