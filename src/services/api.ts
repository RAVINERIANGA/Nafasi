import type { ConnectivityMode } from "@/domain/types";

export class ApiClientError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class OfflineError extends Error {
  constructor() {
    super("This device is offline. The action is queued and has not been sent.");
    this.name = "OfflineError";
  }
}

let connectivity: ConnectivityMode = "online";
let token = "";

export function setApiSession(nextToken: string, mode: ConnectivityMode) {
  token = nextToken;
  connectivity = mode;
}

export function deviceInfo() {
  if (typeof window === "undefined") return { id: "server", label: "Server" };
  const key = "nafasi-device";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  const label = /Mobi|Android/i.test(navigator.userAgent) ? "Mobile browser" : "Desktop browser";
  return { id, label };
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; pinToken?: string } = {}): Promise<T> {
  if (connectivity === "offline") throw new OfflineError();
  const device = deviceInfo();
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-device-id": device.id,
        "x-device-label": device.label,
        "x-device-time": new Date().toISOString(),
        "x-connectivity": connectivity,
        ...(options.pinToken ? { "x-pin-token": options.pinToken } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new OfflineError();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = data.error ?? {};
    throw new ApiClientError(response.status, error.code ?? "SERVER", error.message ?? "The simulated server rejected that action.");
  }
  return data as T;
}
