// Offline lifecycle tests: every HTTP call goes to a mocked fetch; no Magnific request is sent.
import { test } from "node:test";
import assert from "node:assert/strict";

import { assertMappingCoversPorts, verifyGeneratedImageSet, verifyGeneratedVideoSet } from "@hypit/hypit/generation";
import { sealSeedanceRequest, seedancePorts } from "@hypit/seedance";
import { nanoBananaPorts, sealNanoBananaRequest } from "@hypit/nano-banana";
import { gptImage2Ports, sealGptImage2Request } from "@hypit/gpt-image";

import { createMagnificProvider, diagnoseMagnificProvider, magnificRoutes } from "../src/index.js";
import activation from "../src/activation.js";

const API = "https://api.magnific.com";
const KEY = "test-key-not-a-secret";

// --- fixtures -------------------------------------------------------------------------------

function resourceStore() {
  const blobs = new Map();
  let next = 0;
  return {
    blobs,
    async put(bytes, mediaType) {
      const ref = { kind: "blob", resource: `res_out${next++}`, size: bytes.byteLength, mediaType };
      blobs.set(ref.resource, bytes);
      return ref;
    },
    async write() { throw new Error("unused"); },
    async get(resource) { return blobs.get(resource); },
    async has(resource) { return blobs.has(resource); },
  };
}

/** Admits local bytes as a BlobRef, the way an imported asset arrives in a request. */
function admit(store, name, mediaType, size = 64) {
  const bytes = new Uint8Array(size).fill(7);
  const ref = { kind: "blob", resource: `res_${name}`, size, mediaType };
  store.blobs.set(ref.resource, bytes);
  return ref;
}
const media = (role, artifact, fields) => ({ role, artifact, ...(fields === undefined ? {} : { fields }) });

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * Mock Magnific: upload slots, signed PUTs, one submit, scripted poll answers and CDN downloads.
 * `polls` is consumed one answer per GET on the task path.
 */
function mockMagnific({ submit = { data: { task_id: "task-1", status: "CREATED", generated: [] } }, polls = [], downloads = {} } = {}) {
  const calls = [];
  let uploads = 0;
  const fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, headers, body });
    if (url === `${API}/v1/ai/uploads/request-url` && method === "POST") {
      const n = uploads++;
      const type = body.files[0].content_type;
      return json({ files: [{
        file_id: `upl_${n}`,
        upload_url: `https://storage.test/put/${n}?sig=abc`,
        headers: { "Content-Type": type, "x-goog-content-length-range": "0,1073741824" },
        expires_in: 120,
        asset_url: `https://cdn.test/uploads/${type.replace("/", "-")}-${n}?token=t`,
      }] });
    }
    if (url.startsWith("https://storage.test/put/") && method === "PUT") return new Response(null, { status: 200 });
    if (url.startsWith("https://cdn.test/result")) {
      const found = downloads[url];
      return found === undefined ? new Response("gone", { status: 403 }) : new Response(found.bytes, { status: 200, headers: { "content-type": found.type } });
    }
    if (url.startsWith(API) && method === "POST") return typeof submit === "function" ? submit() : json(submit);
    if (url.startsWith(API) && method === "GET") {
      const next = polls.shift();
      if (next === undefined) throw new Error(`Unexpected GET ${url}`);
      return typeof next === "function" ? next() : json(next);
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };
  return { fetch, calls };
}

function contextFor(capabilityName, moduleName, request, resources, checkpoints = []) {
  const route = magnificRoutes.find((item) => item.capability.name === capabilityName && item.capability.module.name === moduleName);
  return {
    command: {}, operation: "op-1",
    need: { capability: route.capability, returns: route.returns, constraints: request },
    resources,
    credentials: { apiKey: { secret: KEY } },
    checkpoint: async (checkpoint) => { checkpoints.push(checkpoint); },
    reportProgress: async () => {},
  };
}

