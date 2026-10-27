import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";

// Fork-only (S6): root moderation calls, same Bearer-JWT pattern as
// createResetLink in PasswordAuthApi.ts. The API is the authority.

export type AdminResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string };

export interface SiteStatusBody {
  banner: string | null;
  maintenance: boolean;
}

export interface ChatReport {
  id: string;
  gameId: string;
  reporter: string | null;
  target: string | null;
  message: string;
  createdAt: string;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<AdminResult<T>> {
  const authorization = await getAuthHeader();
  if (!authorization) return { ok: false, status: 401, code: "unauthorized" };
  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    console.warn(`${path} request failed`, e);
    return { ok: false, status: 0, code: "network" };
  }
  const parsed = (await response.json().catch(() => null)) as
    | (T & { error?: unknown })
    | null;
  if (!response.ok) {
    const code =
      typeof parsed?.error === "string" ? parsed.error : "unknown_error";
    return { ok: false, status: response.status, code };
  }
  return { ok: true, data: parsed as T };
}

const user = (username: string) =>
  `/admin/users/${encodeURIComponent(username.trim())}`;

export const banUser = (
  username: string,
  minutes: number | null,
  reason: string | null,
) => call("POST", `${user(username)}/ban`, { minutes, reason });

export const unbanUser = (username: string) =>
  call("POST", `${user(username)}/unban`);

export const muteUser = (username: string, minutes: number, shadow: boolean) =>
  call("POST", `${user(username)}/mute`, { minutes, shadow });

export const unmuteUser = (username: string) =>
  call("POST", `${user(username)}/unmute`);

export const getSiteStatus = () =>
  call<SiteStatusBody>("GET", "/admin/site-status");

export const putSiteStatus = (status: SiteStatusBody) =>
  call<SiteStatusBody>("PUT", "/admin/site-status", status);

export const listChatReports = () =>
  call<{ reports: ChatReport[] }>("GET", "/admin/chat-reports");

export const deleteChatReport = (id: string) =>
  call("DELETE", `/admin/chat-reports/${encodeURIComponent(id)}`);

export const markGameUnranked = (gameId: string) =>
  call(
    "POST",
    `/admin/games/${encodeURIComponent(gameId.trim())}/unranked`,
    {},
  );
