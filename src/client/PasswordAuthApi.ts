import { getApiBase } from "./ApiBase";

// Client for the account routes in packages/api/src/accountRoutes.ts. Every
// call resolves (never throws) with the API's stable error code.

export type PasswordAuthResult =
  | { ok: true }
  | { ok: false; status: number; code: string };

export interface RegisterFields {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  password: string;
  ageConfirmed: boolean;
}

async function post(
  path: string,
  body: Record<string, unknown>,
): Promise<PasswordAuthResult> {
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn(`${path} request failed`, e);
    return { ok: false, status: 0, code: "network" };
  }
  if (response.ok) return { ok: true };
  const parsed = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const code =
    typeof parsed?.error === "string"
      ? parsed.error
      : response.status === 429
        ? "rate_limited"
        : "unknown";
  return { ok: false, status: response.status, code };
}

export function loginWithPassword(
  usernameOrEmail: string,
  password: string,
): Promise<PasswordAuthResult> {
  return post("/auth/login", { usernameOrEmail, password });
}

export function registerAccount(
  fields: RegisterFields,
): Promise<PasswordAuthResult> {
  return post("/auth/register", { ...fields });
}

export function resetPassword(
  token: string,
  newPassword: string,
): Promise<PasswordAuthResult> {
  return post("/auth/reset", { token, newPassword });
}

export type RegisterField =
  | "firstName"
  | "lastName"
  | "email"
  | "username"
  | "password"
  | "age";

export interface ErrorTarget {
  /** The field the message sits under; "form" shows it above the button. */
  field: RegisterField | "form";
  /** en.json key. */
  key: string;
}

const REGISTER_TARGETS: Record<string, ErrorTarget> = {
  first_name_invalid: {
    field: "firstName",
    key: "password_auth.error_first_name",
  },
  last_name_invalid: {
    field: "lastName",
    key: "password_auth.error_last_name",
  },
  email_domain: { field: "email", key: "password_auth.error_email_domain" },
  email_taken: { field: "email", key: "password_auth.error_email_taken" },
  username_invalid: { field: "username", key: "password_auth.error_username" },
  username_censored: {
    field: "username",
    key: "password_auth.error_username_censored",
  },
  username_taken: {
    field: "username",
    key: "password_auth.error_username_taken",
  },
  password_too_short: {
    field: "password",
    key: "password_auth.error_password_short",
  },
  password_too_long: {
    field: "password",
    key: "password_auth.error_password_long",
  },
  age_unconfirmed: { field: "age", key: "password_auth.error_age" },
  rate_limited: { field: "form", key: "password_auth.error_rate_limited" },
  network: { field: "form", key: "password_auth.error_network" },
};

export function registerErrorTarget(code: string): ErrorTarget {
  return (
    REGISTER_TARGETS[code] ?? {
      field: "form",
      key: "password_auth.error_generic",
    }
  );
}

export function loginErrorKey(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "password_auth.error_invalid_credentials";
    case "rate_limited":
      return "password_auth.error_rate_limited";
    case "network":
      return "password_auth.error_network";
    default:
      return "password_auth.error_generic";
  }
}

export function resetErrorKey(code: string): string {
  switch (code) {
    case "invalid_token":
      return "password_auth.error_reset_invalid_token";
    case "password_too_short":
      return "password_auth.error_password_short";
    case "password_too_long":
      return "password_auth.error_password_long";
    case "rate_limited":
      return "password_auth.error_rate_limited";
    case "network":
      return "password_auth.error_network";
    default:
      return "password_auth.error_generic";
  }
}

// Client-side checks mirror validateRegister in packages/api; the server is
// the authority. Returns the first problem per field.
const EMAIL_RE = /^[^@\s]+@kmlhs\.org$/i;
const USERNAME_RE = /^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/;

export function validateRegisterFields(
  f: RegisterFields,
): Partial<Record<RegisterField, string>> {
  const errors: Partial<Record<RegisterField, string>> = {};
  const first = f.firstName.trim();
  const last = f.lastName.trim();
  const email = f.email.trim();
  const username = f.username.trim();
  if (first.length < 1 || first.length > 50)
    errors.firstName = "password_auth.error_first_name";
  if (last.length < 1 || last.length > 50)
    errors.lastName = "password_auth.error_last_name";
  if (email.length > 254 || !EMAIL_RE.test(email))
    errors.email = "password_auth.error_email_domain";
  if (
    username.length < 3 ||
    username.length > 20 ||
    !USERNAME_RE.test(username)
  )
    errors.username = "password_auth.error_username";
  if (f.password.length < 10)
    errors.password = "password_auth.error_password_short";
  else if (f.password.length > 128)
    errors.password = "password_auth.error_password_long";
  if (!f.ageConfirmed) errors.age = "password_auth.error_age";
  return errors;
}

/** Same bounds as the API's checkPassword, for the reset form. */
export function validateNewPassword(password: string): string | null {
  if (password.length < 10) return "password_auth.error_password_short";
  if (password.length > 128) return "password_auth.error_password_long";
  return null;
}
