import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/** argon2id (the library default) with its default cost. */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummy: Promise<string> | undefined;

/**
 * Checks a password against a stored hash. With no stored hash (unknown user)
 * it still does a full argon2 verification against a throwaway hash, so a
 * login miss costs about the same as a wrong password.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    dummy ??= hash("not-a-real-password-for-timing");
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(storedHash, password).catch(() => false);
}

export type PasswordProblem = "password_too_short" | "password_too_long";

export function checkPassword(password: unknown): PasswordProblem | null {
  if (typeof password !== "string") return "password_too_short";
  if (password.length < MIN_PASSWORD_LENGTH) return "password_too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "password_too_long";
  return null;
}