function provider(fetch) {
  const pkg = createMagnificProvider({ fetch, pollIntervalMs: 10 });
  const endpoints = new Map();
  pkg.install({
    registerImmediateEndpoint() { throw new Error("unexpected immediate endpoint"); },
    registerAsyncEndpoint(_id, capability, _returns, endpoint, options) {
      endpoints.set(`${capability.module.name}#${capability.name}`, { endpoint, options });
    },
  });
  return { pkg, endpoints, get: (key) => endpoints.get(key).endpoint, supports: (key, request, pendingInputs) => {
    const route = magnificRoutes.find((item) => `${item.capability.module.name}#${item.capability.name}` === key);
    return endpoints.get(key).options.supports({ capability: route.capability, returns: route.returns, constraints: request, ...(pendingInputs ? { pendingInputs } : {}) });
  } };
}

const seedanceRequest = (model, ports) => sealSeedanceRequest(model, {
  prompt: ["A woman holds @Image1 and speaks in the voice of @Audio1."],
  duration: [8], resolution: ["720p"], aspectRatio: ["9:16"], generateAudio: [false], webSearch: [false],
  ...ports,
});

// --- tests ----------------------------------------------------------------------------------

test("every mapping covers its model's exact port table", () => {
  const tables = {
    "@hypit/seedance#seedance-2": seedancePorts["seedance-2"],
    "@hypit/seedance#seedance-2-fast": seedancePorts["seedance-2-fast"],
    "@hypit/seedance#seedance-2-mini": seedancePorts["seedance-2-mini"],
    "@hypit/seedance#seedance-2.5": seedancePorts["seedance-2.5"],
    "@hypit/nano-banana#nano-banana-pro": nanoBananaPorts["nano-banana-pro"],
    "@hypit/gpt-image#gpt-image-2": gptImage2Ports,
  };
  assert.equal(magnificRoutes.length, 6);
  for (const route of magnificRoutes) {
    assertMappingCoversPorts(tables[`${route.capability.module.name}#${route.capability.name}`], route.mapping);
  }
});

