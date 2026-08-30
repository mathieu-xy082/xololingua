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
