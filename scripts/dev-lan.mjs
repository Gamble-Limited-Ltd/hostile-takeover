// `npm run dev:lan`: the dev:all stack reachable from other devices on the LAN.
// Settings are inline (never in .env, which leaks into Vitest). Override the
// detected address with LAN_HOST=<ip>.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

function detectLanIp() {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|lo)/.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

const host = process.env.LAN_HOST || detectLanIp();
if (!host) {
  console.error("No LAN address found; set LAN_HOST=<ip>.");
  process.exit(1);
}
const vitePort = process.env.VITE_PORT || "5178";
const apiPort = process.env.API_PORT || "8787";
const gameOrigin = `http://${host}:${vitePort}`;

console.log(`\nLAN dev mode: open ${gameOrigin} from another device.`);
console.log(
  `API ${`http://${host}:${apiPort}`} (/dev/login stays loopback-only)\n`,
);

const child = spawn("npm", ["run", "dev:all"], {
  stdio: "inherit",
  detached: true,
  env: {
    ...process.env,
    VITE_HOST: "lan",
    API_HOST: "0.0.0.0",
    API_URL: `http://${host}:${apiPort}`,
    EXTRA_GAME_ORIGINS: gameOrigin,
    SKIP_BROWSER_OPEN: "true",
  },
});
const stop = (sig) => {
  try {
    process.kill(-child.pid, sig);
  } catch {
    // already gone
  }
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stop(sig));
child.on("exit", (code) => process.exit(code ?? 0));