test("Seedance 2 Mini 720p: uploads references, submits, polls and collects the video", async () => {
  const store = resourceStore();
  const image = admit(store, "presenter", "image/png");
  const audio = admit(store, "voice", "audio/wav");
  const request = seedanceRequest("seedance-2-mini", {
    referenceImage: [media("image", image, { personReference: true })],
    referenceAudio: [media("audio", audio)],
    generateAudio: [true],
  });
  const video = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  const { fetch, calls } = mockMagnific({
    polls: [
      { data: { task_id: "task-1", status: "IN_PROGRESS", generated: [] } },
      { data: { task_id: "task-1", status: "COMPLETED", error: null, generated: ["https://cdn.test/result/video.mp4?token=x"] } },
    ],
    downloads: { "https://cdn.test/result/video.mp4?token=x": { bytes: video, type: "video/mp4" } },
  });
  const { get, supports } = provider(fetch);
  assert.deepEqual(supports("@hypit/seedance#seedance-2-mini", request), { status: "supported" });
  const endpoint = get("@hypit/seedance#seedance-2-mini");
  const checkpoints = [];
  const context = contextFor("seedance-2-mini", "@hypit/seedance", request, store, checkpoints);

  const started = await endpoint.start(context);
  assert.equal(started.status, "pending", JSON.stringify(started));
  assert.deepEqual(started.receipt, { id: "task-1" });
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].handle.pollPath, "/v1/ai/video/seedance-2-mini");

  const slotRequests = calls.filter((call) => call.url.endsWith("/v1/ai/uploads/request-url"));
  assert.deepEqual(slotRequests.map((call) => call.body), [
    { files: [{ content_type: "image/png" }] },
    { files: [{ content_type: "audio/wav" }] },
  ]);
  assert.ok(slotRequests.every((call) => call.headers["x-magnific-api-key"] === KEY));
  const puts = calls.filter((call) => call.method === "PUT");
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((call) => call.headers["content-type"]), ["image/png", "audio/wav"]);
  assert.ok(puts.every((call) => call.headers["x-goog-content-length-range"] === "0,1073741824"));
  assert.ok(puts.every((call) => call.headers["x-magnific-api-key"] === undefined), "the key never goes to storage");

  const submit = calls.find((call) => call.method === "POST" && call.url.includes("/v1/ai/video/"));
  assert.equal(submit.url, `${API}/v1/ai/video/seedance-2-mini-720p`);
  assert.equal(submit.headers["x-magnific-api-key"], KEY);
  assert.deepEqual(submit.body, {
    prompt: "A woman holds @Image1 and speaks in the voice of @Audio1.",
    reference_images: ["https://cdn.test/uploads/image-png-0?token=t"],
    reference_audios: ["https://cdn.test/uploads/audio-wav-1?token=t"],
    duration: 8,
    aspect_ratio: "social_story_9_16",
    sound_effects: true,
    no_music: true,
  });

  const pending = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(pending.status, "pending");
  assert.equal(pending.progress.phase, "IN_PROGRESS");
  const ready = await endpoint.poll({ ...context, handle: pending.handle });
  assert.equal(ready.status, "ready");
  const pollCalls = calls.filter((call) => call.method === "GET" && call.url.startsWith(API));
  assert.deepEqual(pollCalls.map((call) => call.url), [
    `${API}/v1/ai/video/seedance-2-mini/task-1`, `${API}/v1/ai/video/seedance-2-mini/task-1`,
  ]);

  const collected = await endpoint.collect({ ...context, handle: ready.handle });
  assert.equal(collected.status, "completed", JSON.stringify(collected));
  const set = collected.result.value.value;
  verifyGeneratedVideoSet(set);
  assert.equal(set.videos.length, 1);
  assert.equal(set.videos[0].mediaType, "video/mp4");
  assert.deepEqual(store.blobs.get(set.videos[0].resource), video);
  const download = calls.find((call) => call.url.startsWith("https://cdn.test/result"));
  assert.equal(download.headers["x-magnific-api-key"], undefined, "the key never goes to the CDN");
});

test("Seedance routes choose the endpoint by resolution and 2.5 polls per resolution", async () => {
  const cases = [
    ["seedance-2", "4k", "/v1/ai/video/seedance-2-pro-4k", "/v1/ai/video/seedance-2-pro"],
    ["seedance-2-fast", "480p", "/v1/ai/video/seedance-2-fast-480p", "/v1/ai/video/seedance-2-fast"],
    ["seedance-2.5", "1080p", "/v1/ai/video/seedance-2-5-pro-1080p", "/v1/ai/video/seedance-2-5-pro-1080p"],
  ];
  for (const [model, resolution, submitPath, pollPath] of cases) {
    const store = resourceStore();
    const { fetch, calls } = mockMagnific();
    const checkpoints = [];
    const request = seedanceRequest(model, { resolution: [resolution] });
    const started = await provider(fetch).get(`@hypit/seedance#${model}`).start(contextFor(model, "@hypit/seedance", request, store, checkpoints));
    assert.equal(started.status, "pending", JSON.stringify(started));
    assert.equal(calls[0].url, `${API}${submitPath}`);
    assert.deepEqual(calls[0].body, {
      prompt: "A woman holds @Image1 and speaks in the voice of @Audio1.", duration: 8, aspect_ratio: "social_story_9_16", sound_effects: false,
    });
    assert.equal(checkpoints[0].handle.pollPath, pollPath);
  }
});

