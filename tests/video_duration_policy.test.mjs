import test from "node:test";
import assert from "node:assert/strict";

import { resolveVideoDurationPolicy } from "../frontend/video_duration_policy.js";

test("public site accepts at most one hour while local development keeps 2 h 30 min", () => {
  assert.deepEqual(resolveVideoDurationPolicy({ hostname: "xololingua.fr" }), {
    maxDurationSeconds: 3600,
    label: "1 h",
  });
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.deepEqual(resolveVideoDurationPolicy({ hostname }), {
      maxDurationSeconds: 9000,
      label: "2 h 30 min",
    });
  }
});
