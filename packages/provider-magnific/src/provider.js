import { requestDeadline } from "@hypit/hypit/runtime-kit";
import {
  EndpointResponseError,
  EndpointServiceError,
  EndpointTransportError,
  canonicalize,
  credentialRef,
  defineEndpointPackage,
  pollAgainOrFail,
  transport,
  wakeAfter,
} from "@hypit/hypit/endpoint-kit";
import { magnificRouteForCapability, magnificRoutes, uploadContentType } from "./routes.js";
import { MagnificHttpError, MagnificServiceError, redact, taskFailureReason } from "./errors.js";

export const magnificProviderModuleRef = { name: "@viral-clone/provider-magnific", version: "1" };
export const magnificPricingPage = "https://www.magnific.com/ai/docs/ai-video-generator-credits";
export const magnificDefaultBaseUrl = "https://api.magnific.com";

const HANDLE_CONTRACT = "viral-clone.magnific-task@1";
/** Bounds one reference upload or one result download; API calls use requestTimeoutMs. */
const TRANSFER_TIMEOUT_MS = 10 * 60_000;
const PENDING_STATUSES = ["CREATED", "IN_PROGRESS"];
const EXTENSION_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function object(value, subject) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${subject} must be an object`);
  return value;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function failure(error) {
  return {
    status: "failed",
    failure: { code: error instanceof EndpointServiceError ? error.code : "MAGNIFIC_ERROR", message: redact(errorMessage(error)) },
  };
}
function apiKey(credentials) {
  const value = credentials.apiKey?.secret;
  assert(typeof value === "string" && value.length > 0,
    "Magnific apiKey credential is unavailable; supply the configured environment variable to the CLI and Worker");
  return value;
}
function httpsUrl(value, subject) {
  assert(typeof value === "string" && value.startsWith("https://"), `${subject} has no HTTPS URL`);
  return value;
}
function apiBaseUrl(value) {
  const url = new URL(value.trim());
  assert(url.protocol === "https:" || ["localhost", "127.0.0.1"].includes(url.hostname), "Magnific baseUrl must use HTTPS or loopback");
  return url.href.replace(/\/+$/u, "");
}
function capabilityKey(capability) {
  return `${capability.module.name}@${capability.module.version}#${capability.name}`;
}