test("Seedance first frame with adaptive ratio sends image/image_end and omits aspect_ratio", async () => {
  const store = resourceStore();
  const first = admit(store, "first", "image/jpeg");
  const last = admit(store, "last", "image/webp");
  const request = seedanceRequest("seedance-2", {
    firstFrame: [media("image", first, { personReference: false })],
    lastFrame: [media("image", last, { personReference: true })],
    aspectRatio: ["adaptive"],
  });
  const { fetch, calls } = mockMagnific();
  const started = await provider(fetch).get("@hypit/seedance#seedance-2").start(contextFor("seedance-2", "@hypit/seedance", request, store));
  assert.equal(started.status, "pending", JSON.stringify(started));
  const submit = calls.find((call) => call.url === `${API}/v1/ai/video/seedance-2-pro-720p`);
  assert.equal(submit.body.image, "https://cdn.test/uploads/image-jpeg-0?token=t");
  assert.equal(submit.body.image_end, "https://cdn.test/uploads/image-webp-1?token=t");
  assert.equal("aspect_ratio" in submit.body, false);
});

test("Seedance support reports what Magnific cannot render", () => {
  const store = resourceStore();
  const { supports } = provider(mockMagnific().fetch);
  const reason = (key, request, pending) => supports(key, request, pending).reason;
  assert.match(reason("@hypit/seedance#seedance-2-mini", seedanceRequest("seedance-2-mini", { webSearch: [true] })), /no web search/);
  assert.match(reason("@hypit/seedance#seedance-2.5", seedanceRequest("seedance-2.5", { duration: [-1] })), /no automatic \(-1\) duration/);
  assert.match(reason("@hypit/seedance#seedance-2-mini", seedanceRequest("seedance-2-mini", { aspectRatio: ["adaptive"] })), /no adaptive aspect ratio/);
  const ogg = seedanceRequest("seedance-2-mini", {
    referenceImage: [media("image", admit(store, "img", "image/png"), { personReference: false })],
    referenceAudio: [media("audio", admit(store, "ogg", "audio/ogg"))],
  });
  assert.match(reason("@hypit/seedance#seedance-2-mini", ogg), /reference audio must be audio\/mpeg, audio\/wav/);
  const bigVideo = seedanceRequest("seedance-2-fast", {
    referenceVideo: [media("video", admit(store, "big", "video/mp4", 60_000_000), { personReference: true })],
  });
  assert.match(reason("@hypit/seedance#seedance-2-fast", bigVideo), /limited to 50 MB/);
  // Planning: future audio without a visual reference is refused for Seedance 2.0 only.
  const textOnly = seedanceRequest("seedance-2-mini", {});
  assert.match(reason("@hypit/seedance#seedance-2-mini", textOnly, [{ input: "referenceAudio", role: "audio" }]), /requires a reference image or video/);
  assert.deepEqual(supports("@hypit/seedance#seedance-2.5", seedanceRequest("seedance-2.5", {}), [{ input: "referenceAudio", role: "audio" }]), { status: "supported" });
  assert.deepEqual(supports("@hypit/seedance#seedance-2-mini", textOnly, [{ input: "firstFrame", role: "image" }]), { status: "supported" });
});

test("Nano Banana Pro with a reference sends {image, mime_type} objects and collects the PNG", async () => {
  const store = resourceStore();
  const product = admit(store, "product", "image/jpeg");
  const request = sealNanoBananaRequest("nano-banana-pro", {
    prompt: ["The serum tube on a bathroom shelf"], aspectRatio: ["9:16"], resolution: ["2K"], outputFormat: ["png"],
    images: [media("image", product)],
  });
  const png = new Uint8Array([137, 80, 78, 71]);
  const { fetch, calls } = mockMagnific({
    polls: [{ data: { task_id: "task-1", status: "COMPLETED", error: null, generated: ["https://cdn.test/result/a.png?token=y"] } }],
    downloads: { "https://cdn.test/result/a.png?token=y": { bytes: png, type: "image/png" } },
  });
  const endpoint = provider(fetch).get("@hypit/nano-banana#nano-banana-pro");
  const context = contextFor("nano-banana-pro", "@hypit/nano-banana", request, store);
  const started = await endpoint.start(context);
  assert.equal(started.status, "pending", JSON.stringify(started));
  const submit = calls.find((call) => call.url === `${API}/v1/ai/text-to-image/nano-banana-pro` && call.method === "POST");
  assert.deepEqual(submit.body, {
    prompt: "The serum tube on a bathroom shelf", num_images: 1, aspect_ratio: "9:16", resolution: "2K",
    reference_images: [{ image: "https://cdn.test/uploads/image-jpeg-0?token=t", mime_type: "image/jpeg" }],
  });
  const ready = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(calls.at(-1).url, `${API}/v1/ai/text-to-image/nano-banana-pro/task-1`);
  const collected = await endpoint.collect({ ...context, handle: ready.handle });
  verifyGeneratedImageSet(collected.result.value.value);
  assert.equal(collected.result.value.value.images[0].mediaType, "image/png");
});

