import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
const origin = "https://xololingua.example";
const currentCache = source.match(/const CACHE_NAME = "([^"]+)"/)[1];
const html = (body, options = {}) => new Response(body, {
  ...options, headers: { "Content-Type": "text/html", ...options.headers },
});

// Cache API string keys resolve against the worker URL, not the document URL.
function worker({ network = async () => html("studio"), put = async () => {} } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const key = (request) => new URL(typeof request === "string" ? request : request.url, `${origin}/sw.js`).href;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async put(request, response) { await put(request, response); store.set(key(request), response.clone()); },
      async match(request) { return store.get(key(request))?.clone(); },
      async addAll(requests) {
        for (const request of requests) {
          const response = await network({ url: key(request) });
          if (!response.ok) throw new TypeError("Precache failed");
          store.set(key(request), response.clone());
        }
      },
    };
  };
  const caches = {
    open,
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const name of stores.keys()) {
        const response = await (await open(name)).match(request);
        if (response) return response;
      }
    },
  };
  const self = {
    location: { origin, href: `${origin}/sw.js` },
    registration: { scope: `${origin}/` },
    addEventListener(name, handler) { listeners.set(name, handler); },
    skipWaiting() {},
    clients: { async claim() {} },
  };
  vm.runInNewContext(source, { self, caches, fetch: (request) => network(typeof request === "string" ? { url: key(request) } : request), URL, Response });
  function dispatch(name, request) {
    const pending = [];
    let response;
    listeners.get(name)({
      request,
      waitUntil(promise) { pending.push(Promise.resolve(promise)); },
      respondWith(promise) { response = Promise.resolve(promise); },
    });
    return { response, pending, async settled() { await Promise.all(pending); } };
  }
  return {
    stores, caches, key, dispatch,
    fetch(path, options = {}) {
      return dispatch("fetch", { url: new URL(path, origin).href, method: "GET", mode: "navigate", destination: "document", ...options });
    },
  };
}

async function navigate(runtime, path, options) {
  const event = runtime.fetch(path, options);
  const response = await event.response;
  await event.settled();
  return response;
}

test("non-GET, API and cross-origin requests bypass interception in every request mode", () => {
  const runtime = worker({ network: async () => { assert.fail("bypassed request reached fetch"); } });
  for (const [path, options] of [["/api/health", {}], ["/api/subtitle-jobs/result", { destination: "document" }],
    ["https://models.example/model.js", { mode: "cors", destination: "script" }], ["/", { method: "POST" }]]) {
    const event = runtime.fetch(path, options);
    assert.equal(event.response, undefined);
    assert.equal(event.pending.length, 0);
  }
  assert.equal(runtime.stores.size, 0);
});

test("scripts stay network-first while other assets stay cache-first and both work offline", async () => {
  let offline = false;
  const requests = [];
  const runtime = worker({ network: async (request) => {
    requests.push(request.url);
    if (offline) throw new TypeError("offline");
    return new Response("fresh");
  } });
  const cache = await runtime.caches.open(currentCache);
  await cache.put("/app.js?v=test", new Response("old script"));
  await cache.put("/styles.css?v=test", new Response("old style"));
  assert.equal(await (await navigate(runtime, "/app.js?v=test", { mode: "cors", destination: "script" })).text(), "fresh");
  assert.equal(await (await navigate(runtime, "/styles.css?v=test", { mode: "cors", destination: "style" })).text(), "old style");
  assert.deepEqual(requests, [`${origin}/app.js?v=test`]);
  offline = true;
  assert.equal(await (await navigate(runtime, "/app.js?v=test", { mode: "cors", destination: "script" })).text(), "fresh");
  assert.equal(await (await navigate(runtime, "/styles.css?v=test", { mode: "cors", destination: "style" })).text(), "old style");
});

test("a first document 404 remains a 404 and is not offered as offline shell or guide", async () => {
  let offline = false;
  const runtime = worker({ network: async () => {
    if (offline) throw new TypeError("offline");
    return html("missing", { status: 404 });
  } });
  for (const path of ["/", "/index.html", "/unknown", "/en/youtube-subtitles"]) {
    const response = await navigate(runtime, path);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "missing");
  }
  offline = true;
  for (const path of ["/", "/index.html", "/unknown", "/en/youtube-subtitles"]) {
    const event = runtime.fetch(path);
    await assert.rejects(event.response, /offline/);
    await event.settled();
  }
});

