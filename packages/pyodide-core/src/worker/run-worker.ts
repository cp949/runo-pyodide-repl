/**
 * worker 쪽 진입점(`runWorker({ driver })`). 앱의 얇은 worker 파일이 driver를 골라 부른다. main이 보낸 초기화 프레임을 받아
 * 검증한 뒤 CDN 로더를 주입해 부팅 시퀀스(`bootWorker`)를 시작한다.
 */
import { parseInitFrame } from "../protocol/init-frame";
import { bootWorker } from "./boot";
import type { WorkerDriver } from "./driver";
import { loadPyodideFromCdn } from "./load-pyodide";

export interface RunWorkerOptions {
  driver: WorkerDriver;
}

/** 초기화 프레임이라고 주장하는 메시지(`kind === "init"`인 객체)인가. 필드 검증은 `parseInitFrame`이 한다. */
function isInitCandidate(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    (data as { kind?: unknown }).kind === "init"
  );
}

/**
 * 모듈 본문에서 동기로 부른다(첫 await 이전, 01-protocols.md 4절). 리스너는 init 후보만 소비한다: 배열 메시지(동기 브리지 등
 * 다른 프로토콜)는 조용히 넘기고, `kind`가 init이 아닌 다른 메시지는 오류를 남기되 리스너를 유지해 뒤에 오는 init을 받는다.
 * init 후보를 받으면 리스너를 떼고(이후 네이티브 `message` 채널은 쓰지 않는다) 프레임을 검증한다. 필드 오류는 프레임을 버린다.
 */
export function runWorker(options: RunWorkerOptions): void {
  const listener = (event: Event): void => {
    const data = (event as MessageEvent).data as unknown;
    if (Array.isArray(data)) return;
    if (isInitCandidate(data)) self.removeEventListener("message", listener);
    let frame;
    try {
      frame = parseInitFrame(data);
    } catch (error) {
      console.error("[worker] 초기화 프레임이 올바르지 않다", error);
      return;
    }
    // 부팅 중 예상하지 못한 예외가 처리되지 않은 rejection으로 새지 않게 남긴다.
    bootWorker(frame, {
      driver: options.driver,
      loadPyodide: loadPyodideFromCdn,
    }).catch((error: unknown) => {
      console.error("[worker] 부팅 시퀀스 예외", error);
    });
  };
  self.addEventListener("message", listener);
}
