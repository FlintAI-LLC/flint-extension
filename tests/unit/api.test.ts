import { afterEach, describe, expect, it, vi } from "vitest";
import { apiLogin, ApiError, AuthError } from "../../src/api.js";

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
