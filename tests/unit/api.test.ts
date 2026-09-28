import { afterEach, describe, expect, it, vi } from "vitest";
import { apiLogin, apiOAuthCallback, ApiError, AuthError } from "../../src/api.js";

describe("apiLogin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws ApiError with invalid_credentials body instead of AuthError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 401,
        ok: false,
        text: async () => JSON.stringify({ detail: { code: "invalid_credentials" } }),
      }),
    );

    await expect(apiLogin("a@b.com", "wrong")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).not.toBeInstanceOf(AuthError);
      expect((err as ApiError).status).toBe(401);
      return true;
    });
  });
});

describe("apiOAuthCallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts { provider, code, redirect_uri } to the shared callback route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: "a",
          refresh_token: "r",
          expires_in: 900,
          user: { id: "u1", email: "a@b.com", display_name: "A" },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiOAuthCallback(
      "github",
      "the-code",
      "https://example.com/auth/extension/github/callback",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/extension/callback");
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "github",
      code: "the-code",
      redirect_uri: "https://example.com/auth/extension/github/callback",
    });
  });
});
