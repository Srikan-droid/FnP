/**
 * The one way the app talks to the backend. Requests go to the same origin (/api), carry the
 * session cookie, and send Django's CSRF token on every change.
 */

export class ApiError extends Error {
  readonly status: number;
  /** The backend's error body: { detail } or a field -> message map. */
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.detail === "string" ? body.detail : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }

  /** The machine-readable reason a refusal carries, if any ("held_by_other", "lock_held"). */
  get code(): string | undefined {
    return typeof this.body.code === "string" ? this.body.code : undefined;
  }

  /** The message for one field, as the backend validated it. */
  field(name: string): string | undefined {
    const value = this.body[name];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return undefined;
  }
}

/** Why a change was not saved, in words for the person who made it. */
export function refusalMessage(error: unknown, field: string): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.field(field) ?? error.message;
    // Not allowed: the server says why (a reviewer's own application, say).
    if (error.status === 403) return error.message;
    // Another admin is reviewing it: the server names them.
    if (error.status === 409 && error.code === "held_by_other") return error.message;
    if (error.status === 409) return "The case changed in the meantime and has been refreshed. Cancel, then review it again.";
  }
  return "Not saved. Check your connection and try again.";
}

function csrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1] ?? "";
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * A request that still goes out while the page is closing (a lock given back as the editor is
 * left, say). Nothing waits for, or reads, its answer.
 */
export function sendOnLeave(method: Method, path: string): void {
  try {
    void fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      keepalive: true,
      headers: { Accept: "application/json", "X-CSRFToken": csrfToken() },
    }).catch(() => undefined);
  } catch {
    // The browser refused: the lock lapses by itself.
  }
}

/**
 * API responses can be written to the browser console, one collapsed group per call, to see what
 * the backend returned. They hold personal data, so this is on only while developing (npm run dev)
 * or in a build made with VITE_API_LOG=true. In any browser it can be switched for that browser
 * from its console: localStorage.fnpApiLog = "true" (or "false"), then reload.
 */
const API_LOG_ON: boolean = (() => {
  try {
    const choice = localStorage.getItem("fnpApiLog");
    if (choice !== null) return choice === "true";
  } catch {
    // Storage blocked: the build's setting.
  }
  return import.meta.env.DEV || import.meta.env.VITE_API_LOG === "true";
})();

function logResponse(method: Method, path: string, status: number | string, started: number, data?: unknown) {
  if (!API_LOG_ON) return;
  const ok = typeof status === "number" && status < 400;
  const label = `[API] ${method} /api${path} → ${status} (${Math.round(performance.now() - started)} ms)`;
  console.groupCollapsed(`%c${label}`, `color: ${ok ? "#1c7c3a" : "#c0392b"}`);
  if (data !== undefined) console.log(data);
  console.groupEnd();
}

/** The headers every request sends: JSON wanted back, and the CSRF token on a change. */
function requestHeaders(method: Method, json: boolean): Record<string, string> {
  return {
    Accept: "application/json",
    ...(method === "GET" ? {} : { "X-CSRFToken": csrfToken() }),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

/**
 * What a response comes to, however it was fetched: logged, then its data, or an ApiError with the
 * backend's error body. A 204 has no data.
 */
function settle<T>(method: Method, path: string, status: number, started: number, data: unknown): T {
  if (status === 204) {
    logResponse(method, path, 204, started);
    return undefined as T;
  }
  logResponse(method, path, status, started, data);
  if (status < 200 || status >= 300) throw new ApiError(status, (data ?? {}) as Record<string, unknown>);
  return data as T;
}

export async function api<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: requestHeaders(method, body !== undefined && !isForm),
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (error) {
    logResponse(method, path, "network error", started, error);
    throw error;
  }
  const data = response.status === 204 ? undefined : await response.json().catch(() => ({}));
  return settle<T>(method, path, response.status, started, data);
}

/**
 * Uploads one file (multipart field "file") as api() would, reporting how much of it has been sent
 * (0 to 1). XMLHttpRequest rather than fetch: only it reports an upload's progress.
 */
export function uploadWithProgress<T>(path: string, file: File, onProgress?: (share: number) => void): Promise<T> {
  const started = performance.now();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(requestHeaders("POST", false))) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    // Failed, cut off, or timed out: each settles the upload as a network error, so nothing waits
    // on it for ever.
    const failed = (what: string) => () => {
      const error = new TypeError(`Network error (${what})`);
      logResponse("POST", path, "network error", started, error);
      reject(error);
    };
    xhr.onerror = failed("failed");
    xhr.onabort = failed("aborted");
    xhr.ontimeout = failed("timed out");
    xhr.onload = () => {
      let data: unknown;
      try {
        data = xhr.status === 204 ? undefined : xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }
      try {
        const result = settle<T>("POST", path, xhr.status, started, data);
        onProgress?.(1);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
}
