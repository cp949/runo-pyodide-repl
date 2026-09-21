/**
 * stdin 메일박스(01-protocols.md 2절, ADR-0002). `input()`·`sys.stdin` 읽기 한 건의 응답을 main이 `Atomics.wait`로 정지한
 * worker에 동기적으로 넘기는 단방향 우편함이다. 세션(worker)마다 새로 만든다.
 *
 * 배치: 제어 `Int32Array(4)` = [STATE, BYTE_LENGTH, FLAGS, 예약] + 데이터 `Uint8Array(CAPACITY)`. growable
 * `SharedArrayBuffer`는 쓰지 않고 고정 할당한다.
 */
const CAPACITY = 64 * 1024;
const HEADER_BYTES = 16;

/** `Atomics.waitAsync`가 없는 환경에서 IDLE 복귀를 확인하는 간격(ms). */
const POLL_INTERVAL_MS = 1;

// ctrl 인덱스
const STATE = 0;
const BYTE_LENGTH = 1;
const FLAGS = 2;

// ctrl[STATE] 값
const IDLE = 0;
const READY = 1;
const CANCELLED = 2;
const ERROR = 3;

// ctrl[FLAGS] 비트: 마지막 청크
const FLAG_LAST = 1;

/** 초기화 프레임의 `stdinCtrl`·`stdinData`가 되는 두 뷰. 같은 SharedArrayBuffer를 가리킨다. */
export interface StdinMailboxBuffers {
  ctrl: Int32Array;
  data: Uint8Array;
}

export function createStdinMailbox(): StdinMailboxBuffers {
  const sab = new SharedArrayBuffer(HEADER_BYTES + CAPACITY);
  return {
    ctrl: new Int32Array(sab, 0, 4),
    data: new Uint8Array(sab, HEADER_BYTES, CAPACITY),
  };
}

/** main 쪽. `readInput` 알림을 받은 뒤에만 쓴다. */
export interface MailboxWriter {
  /** 한 줄을 전달한다. 64KiB를 넘으면 청크로 나눠 worker가 가져갈 때마다 다음 청크를 쓴다. */
  deliver(text: string): Promise<void>;
  /** worker의 `wait()`를 `null`로 끝낸다(읽기 취소). */
  cancel(): Promise<void>;
  /** worker의 `wait()`가 `message`를 가진 Error를 던지게 한다. 데이터 영역을 넘는 메시지는 문자 경계에서 자른다. */
  fail(message: string): Promise<void>;
}

// Atomics.waitAsync는 lib.es2022 타입에 없다. 지원 여부는 호출 시점에 확인한다.
type WaitAsync = (
  typedArray: Int32Array,
  index: number,
  value: number,
) =>
  | { async: false; value: "not-equal" | "timed-out" }
  | { async: true; value: Promise<"ok" | "timed-out"> };

/**
 * 직전 청크를 worker가 가져가 STATE가 IDLE로 돌아올 때까지 기다린다. `Atomics.waitAsync`가 있으면 그것으로, 없으면
 * `POLL_INTERVAL_MS` 폴링으로 기다린다. 깨어난 뒤에는 값을 다시 읽어 확인한다.
 */
async function untilIdle(ctrl: Int32Array): Promise<void> {
  for (;;) {
    const state = Atomics.load(ctrl, STATE);
    if (state === IDLE) return;
    const waitAsync = (Atomics as unknown as { waitAsync?: WaitAsync })
      .waitAsync;
    if (waitAsync) {
      const result = waitAsync(ctrl, STATE, state);
      if (result.async) await result.value;
    } else {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS),
      );
    }
  }
}

/** STATE를 바꾸고 그 값을 기다리는 쪽을 깨운다. 양쪽이 IDLE 복귀를 기다리므로 IDLE로 되돌릴 때도 부른다. */
function setState(ctrl: Int32Array, state: number): void {
  Atomics.store(ctrl, STATE, state);
  Atomics.notify(ctrl, STATE);
}

export function createMailboxWriter({
  ctrl,
  data,
}: StdinMailboxBuffers): MailboxWriter {
  return {
    async deliver(text) {
      const bytes = new TextEncoder().encode(text);
      // 빈 문자열도 빈 청크 하나로 보낸다(do-while).
      let offset = 0;
      do {
        await untilIdle(ctrl);
        const end = Math.min(offset + CAPACITY, bytes.length);
        data.set(bytes.subarray(offset, end));
        Atomics.store(ctrl, BYTE_LENGTH, end - offset);
        Atomics.store(ctrl, FLAGS, end === bytes.length ? FLAG_LAST : 0);
        setState(ctrl, READY);
        offset = end;
      } while (offset < bytes.length);
    },
    async cancel() {
      await untilIdle(ctrl);
      setState(ctrl, CANCELLED);
    },
    async fail(message) {
      await untilIdle(ctrl);
      // encodeInto는 완전한 문자만 쓰므로 넘치는 메시지도 깨진 문자 없이 잘린다.
      const { written } = new TextEncoder().encodeInto(message, data);
      Atomics.store(ctrl, BYTE_LENGTH, written);
      setState(ctrl, ERROR);
    },
  };
}

/** worker 쪽. `Atomics.wait`는 worker에서만 허용된다. */
export interface MailboxReader {
  wait(): string | null;
}

export function createMailboxReader({
  ctrl,
  data,
}: StdinMailboxBuffers): MailboxReader {
  return {
    wait() {
      // 청크 경계는 바이트 단위라 UTF-8 시퀀스 중간일 수 있다. 디코더를 청크 사이에 이어 붙이고 마지막 청크에서 닫는다.
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        Atomics.wait(ctrl, STATE, IDLE);
        switch (Atomics.load(ctrl, STATE)) {
          case READY: {
            // TextDecoder는 SharedArrayBuffer 뷰를 받지 않는 브라우저가 있어 복사한 뒤 디코드한다.
            const chunk = data.slice(0, Atomics.load(ctrl, BYTE_LENGTH));
            const last = (Atomics.load(ctrl, FLAGS) & FLAG_LAST) !== 0;
            setState(ctrl, IDLE);
            text += decoder.decode(chunk, { stream: !last });
            if (last) return text;
            break;
          }
          case CANCELLED:
            setState(ctrl, IDLE);
            return null;
          case ERROR: {
            const message = new TextDecoder().decode(
              data.slice(0, Atomics.load(ctrl, BYTE_LENGTH)),
            );
            setState(ctrl, IDLE);
            throw new Error(message);
          }
        }
      }
    },
  };
}
