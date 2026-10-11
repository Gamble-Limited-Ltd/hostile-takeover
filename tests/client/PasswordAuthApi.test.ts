import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "http://api.test",
}));

const { getAuthHeader } = vi.hoisted(() => ({ getAuthHeader: vi.fn() }));
vi.mock("../../src/client/Auth", () => ({ getAuthHeader }));

import en from "../../resources/lang/en.json";
import {
  changePassword,
  changePasswordErrorKey,
  loginErrorKey,
  loginWithPassword,
  registerAccount,
  registerErrorTarget,
  resetErrorKey,
  resetPassword,
  validateNewPassword,
  validateRegisterFields,
} from "../../src/client/PasswordAuthApi";
import {
  parseResetHash,
  stashResetToken,
  takeResetToken,
} from "../../src/client/PasswordResetHash";

const TOKEN = "a".repeat(43);

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("PasswordAuthApi", () => {
  it("posts login with credentials included", async () => {
    const f = mockFetch(200, { ok: true });
    expect(await loginWithPassword("tester1", "pw")).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/auth/login");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      usernameOrEmail: "tester1",
      password: "pw",
    });
  });

  it("returns the API error code", async () => {
    mockFetch(401, { error: "invalid_credentials" });
    expect(await loginWithPassword("a", "b")).toEqual({
      ok: false,
      status: 401,
      code: "invalid_credentials",
    });
  });

  it("maps a bare 429 to rate_limited and a failed fetch to network", async () => {
    mockFetch(429, null);
    expect((await registerAccount({} as never)).ok).toBe(false);
    expect(await registerAccount({} as never)).toMatchObject({
      code: "rate_limited",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resetPassword(TOKEN, "x")).toMatchObject({ code: "network" });
  });

  it("maps every register error code to a field", () => {
    const fields: Record<string, string> = {
      first_name_invalid: "firstName",
      last_name_invalid: "lastName",
      email_domain: "email",
      email_taken: "email",
      username_invalid: "username",
      username_censored: "username",
      username_taken: "username",
      password_too_short: "password",
      password_too_long: "password",
      age_unconfirmed: "age",
      rate_limited: "form",
      invalid_request: "form",
    };
    for (const [code, field] of Object.entries(fields)) {
      expect(registerErrorTarget(code).field).toBe(field);
    }
    expect(registerErrorTarget("nope").key).toBe("password_auth.error_generic");
  });

  it("maps login and reset errors", () => {
    expect(loginErrorKey("invalid_credentials")).toBe(
      "password_auth.error_invalid_credentials",
    );
    expect(loginErrorKey("rate_limited")).toBe(
      "password_auth.error_rate_limited",
    );
    expect(resetErrorKey("invalid_token")).toBe(
      "password_auth.error_reset_invalid_token",
    );
    expect(resetErrorKey("password_too_short")).toBe(
      "password_auth.error_password_short",
    );
  });

  it("mirrors the API checks client-side", () => {
    const ok = {
      firstName: "A",
      lastName: "B",
      email: "a.b@kmlhs.org",
      username: "abc",
      password: "0123456789",
      ageConfirmed: true,
    };
    expect(validateRegisterFields(ok)).toEqual({});
    expect(
      Object.keys(
        validateRegisterFields({
          ...ok,
          firstName: " ",
          email: "a@gmail.com",
          username: "a!",
          password: "short",
          ageConfirmed: false,
        }),
      ).sort(),
    ).toEqual(["age", "email", "firstName", "password", "username"]);
    expect(validateNewPassword("short")).toBe(
      "password_auth.error_password_short",
    );
    expect(validateNewPassword("0123456789")).toBeNull();
  });
});

describe("PasswordResetHash", () => {
  it("reads the token from a #reset= hash", () => {
    expect(parseResetHash(`#reset=${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores other hashes and malformed tokens", () => {
    expect(parseResetHash("")).toBeNull();
    expect(parseResetHash("#modal=account")).toBeNull();
    expect(parseResetHash("#reset=")).toBeNull();
    expect(parseResetHash("#reset=<script>")).toBeNull();
  });

  it("hands the stashed token over once", () => {
    stashResetToken(TOKEN);
    expect(takeResetToken()).toBe(TOKEN);
    expect(takeResetToken()).toBeNull();
  });
});

describe("changePassword", () => {
  it("PATCHes with the Bearer JWT and the session cookie", async () => {
    getAuthHeader.mockResolvedValue("Bearer jwt-1");
    const f = mockFetch(200, { ok: true });
    expect(await changePassword("old-password-1", "new-password-1")).toEqual({
      ok: true,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/users/@me/password");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt-1",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      currentPassword: "old-password-1",
      newPassword: "new-password-1",
    });
  });

  it("does not call the API when there is no session", async () => {
    getAuthHeader.mockResolvedValue("");
    const f = mockFetch(200, { ok: true });
    expect(await changePassword("a", "b")).toEqual({
      ok: false,
      status: 401,
      code: "unauthorized",
    });
    expect(f).not.toHaveBeenCalled();
  });

  it("returns the API error code", async () => {
    getAuthHeader.mockResolvedValue("Bearer jwt-1");
    mockFetch(403, { error: "wrong_password" });
    expect(await changePassword("x", "y")).toEqual({
      ok: false,
      status: 403,
      code: "wrong_password",
    });
  });

  it("maps every code to an en.json key", () => {
    const keys = [
      "wrong_password",
      "password_too_short",
      "password_too_long",
      "unauthorized",
      "rate_limited",
      "network",
      "whatever",
    ].map(changePasswordErrorKey);
    expect(keys[0]).toBe("password_auth.error_wrong_password");
    expect(keys[3]).toBe("password_auth.error_signed_out");
    expect(keys[6]).toBe("password_auth.error_generic");
    for (const k of keys) {
      expect(
        (en.password_auth as Record<string, string>)[k.split(".")[1]],
      ).toBeTruthy();
    }
  });
});