test("failed cache writes never reject successful fetch responses or escape the event lifetime", async () => {
  for (const [path, options] of [["/", {}], ["/app.js", { mode: "cors", destination: "script" }],
    ["/styles.css", { mode: "cors", destination: "style" }]]) {
    const runtime = worker({ put: async () => { throw new Error("cache quota exhausted"); } });
    const event = runtime.fetch(path, options);
    assert.equal((await event.response).status, 200);
    await event.settled();
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test("fetch waitUntil tracks delayed cache writes for documents, scripts and cache-first assets", async () => {
  for (const [path, options] of [["/", {}], ["/app.js?v=test", { mode: "cors", destination: "script" }],
    ["/styles.css?v=test", { mode: "cors", destination: "style" }]]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const runtime = worker({ put: () => gate });
    const event = runtime.fetch(path, options);
    assert.equal((await event.response).status, 200);
    assert.ok(event.pending.length > 0, `${path} needs a fetch lifetime promise`);
    let completed = false;
    const lifetime = event.settled().then(() => { completed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false, `${path} must wait for cache.put`);
    release();
    await lifetime;
    assert.ok(runtime.stores.get(currentCache).has(`${origin}${path}`));
  }
});

test("activation removes only obsolete XoloLingua caches and never reuses a polluted old shell", async () => {
  let offline = false;
  const runtime = worker({ network: async () => {
    if (offline) throw new TypeError("offline");
    return html("fresh studio");
  } });
  const oldCache = await runtime.caches.open("xololingua-2026-09-21-3");
  await oldCache.put("index.html", html("polluted guide"));
  const unrelated = await runtime.caches.open("unrelated-cache");
  await unrelated.put("/", html("unrelated document"));
  await runtime.dispatch("install").settled();
  // Even before activation, document fallback must not use caches.match across namespaces.
  offline = true;
  assert.equal(await (await navigate(runtime, "/index.html?upgrade=1")).text(), "fresh studio");
  await runtime.dispatch("activate").settled();
  assert.deepEqual(await runtime.caches.keys(), ["unrelated-cache", currentCache]);
  assert.equal(await (await navigate(runtime, "/")).text(), "fresh studio");
});

test("precache root '.' serves only shell aliases, including queries, on the first offline visit", async () => {
  let offline = false;
  const runtime = worker({ network: async () => {
    if (offline) throw new TypeError("offline");
    return html("precache studio");
  } });
  await runtime.dispatch("install").settled();
  assert.ok(runtime.stores.get(currentCache).has(`${origin}/`));
  offline = true;
  for (const path of ["/", "/?from=guide", "/index.html", "/index.html?from=guide"]) {
    assert.equal(await (await navigate(runtime, path)).text(), "precache studio", path);
  }
  for (const path of ["/unknown", "/index.html/", "/en/video-subtitle-generator", "/sous-titres-youtube?from=guide"]) {
    const event = runtime.fetch(path);
    await assert.rejects(event.response, /offline/, path);
    await event.settled();
  }
});

test("all six guides keep their own request URL including query and do not borrow other documents", async () => {
  let offline = false;
  const runtime = worker({ network: async (request) => {
    if (offline) throw new TypeError("offline");
    return html(request.url);
  } });
  const paths = ["/generateur-sous-titres-video", "/traduire-sous-titres-srt", "/sous-titres-youtube",
    "/en/video-subtitle-generator", "/en/translate-srt-subtitles", "/en/youtube-subtitles"];
  for (const path of paths) await navigate(runtime, path);
  await navigate(runtime, "/en/youtube-subtitles?from=test");
  offline = true;
  for (const path of [...paths, "/en/youtube-subtitles?from=test"]) {
    assert.equal(await (await navigate(runtime, path)).text(), `${origin}${path}`);
  }
  for (const path of ["/unknown", "/en/youtube-subtitles?from=uncached", "/en/youtube-subtitles/"]) {
    const event = runtime.fetch(path);
    await assert.rejects(event.response, /offline/);
    await event.settled();
  }
});

test("install rejects an invalid root document rather than precaching it as shell", async () => {
  const redirected = html("guide");
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const response of [redirected, html("missing", { status: 404 }), new Response("not HTML")]) {
    const runtime = worker({ network: async (request) => new URL(request.url).pathname === "/" ? response : html("asset") });
    await assert.rejects(runtime.dispatch("install").settled());
    assert.equal(runtime.stores.get(currentCache)?.has(`${origin}/`), false);
  }
});

test("document errors and redirects remain network responses and never replace cached documents", async () => {
  const redirected = html("redirected guide");
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const rejected of [html("missing", { status: 404 }), html("unavailable", { status: 503 }),
    new Response(null, { status: 302, headers: { Location: "/generateur-sous-titres-video" } }),
    redirected, new Response("not HTML"), html("private", { headers: { "Cache-Control": "no-store" } })]) {
    for (const path of ["/", "/index.html?from=guide", "/en/youtube-subtitles", "/unknown"]) {
      let response = html("known good");
      const runtime = worker({ network: async () => response });
      await navigate(runtime, path);
      const cacheKey = path.startsWith("/index.html") ? "/" : path;
      const before = await (await (await runtime.caches.open(currentCache)).match(cacheKey)).text();
      response = rejected;
      assert.equal(await navigate(runtime, path), rejected);
      const after = await (await (await runtime.caches.open(currentCache)).match(cacheKey)).text();
      assert.equal(after, before, `${path}: ${rejected.status}, redirected=${rejected.redirected}`);
    }
  }
});

test("root → guide → root offline keeps the studio and guide under separate absolute keys", async () => {
  let offline = false;
  const runtime = worker({ network: async (request) => {
    if (offline) throw new TypeError("offline");
    return html(new URL(request.url).pathname === "/" ? "studio" : "guide");
  } });
  assert.equal(await (await navigate(runtime, "/")).text(), "studio");
  assert.equal(await (await navigate(runtime, "/generateur-sous-titres-video")).text(), "guide");
  offline = true;
  assert.equal(await (await navigate(runtime, "/")).text(), "studio");
  assert.equal(await (await navigate(runtime, "/generateur-sous-titres-video")).text(), "guide");
  const store = runtime.stores.get(currentCache);
  assert.equal(await store.get(`${origin}/`).clone().text(), "studio");
  assert.equal(await store.get(`${origin}/generateur-sous-titres-video`).clone().text(), "guide");
});