test("Nano Banana Pro reports jpg output unsupported", () => {
  const { supports } = provider(mockMagnific().fetch);
  const request = sealNanoBananaRequest("nano-banana-pro", {
    prompt: ["x"], aspectRatio: ["1:1"], resolution: ["1K"], outputFormat: ["jpg"],
  });
  assert.match(supports("@hypit/nano-banana#nano-banana-pro", request).reason, /returns PNG, not jpg/);
});

test("GPT Image 2 uses the generate endpoint without references and the edit endpoint with them", async () => {
  const plain = sealGptImage2Request({ prompt: ["A poster"], aspectRatio: ["9:16"], resolution: ["2K"], background: ["opaque"] });
  let mock = mockMagnific();
  let started = await provider(mock.fetch).get("@hypit/gpt-image#gpt-image-2").start(contextFor("gpt-image-2", "@hypit/gpt-image", plain, resourceStore()));
  assert.equal(started.status, "pending", JSON.stringify(started));
  assert.equal(mock.calls[0].url, `${API}/v1/ai/text-to-image/gpt-image-2`);
  assert.deepEqual(mock.calls[0].body, { prompt: "A poster", num_images: 1, aspect_ratio: "social_story_9_16", resolution: "2k", background: "opaque" });

  const store = resourceStore();
  const edit = sealGptImage2Request({
    prompt: ["Put the product on marble"], aspectRatio: ["3:2"], resolution: ["1K"],
    images: [media("image", admit(store, "a", "image/png")), media("image", admit(store, "b", "image/webp"))],
  });
  mock = mockMagnific({ polls: [{ data: { task_id: "task-1", status: "IN_PROGRESS", generated: [] } }] });
  const endpoint = provider(mock.fetch).get("@hypit/gpt-image#gpt-image-2");
  const context = contextFor("gpt-image-2", "@hypit/gpt-image", edit, store);
  started = await endpoint.start(context);
  const submit = mock.calls.find((call) => call.method === "POST" && call.url.includes("text-to-image"));
  assert.equal(submit.url, `${API}/v1/ai/text-to-image/gpt-image-2-edit`);
  assert.deepEqual(submit.body, {
    prompt: "Put the product on marble", num_images: 1, aspect_ratio: "standard_3_2", resolution: "1k",
    reference_images: ["https://cdn.test/uploads/image-png-0?token=t", "https://cdn.test/uploads/image-webp-1?token=t"],
  });
  await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(mock.calls.at(-1).url, `${API}/v1/ai/text-to-image/gpt-image-2-edit/task-1`);
});

test("GPT Image 2 support: transparent background and unnamed ratios are unsupported; future references are fine", () => {
  const { supports } = provider(mockMagnific().fetch);
  const key = "@hypit/gpt-image#gpt-image-2";
  assert.match(supports(key, sealGptImage2Request({ prompt: ["x"], aspectRatio: ["1:1"], resolution: ["1K"], background: ["transparent"] })).reason, /not transparent/);
  assert.match(supports(key, sealGptImage2Request({ prompt: ["x"], aspectRatio: ["4:5"], resolution: ["1K"] })).reason, /not 4:5/);
  assert.deepEqual(supports(key, sealGptImage2Request({ prompt: ["x"], aspectRatio: ["9:16"], resolution: ["4K"] }), [{ input: "images", role: "image" }]), { status: "supported" });
});

