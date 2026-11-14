import {
  pairFor,
  requestHost,
  wayfinderHosts,
} from "@openfront/shared/Wayfinder";
import type { Express, Request, Response } from "express";

// HALL launch (Wayfinder): HALL redirects here with the ticket in the URL
// fragment (never sent to a server). This page's external script reads it,
// clears it from the address bar, and posts it to the API, which signs the
// player in. The script is a separate file because the CSP blocks inline script.

const HALL_URL = "https://hall.taps-holdings.org/";

const SCRIPT = `(function () {
  var meta = document.querySelector('meta[name="api-origin"]');
  var api = meta && meta.content;
  var ticket = new URLSearchParams(location.hash.slice(1)).get("ticket");
  history.replaceState(null, "", location.pathname);
  function fail() {
    document.getElementById("msg").textContent = "Could not sign you in.";
    document.getElementById("back").hidden = false;
  }
  if (!ticket || !api) return fail();
  fetch(api + "/auth/launch", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: ticket }),
  })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (j) {
      if (!/^gate=(ok|link)$/.test(j.hash)) return fail();
      location.replace("/#" + j.hash);
    })
    .catch(fail);
})();
`;

function page(apiOrigin: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="api-origin" content="${apiOrigin}">
<title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;text-align:center;padding-top:20vh">
<p id="msg">Signing you in...</p>
<p id="back" hidden><a style="color:#9cf" href="${HALL_URL}">Back to HALL</a></p>
<script src="/auth/launch.js"></script>
</body></html>
`;
}

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/** Only answers in Wayfinder mode; with no host table both routes are 404. */
export function mountLaunch(app: Express): void {
  app.get("/auth/launch", (req: Request, res: Response) => {
    if (!wayfinderHosts()) return void res.sendStatus(404);
    const pair = pairFor(requestHost(req.headers, req.socket.remoteAddress))!;
    noStore(res);
    res.type("html").send(page(`https://${pair.htapi}`));
  });
  app.get("/auth/launch.js", (_req: Request, res: Response) => {
    if (!wayfinderHosts()) return void res.sendStatus(404);
    noStore(res);
    res.type("application/javascript").send(SCRIPT);
  });
}
