// Hostile Takeover: outbound links shown in the footer and on the loading
// screen. Links only: no shared code, no API calls, no data.

export const UPSTREAM_SOURCE_URL = "https://github.com/openfrontio/openfrontio";
export const FORK_SOURCE_URL =
  "https://github.com/Gamble-Limited-Ltd/hostile-takeover";
export const COMPANY_SITE_URL = "https://gll.taps-holdings.org";
export const GAMBLE_LIMITED_URL = "https://icantstopwinning.taps-holdings.org";

/** An http(s) URL, or "" for anything else (unset, blank, or a script URL). */
export function safeHttpUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : "";
  } catch {
    return "";
  }
}

/** The Meridian link: hidden ("") unless the build set MERIDIAN_URL. */
export function meridianUrl(): string {
  return safeHttpUrl(process.env.MERIDIAN_URL);
}
