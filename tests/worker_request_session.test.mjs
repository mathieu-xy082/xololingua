import test from "node:test";
import assert from "node:assert/strict";

import { createWorkerRequestSession } from "../frontend/worker_request_session.js";

test("worker request timeout measures inactivity and is refreshed by progress", async () => {
  let worker;
  let nextTimerId = 1;
  const timers = new Map();
  const clearedTimers = [];
  class FakeWorker {
    constructor() {
      worker = this;
    }

    postMessage() {}
    terminate() {
      this.terminated = true;
    }
  }
  const session = createWorkerRequestSession({
    environment: {
      Worker: FakeWorker,
      setTimeout(callback, timeoutMs) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timers.set(timerId, { callback, timeoutMs });
        return timerId;
      },
      clearTimeout(timerId) {
        clearedTimers.push(timerId);
        timers.delete(timerId);
      },
    },
    workerUrl: "/worker.js",
  });
  const progress = [];
  const pending = session.request({
    requestType: "transcribe",
    resultType: "result",
    request: {},
    onProgress: (event) => progress.push(event),
    timeoutMs: 300_000,
    timeoutMessage: "worker idle timeout",
  });

  assert.deepEqual([...timers.keys()], [1]);
  worker.onmessage({ data: { type: "progress", event: { progress: 25 } } });

  assert.deepEqual(progress, [{ progress: 25 }]);
  assert.deepEqual(clearedTimers, [1]);
  assert.deepEqual([...timers.keys()], [2]);
  assert.equal(timers.get(2).timeoutMs, 300_000);

  timers.get(2).callback();
  await assert.rejects(pending, /worker idle timeout/);
  assert.equal(worker.terminated, true);
});

test("worker request transfers selected audio buffers without cloning them", async () => {
  const calls = [];
  class FakeWorker {
    postMessage(message, transfer) {
      calls.push({ message, transfer });
      queueMicrotask(() => this.onmessage({ data: { type: "language-result", result: { languageCode: "fr" } } }));
    }
    terminate() {}
  }
  const session = createWorkerRequestSession({ environment: { Worker: FakeWorker }, workerUrl: "/worker.js" });
  const buffer = new Float32Array([0.1, 0.2]).buffer;

  const result = await session.request({
    requestType: "detect-language",
    resultType: "language-result",
    request: { samples: 1 },
    transfer: [buffer],
  });

  assert.deepEqual(result, { languageCode: "fr" });
  assert.deepEqual(calls, [{
    message: { type: "detect-language", request: { samples: 1 } },
    transfer: [buffer],
  }]);
});
