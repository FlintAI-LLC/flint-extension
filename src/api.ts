import type {
  ExtensionLoginResponse,
  SaveJDRequest,
  SaveJDResponse,
} from "./types.js";
import { clearAuth } from "./storage.js";
import { getApiBaseUrl } from "./urls.js";

const API_BASE = getApiBaseUrl();

// Contract: a 401 on an authenticated route clears stored auth and throws
// AuthError. Login failures return ApiError(401) so the popup can show
// "invalid credentials" instead of "session expired".

const REQUEST_TIMEOUT_MS = 6000;

function messageForSession401(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      detail?: { code?: string } | string;
    };
    const detail = parsed.detail;
    if (typeof detail === "object" && detail?.code) {
      switch (detail.code) {
        case "session_replaced":
          return "You signed in elsewhere — please log in again.";
        case "refresh_token_reuse":
        case "refresh_token_expired":
        case "refresh_token_invalid":
          return "Session expired — please log in again.";
        default:
          break;
      }
    }
  } catch {
    // ignore parse errors
  }
  return "Session expired — please log in again.";
}

async function request<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, `Request to ${path} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text().catch(() => "");

  if (response.status === 401) {
    if (path === "/api/auth/extension/login") {
      throw new ApiError(401, body || "Unauthorized");
    }
    await clearAuth();
    throw new AuthError(messageForSession401(body));
  }

  if (!response.ok) {
    throw new ApiError(response.status, body);
  }

  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<ExtensionLoginResponse> {
  return request<ExtensionLoginResponse>("/api/auth/extension/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function apiRefresh(
  refreshToken: string,
): Promise<ExtensionLoginResponse> {
  return request<ExtensionLoginResponse>("/api/auth/extension/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function apiGoogleCallback(
  code: string,
  redirectUri: string,
): Promise<ExtensionLoginResponse> {
  return request<ExtensionLoginResponse>("/api/auth/extension/callback", {
    method: "POST",
    body: JSON.stringify({ provider: "google", code, redirect_uri: redirectUri }),
  });
}

export async function apiSaveJD(
  payload: SaveJDRequest,
  accessToken: string,
): Promise<SaveJDResponse> {
  return request<SaveJDResponse>("/api/job-descriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
}
