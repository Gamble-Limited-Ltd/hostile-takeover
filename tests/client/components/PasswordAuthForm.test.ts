import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("../../../src/client/PasswordAuthApi", async (orig) => ({
  ...(await orig<typeof import("../../../src/client/PasswordAuthApi")>()),
  loginWithPassword: vi.fn(),
  registerAccount: vi.fn(),
  resetPassword: vi.fn(),
}));

import "../../../src/client/components/account/PasswordAuthForm";
import type { PasswordAuthForm } from "../../../src/client/components/account/PasswordAuthForm";
import {
  loginWithPassword,
  registerAccount,
  resetPassword,
} from "../../../src/client/PasswordAuthApi";

let form: PasswordAuthForm;

async function mount(resetToken = ""): Promise<PasswordAuthForm> {
  form = document.createElement("password-auth-form") as PasswordAuthForm;
  form.resetToken = resetToken;
  document.body.appendChild(form);
  await form.updateComplete;
  return form;
}

function type(name: string, value: string) {
  const el = form.querySelector(`input[name="${name}"]`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input"));
}

async function submit() {
  form
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }));
  await vi.waitFor(() => expect(form.querySelector("[disabled]")).toBeNull());
  await form.updateComplete;
}

afterEach(() => {
  form?.remove();
  vi.clearAllMocks();
});

describe("password-auth-form", () => {
  it("signs in and fires auth-success", async () => {
    vi.mocked(loginWithPassword).mockResolvedValue({ ok: true });
    await mount();
    const onSuccess = vi.fn();
    form.addEventListener("auth-success", onSuccess);
    type("usernameOrEmail", "tester1");
    type("password", "hunter2hunter2");
    await submit();
    expect(loginWithPassword).toHaveBeenCalledWith("tester1", "hunter2hunter2");
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("shows one generic message for a 401", async () => {
    vi.mocked(loginWithPassword).mockResolvedValue({
      ok: false,
      status: 401,
      code: "invalid_credentials",
    });
    await mount();
    type("usernameOrEmail", "x");
    type("password", "y");
    await submit();
    expect(form.textContent).toContain(
      "password_auth.error_invalid_credentials",
    );
  });

  it("shows the rate-limit message on 429", async () => {
    vi.mocked(loginWithPassword).mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limited",
    });
    await mount();
    type("usernameOrEmail", "x");
    type("password", "y");
    await submit();
    expect(form.textContent).toContain("password_auth.error_rate_limited");
  });

  it("blocks a bad sign-up client-side with per-field errors", async () => {
    await mount();
    (form.querySelector("button[type=button]") as HTMLButtonElement).click();
    await form.updateComplete;
    type("email", "a@gmail.com");
    await submit();
    expect(registerAccount).not.toHaveBeenCalled();
    expect(form.textContent).toContain("password_auth.error_email_domain");
    expect(form.textContent).toContain("password_auth.error_age");
  });

  it("puts a server error next to its field", async () => {
    vi.mocked(registerAccount).mockResolvedValue({
      ok: false,
      status: 409,
      code: "username_taken",
    });
    await mount();
    (form.querySelector("button[type=button]") as HTMLButtonElement).click();
    await form.updateComplete;
    type("firstName", "A");
    type("lastName", "B");
    type("email", "a@kmlhs.org");
    type("username", "taken");
    type("password", "0123456789");
    (form.querySelector('input[name="age"]') as HTMLInputElement).click();
    await submit();
    expect(registerAccount).toHaveBeenCalled();
    expect(form.textContent).toContain("password_auth.error_username_taken");
  });

  it("opens in reset mode and returns to sign in after success", async () => {
    vi.mocked(resetPassword).mockResolvedValue({ ok: true });
    await mount("t".repeat(43));
    expect(form.textContent).toContain("password_auth.reset_title");
    const onDone = vi.fn();
    form.addEventListener("reset-done", onDone);
    type("password", "0123456789");
    await submit();
    expect(resetPassword).toHaveBeenCalledWith("t".repeat(43), "0123456789");
    expect(onDone).toHaveBeenCalledOnce();
    expect(form.textContent).toContain("password_auth.reset_success");
    expect(form.querySelector('input[name="usernameOrEmail"]')).not.toBeNull();
  });

  it("explains an invalid reset token", async () => {
    vi.mocked(resetPassword).mockResolvedValue({
      ok: false,
      status: 400,
      code: "invalid_token",
    });
    await mount("t".repeat(43));
    type("password", "0123456789");
    await submit();
    expect(form.textContent).toContain(
      "password_auth.error_reset_invalid_token",
    );
  });
});
