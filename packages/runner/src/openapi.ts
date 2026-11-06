/**
 * The openapi adapter: call one upstream HTTP endpoint and return its JSON.
 *
 * The job input is the request body, or the value of `bodyField` when that is
 * set. The request is aborted at the same time ceiling the parent enforces,
 * and a response that is not 2xx is a failed delivery.
 */

export interface OpenApiSpec {
  adapter: "openapi";
  url: string;
  method: string;
  headers?: Record<string, string>;
  bodyField?: string;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FAILURE_LIMIT = 500;

/** Call the upstream endpoint and return the parsed JSON body. */
export async function runOpenApi(spec: OpenApiSpec, input: unknown, timeoutMs: number): Promise<unknown> {
  const url = upstreamUrl(spec.url);
  const method = upstreamMethod(spec.method);
  const headers = requestHeaders(spec.headers);
  const body = requestBody(spec, input);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeout(error)) throw new Error("Refused. The upstream request timed out.");
    throw new Error(cut(`Refused. The upstream request failed. ${oneLine(messageOf(error))}`));
  }

  if (!response.ok) {
    const detail = oneLine(await response.text());
    const reason = detail
      ? `Refused. The upstream responded with ${response.status}. ${detail}`
      : `Refused. The upstream responded with ${response.status}.`;
    throw new Error(cut(reason));
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Refused. The upstream response was not JSON.");
  }
}

function upstreamUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Refused. The upstream URL is malformed.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Refused. The upstream URL must be http or https.");
  }
  return url.toString();
}

function upstreamMethod(value: string): string {
  const method = value.toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("Refused. The upstream method is malformed.");
  return method;
}

function requestHeaders(headers: Record<string, string> | undefined): Headers {
  const request = new Headers();
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!HEADER_NAME.test(name) || /[\r\n]/.test(value)) {
      throw new Error("Refused. An upstream header is malformed.");
    }
    request.set(name, value);
  }
  if (!request.has("accept")) request.set("accept", "application/json");
  request.set("content-type", "application/json");
  return request;
}

function requestBody(spec: OpenApiSpec, input: unknown): string {
  const payload = spec.bodyField === undefined ? input : { [spec.bodyField]: input };
  try {
    const encoded = JSON.stringify(payload);
    if (typeof encoded !== "string") throw new Error("Refused. The input cannot be sent as JSON.");
    return encoded;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refused.")) throw error;
    throw new Error("Refused. The input cannot be sent as JSON.");
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timed out|timeout/i.test(error.message));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function cut(text: string): string {
  const line = oneLine(text);
  return line.length > FAILURE_LIMIT ? line.slice(0, FAILURE_LIMIT) : line;
}
