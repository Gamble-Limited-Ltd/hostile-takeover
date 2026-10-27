import {
  AdminLiveGamesSchema,
  type AdminLiveGame,
} from "@openfront/shared/HtAdminSchemas";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getAuthHeader, userAuth } from "../../Auth";
import { ClientEnv } from "../../ClientEnv";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

/**
 * Live games card for the signed-in account panel: root only. Lists every
 * started game, public or private (each worker only knows its own, so all are asked and
 * merged) with a Spectate button that opens the normal `?spectate` join.
 * Hiding the card for other roles is cosmetic; the endpoint checks.
 */
@customElement("admin-live-games-card")
export class AdminLiveGamesCard extends LitElement {
  @state() private isRoot = false;
  @state() private busy = false;
  @state() private error = false;
  @state() private games: AdminLiveGame[] = [];

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.checkRole();
  }

  private async checkRole(): Promise<void> {
    const auth = await userAuth();
    this.isRoot = auth !== false && auth.claims.role === "root";
    if (this.isRoot) await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = false;
    try {
      const headers = { Authorization: await getAuthHeader() };
      const base = ClientEnv.serverHttpBase();
      const lists = await Promise.all(
        Array.from({ length: ClientEnv.numWorkers() }, async (_, n) => {
          const res = await fetch(`${base}/w${n}/api/admin/live_games`, {
            headers,
          });
          if (!res.ok) throw new Error(`live_games ${res.status}`);
          return AdminLiveGamesSchema.parse(await res.json());
        }),
      );
      this.games = lists.flat().sort((a, b) => a.startedAt - b.startedAt);
    } catch (e) {
      console.warn("live games failed", e);
      this.error = true;
    }
    this.busy = false;
  }

  // Same flow as opening a ?spectate link.
  private spectate(gameID: string): void {
    window.location.href = `${ClientEnv.gameNavigateBase(gameID)}${ClientEnv.gamePath(gameID)}?spectate`;
  }

  render() {
    if (!this.isRoot) return nothing;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6 mt-4">
        <div class="space-y-3">
          <div>
            <div class="text-white font-medium">
              ${translateText("admin.live_games.title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("admin.live_games.desc")}
            </div>
          </div>
          ${this.error
            ? html`<p class="text-sm text-red-200" role="alert">
                ${translateText("admin.live_games.error")}
              </p>`
            : nothing}
          ${!this.error && !this.busy && this.games.length === 0
            ? html`<p class="text-white/50 text-sm" role="status">
                ${translateText("admin.live_games.none")}
              </p>`
            : nothing}
          ${this.games.map(
            (g) => html`
              <div class="flex items-center justify-between gap-3">
                <div class="text-white/50 text-sm">
                  ${g.map} · ${g.mode} ·
                  ${translateText("admin.live_games.counts", {
                    players: g.players.length,
                    bots: g.bots.length,
                  })}
                  ·
                  ${translateText("admin.live_games.age", {
                    minutes: Math.max(
                      0,
                      Math.floor((Date.now() - g.startedAt) / 60000),
                    ),
                  })}
                </div>
                <o-button
                  variant="primary"
                  size="md"
                  data-spectate=${g.gameID}
                  @click=${() => this.spectate(g.gameID)}
                  translationKey="admin.live_games.spectate"
                ></o-button>
              </div>
            `,
          )}
          <o-button
            variant="primary"
            width="block"
            size="md"
            ?disable=${this.busy}
            @click=${() => void this.refresh()}
            translationKey="admin.live_games.refresh"
          ></o-button>
        </div>
      </div>
    `;
  }
}