class MagnificClient {
  constructor(baseUrl, timeoutMs, fetcher) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
  }

  /** One authenticated API call. The key goes only to the Magnific API, never to storage or CDN URLs. */
  async json(path, key, init = {}) {
    const method = init.method ?? "GET";
    const deadline = requestDeadline(this.timeoutMs, () => new EndpointTransportError(`Magnific ${method} ${path} timed out`));
    try {
      const response = await transport(deadline.wait(this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: deadline.signal,
        headers: {
          accept: "application/json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          "x-magnific-api-key": key,
        },
      })));
      const text = await transport(deadline.wait(response.text()));
      if (!response.ok) throw new MagnificHttpError(response.status, response.headers, text, { method, path });
      let body;
      try { body = JSON.parse(text); } catch { body = undefined; }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        throw new EndpointResponseError(`Magnific ${method} ${path} returned invalid JSON (${response.status})`);
      }
      return body;
    } finally {
      deadline.finish();
    }
  }

  /** `{ data: { task_id, status, generated, error } }` from submit and poll alike. */
  task(body, subject) {
    const data = object(body.data, `${subject} data`);
    if (typeof data.task_id !== "string" || data.task_id.length === 0) {
      throw new EndpointResponseError(`${subject} has no task_id`);
    }
    return data;
  }

  /** Request a signed upload slot, PUT the bytes with its signed headers, and return the readable asset URL. */
  async upload(bytes, contentType, key) {
    const answer = await this.json("/v1/ai/uploads/request-url", key, {
      method: "POST", body: JSON.stringify({ files: [{ content_type: contentType }] }),
    });
    const files = Array.isArray(answer.files) ? answer.files : Array.isArray(answer.data?.files) ? answer.data.files : [];
    const file = object(files[0], "Magnific upload slot");
    const uploadUrl = httpsUrl(file.upload_url, "Magnific upload slot");
    const assetUrl = httpsUrl(file.asset_url, "Magnific upload slot");
    const signed = Object.fromEntries(Object.entries(file.headers ?? {})
      .filter(([name]) => name.toLowerCase() !== "content-type")
      .map(([name, value]) => [name, String(value)]));
    const deadline = requestDeadline(TRANSFER_TIMEOUT_MS, () => new EndpointTransportError("Magnific upload timed out"));
    try {
      const response = await transport(deadline.wait(this.fetcher(uploadUrl, {
        method: "PUT", headers: { ...signed, "content-type": contentType }, body: bytes, signal: deadline.signal,
      })));
      if (!response.ok) throw new MagnificServiceError("MAGNIFIC_UPLOAD_FAILED", `Magnific upload PUT returned HTTP ${response.status}`);
    } finally {
      deadline.finish();
    }
    return assetUrl;
  }

  /** Result URLs are signed CDN links (Seedance links expire after 30 minutes); no API key is sent. */
  async download(url, media) {
    const deadline = requestDeadline(TRANSFER_TIMEOUT_MS, () => new EndpointTransportError("Magnific result download timed out"));
    try {
      const response = await transport(deadline.wait(this.fetcher(url, { signal: deadline.signal })));
      if (!response.ok) throw new MagnificServiceError("MAGNIFIC_DOWNLOAD_FAILED", `Magnific result download returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await transport(deadline.wait(response.arrayBuffer())));
      const header = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
      const mediaType = header?.startsWith(`${media}/`) ? header : EXTENSION_TYPES[extension];
      if (mediaType === undefined || !mediaType.startsWith(`${media}/`)) {
        throw new MagnificServiceError("MAGNIFIC_RESULT_TYPE", `Magnific returned ${header ?? "untyped"} content, not ${media}`);
      }
      return { bytes, mediaType };
    } finally {
      deadline.finish();
    }
  }
}

/** Uploads each referenced Resource once per request; Magnific endpoints then fetch the asset URL. */
function resolverFor(client, context, key) {
  const resolved = new Map();
  return (artifact) => {
    const existing = resolved.get(artifact.resource);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const bytes = await context.resources.get(artifact.resource);
      assert(bytes !== undefined && bytes.byteLength === artifact.size, `Reference Resource ${artifact.resource} is unavailable or has changed`);
      await context.reportProgress?.({ phase: `Uploading reference ${artifact.mediaType}` });
      return await client.upload(bytes, uploadContentType(artifact.mediaType), key);
    })();
    resolved.set(artifact.resource, promise);
    return promise;
  };
}

function taskOutcome(data, handle, pollIntervalMs) {
  const status = String(data.status);
  if (PENDING_STATUSES.includes(status)) {
    return wakeAfter(canonicalize(handle), pollIntervalMs, Date.now(), { phase: status });
  }
  if (status === "FAILED") {
    const reason = taskFailureReason(data.error);
    return failure(new MagnificServiceError("MAGNIFIC_TASK_FAILED",
      `Magnific task ${handle.taskId} failed${reason === undefined ? "" : `: ${reason}`}`));
  }
  if (status !== "COMPLETED") throw new EndpointResponseError(`Magnific task ${handle.taskId} reported unknown status ${status}`);
  const generated = Array.isArray(data.generated) ? data.generated : [];
  // A completed task without a result is a service contract violation, not a pending job.
  if (generated.length === 0) {
    return failure(new MagnificServiceError("MAGNIFIC_EMPTY_RESULT", `Magnific task ${handle.taskId} completed without a generated result`));
  }
  const urls = generated.map((url, index) => httpsUrl(url, `Magnific task ${handle.taskId} result ${index}`));
  return { status: "ready", handle: canonicalize({ ...handle, urls }) };
}

function routeFor(context) {
  const route = magnificRouteForCapability(context.need.capability);
  assert(route !== undefined, "Magnific does not implement this exact capability");
  return route;
}

function handleFor(context, route) {
  const handle = object(context.handle, "Magnific handle");
  assert(handle.contract === HANDLE_CONTRACT && handle.route === route.key && typeof handle.taskId === "string", "Magnific handle is invalid");
  return handle;
}

function endpoint(client, pollIntervalMs, operationTimeoutMs) {
  return {
    async start(context) {
      try {
        const route = routeFor(context);
        const request = route.prepare(context.need.constraints);
        const key = apiKey(context.credentials);
        await context.reportProgress?.({ phase: `Preparing Magnific request: ${request.submit}` });
        let body;
        try {
          body = await request.compile(resolverFor(client, context, key));
        } catch (error) {
          throw new MagnificServiceError(error instanceof EndpointServiceError ? error.code : "MAGNIFIC_ERROR",
            `Magnific request preparation failed; generation not submitted: ${errorMessage(error)}`);
        }
        await context.reportProgress?.({ phase: `Submitting Magnific request: ${request.submit}` });
        let data;
        try {
          data = client.task(await client.json(request.submit, key, { method: "POST", body: JSON.stringify(body) }), `Magnific POST ${request.submit}`);
        } catch (error) {
          if (error instanceof EndpointTransportError || error instanceof EndpointResponseError) {
            throw new MagnificServiceError("MAGNIFIC_SUBMISSION_UNKNOWN",
              `Magnific POST ${request.submit} outcome is unknown (${errorMessage(error)}); check the task list before submitting again`);
          }
          throw error;
        }
        const handle = { contract: HANDLE_CONTRACT, taskId: data.task_id, route: route.key, pollPath: request.poll, startedAt: Date.now() };
        const receipt = { id: handle.taskId };
        const ended = !PENDING_STATUSES.includes(String(data.status));
        await context.checkpoint?.({ handle: canonicalize(handle), receipt, ...(ended ? { remoteEnded: true } : {}) });
        return { ...taskOutcome(data, handle, pollIntervalMs), receipt };
      } catch (error) {
        return failure(error);
      }
    },

    async poll(context) {
      try {
        const handle = handleFor(context, routeFor(context));
        const receipt = { id: handle.taskId };
        if (Date.now() - handle.startedAt > operationTimeoutMs) {
          return { status: "failed", receipt, failure: { code: "MAGNIFIC_OPERATION_TIMEOUT",
            message: `Magnific task ${handle.taskId} exceeded operationTimeoutMs (${operationTimeoutMs}); its remote outcome is unknown` } };
        }
        const path = `${handle.pollPath}/${encodeURIComponent(handle.taskId)}`;
        const data = client.task(await client.json(path, apiKey(context.credentials)), `Magnific GET ${path}`);
        return { ...taskOutcome(data, handle, pollIntervalMs), receipt };
      } catch (error) {
        return pollAgainOrFail(error, { handle: context.handle, pollIntervalMs, failure });
      }
    },

    async collect(context) {
      try {
        const route = routeFor(context);
        const handle = handleFor(context, route);
        const urls = Array.isArray(handle.urls) ? handle.urls : [];
        assert(urls.length > 0, "Magnific handle carries no result");
        await context.reportProgress?.({ phase: `Receiving ${urls.length} generated ${route.media}${urls.length === 1 ? "" : "s"}` });
        const blobs = [];
        for (const url of urls) {
          const downloaded = await client.download(httpsUrl(url, "Magnific handle"), route.media);
          blobs.push(await context.resources.put(downloaded.bytes, downloaded.mediaType));
        }
        return { status: "completed", result: { value: route.packageResult(blobs) }, receipt: { id: handle.taskId } };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createMagnificProvider(options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const operationTimeoutMs = options.operationTimeoutMs ?? 60 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  for (const [name, value] of Object.entries({ requestTimeoutMs, operationTimeoutMs, pollIntervalMs })) {
    assert(Number.isSafeInteger(value) && value > 0, `Magnific ${name} must be a positive integer`);
  }
  const client = new MagnificClient(apiBaseUrl(options.baseUrl ?? magnificDefaultBaseUrl), requestTimeoutMs, options.fetch ?? globalThis.fetch);
  const instance = options.instance ?? "magnific.default";
  const asyncEndpoint = endpoint(client, pollIntervalMs, operationTimeoutMs);
  return defineEndpointPackage({
    module: magnificProviderModuleRef,
    facet: "gateway",
    instance,
    pool: options.pool ?? instance,
    pricing: { kind: "page", url: magnificPricingPage },
    credentials: { apiKey: options.apiKey ?? credentialRef("env", "MAGNIFIC_API_KEY") },
    credentialInputs: { apiKey: { label: "Magnific API key" } },
    defaultConcurrency: options.defaultConcurrency ?? 3,
    ...(options.actionLimits === undefined ? {} : { actionLimits: options.actionLimits }),
    capabilities: magnificRoutes.map((route) => ({
      capability: route.capability,
      returns: route.returns,
      lifecycle: "asynchronous",
      endpoint: asyncEndpoint,
      supports: route.supports,
    })),
  });
}

/**
 * `hypit doctor` check using free GETs only: the uploads listing confirms the key, and each task-list
 * route answers 200, or 404 "Task not found" when the account has no task on it yet.
 */
export async function diagnoseMagnificProvider(options, context) {
  const key = context.credentials.apiKey?.secret;
  if (typeof key !== "string" || key.length === 0) {
    return [{ severity: "error", code: "MAGNIFIC_CREDENTIAL_MISSING", message: "No Magnific API key resolved for this Endpoint" }];
  }
  const client = new MagnificClient(apiBaseUrl(options.baseUrl ?? magnificDefaultBaseUrl), options.requestTimeoutMs ?? 30_000, options.fetch ?? globalThis.fetch);
  try {
    await client.json("/v1/ai/uploads", key);
  } catch (error) {
    return [{ severity: "error", code: "MAGNIFIC_KEY_UNVERIFIED", message: `Magnific GET /v1/ai/uploads failed: ${redact(errorMessage(error))}` }];
  }
  const diagnostics = [{ severity: "info", code: "MAGNIFIC_KEY_ACCEPTED", message: "Magnific accepted the API key (GET /v1/ai/uploads)" }];
  const wanted = context.capabilities === undefined ? magnificRoutes
    : magnificRoutes.filter((route) => context.capabilities.some((capability) => capabilityKey(capability) === route.key));
  for (const path of new Set(wanted.flatMap((route) => route.listPaths))) {
    try {
      await client.json(path, key);
      diagnostics.push({ severity: "info", code: "MAGNIFIC_ROUTE_READY", message: `GET ${path} answered`, subject: path });
    } catch (error) {
      const noTasks = error instanceof MagnificHttpError && error.status === 404 && /task not found/iu.test(error.message);
      diagnostics.push(noTasks
        ? { severity: "info", code: "MAGNIFIC_ROUTE_READY", message: `GET ${path} exists (no tasks yet)`, subject: path }
        : { severity: "error", code: "MAGNIFIC_ROUTE_UNAVAILABLE", message: redact(errorMessage(error)), subject: path });
    }
  }
  return diagnostics;
}
