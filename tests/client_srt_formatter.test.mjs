import test from "node:test";
import assert from "node:assert/strict";

import { formatSrtTime, formatSrt } from "../frontend/client_srt_formatter.js";

test("client SRT formatter carries rounded milliseconds into the next second", () => {
  assert.equal(formatSrtTime(1.9996), "00:00:02,000");
});

test("client SRT formatter builds translated subtitle blocks without the Python service", () => {
  const srt = formatSrt([
    { index: 1, start: 0, end: 1.5, text: "Bonjour", translatedText: "Hello" },
    { index: 2, start: 61.25, end: 62.75, text: "Au revoir" },
  ]);

  assert.equal(
    srt,
    [
      "1",
      "00:00:00,000 --> 00:00:01,500",
      "Hello",
      "",
      "2",
      "00:01:01,250 --> 00:01:02,750",
      "Au revoir",
      "",
    ].join("\n"),
  );
});
