import { EndpointHttpError, EndpointServiceError, retryAfterMs } from "@hypit/hypit/endpoint-kit";

/** Responses can quote signed asset URLs; keep the reason, not its access capability. */
export function redact(text) {
  return text.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

export class MagnificServiceError extends EndpointServiceError {}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function text(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Magnific errors are `{ message }`, or problem+json `{ message, invalid_params: [{ field, reason }] }`. */
function reasonFrom(body) {
  const problem = record(body.problem) ?? body;
  const message = text(problem.message) ?? text(body.message);
  const params = Array.isArray(problem.invalid_params) ? problem.invalid_params : [];
  const details = params.map((param) => record(param))
    .filter((param) => param !== undefined)
    .map((param) => [text(param.field) ?? text(param.name), text(param.reason)].filter(Boolean).join(": "))
    .filter((detail) => detail.length > 0);
  return [message, ...details].filter(Boolean).join("; ") || undefined;
}

export class MagnificHttpError extends EndpointHttpError {
  constructor(status, headers, bodyText, request) {
    let body;
    try { body = record(JSON.parse(bodyText)); } catch { /* Gateway pages still keep the HTTP evidence. */ }
    const reason = body === undefined ? text(bodyText.slice(0, 500)) : reasonFrom(body);
    const requestId = text(headers.get("x-request-id"));
    const facts = [`Magnific HTTP ${status}`, `${request.method} ${request.path}`, ...(requestId === undefined ? [] : [`request=${requestId}`])];
    super("MAGNIFIC_HTTP_ERROR", `${facts.join("; ")}${reason === undefined ? "" : `: ${redact(reason)}`}`, status, retryAfterMs(headers));
  }
}

/** A FAILED task's `error` may be a string or an object; both are kept as public evidence. */
export function taskFailureReason(error) {
  if (text(error) !== undefined) return redact(text(error));
  const object = record(error);
  if (object === undefined) return undefined;
  const reason = [text(object.code), text(object.message) ?? text(object.reason)].filter(Boolean).join(": ");
  return reason.length > 0 ? redact(reason) : undefined;
}