test("a FAILED task fails with Magnific's reason and redacted URLs", async () => {
  const { fetch } = mockMagnific({
    polls: [{ data: { task_id: "task-1", status: "FAILED", generated: [], error: "Content rejected for https://cdn.test/secret?token=z" } }],
  });
  const endpoint = provider(fetch).get("@hypit/gpt-image#gpt-image-2");
  const context = contextFor("gpt-image-2", "@hypit/gpt-image", sealGptImage2Request({ prompt: ["x"], aspectRatio: ["1:1"], resolution: ["1K"] }), resourceStore());
  const started = await endpoint.start(context);
  const failed = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure.code, "MAGNIFIC_TASK_FAILED");
  assert.equal(failed.failure.message, "Magnific task task-1 failed: Content rejected for [redacted-url]");
  assert.deepEqual(failed.receipt, { id: "task-1" });
});

test("a COMPLETED task without generated media is a failure, not a pending job", async () => {
  const { fetch } = mockMagnific({ polls: [{ data: { task_id: "task-1", status: "COMPLETED", generated: [] } }] });
  const endpoint = provider(fetch).get("@hypit/seedance#seedance-2-mini");
  const context = contextFor("seedance-2-mini", "@hypit/seedance", seedanceRequest("seedance-2-mini", {}), resourceStore());
  const started = await endpoint.start(context);
  const failed = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure.code, "MAGNIFIC_EMPTY_RESULT");
});

test("HTTP errors: a rejected submit fails with its reason; a 503 poll keeps waiting", async () => {
  const rejected = mockMagnific({
    submit: () => json({ message: "Validation error", invalid_params: [{ field: "duration", reason: "must be <= 15" }] }, 400),
  });
  const checkpoints = [];
  const context = contextFor("seedance-2-mini", "@hypit/seedance", seedanceRequest("seedance-2-mini", {}), resourceStore(), checkpoints);
  const failed = await provider(rejected.fetch).get("@hypit/seedance#seedance-2-mini").start(context);
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure.code, "MAGNIFIC_HTTP_ERROR");
  assert.match(failed.failure.message, /HTTP 400; POST \/v1\/ai\/video\/seedance-2-mini-720p: Validation error; duration: must be <= 15/);
  assert.equal(checkpoints.length, 0);

  const busy = mockMagnific({ polls: [() => json({ message: "Service Unavailable" }, 503)] });
  const endpoint = provider(busy.fetch).get("@hypit/seedance#seedance-2-mini");
  const started = await endpoint.start({ ...context, checkpoint: async () => {} });
  const retry = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(retry.status, "pending");
  assert.equal(retry.progress.phase, "retrying");
});

test("activation reads the Profile config and doctor uses only free GETs", async () => {
  const activated = await activation.hostFacets[0].implementation.activate({
    instance: "magnific.default", pool: "magnific.default",
    config: { apiKey: { store: "env", key: "MAGNIFIC_API_KEY" }, defaultConcurrency: 3 },
  });
  assert.equal(activated.endpoint.offers.length, 6);
  assert.deepEqual(activated.endpoint.pricing, { kind: "page", url: "https://www.magnific.com/ai/docs/ai-video-generator-credits" });
  assert.deepEqual(activated.endpoint.credentials[0].ref, { store: "env", key: "MAGNIFIC_API_KEY" });

  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push(`${init.method ?? "GET"} ${url}`);
    return String(url).endsWith("/v1/ai/uploads") ? json({ files: [] }) : json({ message: "Task not found" }, 404);
  };
  const diagnostics = await diagnoseMagnificProvider({ fetch }, { credentials: { apiKey: { secret: KEY } } });
  assert.ok(seen.every((call) => call.startsWith("GET ")));
  assert.equal(diagnostics.filter((item) => item.severity === "error").length, 0);
  assert.equal(diagnostics[0].code, "MAGNIFIC_KEY_ACCEPTED");
});
