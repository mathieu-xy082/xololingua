import assert from "node:assert/strict";
import test from "node:test";

import { resolveServiceBaseUrl } from "../frontend/service_url.js";

test("local development keeps the local Python service", () => {
  assert.equal(resolveServiceBaseUrl({ hostname: "localhost", origin: "http://localhost:4173" }), "http://127.0.0.1:8765");
  assert.equal(resolveServiceBaseUrl({ hostname: "127.0.0.1", origin: "http://127.0.0.1:4173" }), "http://127.0.0.1:8765");
});

test("hosted application uses the same HTTPS origin for its API", () => {
  assert.equal(resolveServiceBaseUrl({ hostname: "xololingua.example", origin: "https://xololingua.example" }), "https://xololingua.example");
});
