/**
 * coincident 부트스트랩 관찰기. coincident는 worker 전역에서 main이 생성자 안에서 동기로 보내는 부트스트랩 메시지(배열
 * `[UID, serviceWorker, ffi_timeout]`)를 받아야 `coincident()`가 풀린다. worker 모듈이 이 메시지보다 늦게 평가되면(첫 정적
 * import 규칙 위반) 부트스트랩을 놓쳐 영원히 대기하므로, "배열 메시지가 도착했는가"만 기록해 `prepare`가 명시 오류로 실패할 수
 * 있게 한다(고정 대기를 쓰지 않는다).
 *
 * coincident 리스너는 `stopImmediatePropagation()`으로 메시지를 삼키므로 그보다 뒤에 걸린 일반 리스너는 메시지를 보지 못한다.
 * 관찰기는 캡처 단계 리스너(같은 대상에서는 캡처 리스너가 먼저 호출된다, DOM 표준)로 걸어 등록 순서와 무관하게 먼저 본다. 메시지를
 * 소비하지도(`stopImmediatePropagation`·`preventDefault` 금지) `once`로 떼지도 않는다. core init 프레임(객체)은 세지 않는다.
 */

/** 관찰기가 리스너를 거는 대상. worker 전역이 기본이고 시험은 DOM 노드를 준다. */
export interface ObservedTarget {
  addEventListener(
    type: "message",
    listener: (event: Event) => void,
    options: AddEventListenerOptions,
  ): void;
}

export interface BootstrapObserver {
  /** 부트스트랩(배열) 메시지를 한 번이라도 받았는가. */
  readonly received: boolean;
}

export function createBootstrapObserver(
  target: ObservedTarget,
): BootstrapObserver {
  let received = false;
  target.addEventListener(
    "message",
    (event) => {
      if (Array.isArray((event as MessageEvent).data)) received = true;
    },
    { capture: true },
  );
  return {
    get received() {
      return received;
    },
  };
}
