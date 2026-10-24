import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { userAuth } from "../../Auth";
import { adminResetErrorKey, adminXp } from "../../PasswordAuthApi";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

// Same input styling as <admin-reset-card>.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";

type Action = { action: "set"; lifetimeXp: number } | { action: "reset" };

/**
 * Admin XP card for the signed-in account panel: root only. Look up a
 * player's level and lifetime XP, set the lifetime XP or reset it. Hiding the
 * card for other roles is cosmetic; the API checks.
 */
@customElement("admin-xp-card")
export class AdminXpCard extends LitElement {
  @state() private isRoot = false;
  @state() private busy = false;
  @state() private error = "";
  @state() private result = "";

  private username = "";
  private xp = "";

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
  }

  private async run(action?: Action): Promise<void> {
    if (this.busy) return;
    this.error = "";
    this.result = "";
    const username = this.username.trim();
    if (!username) {
      this.error = translateText("password_auth.admin_error_no_such_user");
      return;
    }
    this.busy = true;
    const r = await adminXp(username, action);
    this.busy = false;
    if (!r.ok) {
      this.error = translateText(adminResetErrorKey(r.code));
      return;
    }
    this.result = translateText("password_auth.admin_xp_result", {
      level: r.level,
      xp: r.xpInLevel,
      lifetime: r.lifetimeXp,
    });
  }

  private setXp(): void {
    const lifetimeXp = Number(this.xp);
    if (
      this.xp.trim() === "" ||
      !Number.isInteger(lifetimeXp) ||
      lifetimeXp < 0
    ) {
      this.error = translateText("password_auth.error_generic");
      return;
    }
    void this.run({ action: "set", lifetimeXp });
  }

  render() {
    if (!this.isRoot) return nothing;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <form
          class="space-y-3"
          novalidate
          @submit=${(e: Event) => {
            e.preventDefault();
            void this.run();
          }}
        >
          <div>
            <div class="text-white font-medium">
              ${translateText("password_auth.admin_xp_title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("password_auth.admin_xp_desc")}
            </div>
          </div>
          <input
            type="text"
            name="xpUsername"
            autocomplete="off"
            @input=${(e: Event) => {
              this.username = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("password_auth.admin_username")}
            aria-label=${translateText("password_auth.admin_username")}
            class=${INPUT_CLASS}
          />
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="password_auth.admin_xp_lookup"
          ></o-button>
          <input
            type="number"
            min="0"
            step="1"
            name="xpValue"
            autocomplete="off"
            @input=${(e: Event) => {
              this.xp = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("password_auth.admin_xp_value")}
            aria-label=${translateText("password_auth.admin_xp_value")}
            class=${INPUT_CLASS}
          />
          ${this.error
            ? html`<p class="text-sm text-red-200" role="alert">
                ${this.error}
              </p>`
            : nothing}
          ${this.result
            ? html`<p class="text-white/50 text-sm" role="status">
                ${this.result}
              </p>`
            : nothing}
          <o-button
            variant="primary"
            width="block"
            size="md"
            ?disable=${this.busy}
            translationKey="password_auth.admin_xp_set"
            @click=${() => this.setXp()}
          ></o-button>
          <o-button
            variant="danger"
            width="block"
            size="md"
            ?disable=${this.busy}
            translationKey="password_auth.admin_xp_reset"
            @click=${() => void this.run({ action: "reset" })}
          ></o-button>
        </form>
      </div>
    `;
  }
}
