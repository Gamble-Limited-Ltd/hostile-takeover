import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { userAuth } from "../../Auth";
import { adminResetErrorKey, createResetLink } from "../../PasswordAuthApi";
import { translateText } from "../../Utils";
import "../baseComponents/Button";
import "../CopyButton";

// Same input styling as <password-auth-form>.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";

/**
 * Admin reset card for the signed-in account panel: root only. A username
 * and POST /admin/password-resets, then the one-time link to hand to the
 * player. Hiding the card for other roles is cosmetic; the API checks.
 *
 * The link is also shown in a read-only input so it can be copied by hand
 * where the clipboard API doesn't exist (plain http on a LAN address).
 */
@customElement("admin-reset-card")
export class AdminResetCard extends LitElement {
  @state() private isRoot = false;
  @state() private busy = false;
  @state() private error = "";
  @state() private link = "";
  @state() private expiresAt = "";

  private username = "";

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

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy) return;
    this.error = "";
    this.link = "";
    const username = this.username.trim();
    if (!username) {
      this.error = translateText("password_auth.admin_error_no_such_user");
      return;
    }
    this.busy = true;
    const result = await createResetLink(username);
    this.busy = false;
    if (!result.ok) {
      this.error = translateText(adminResetErrorKey(result.code));
      return;
    }
    this.link = result.link;
    this.expiresAt = result.expiresAt;
  }

  render() {
    if (!this.isRoot) return nothing;
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <form class="space-y-3" novalidate @submit=${this.submit}>
          <div>
            <div class="text-white font-medium">
              ${translateText("password_auth.admin_reset_title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("password_auth.admin_reset_desc")}
            </div>
          </div>
          <input
            type="text"
            name="resetUsername"
            autocomplete="off"
            @input=${(e: Event) => {
              this.username = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("password_auth.admin_username")}
            aria-label=${translateText("password_auth.admin_username")}
            class=${INPUT_CLASS}
          />
          ${this.error
            ? html`<p class="text-sm text-red-200" role="alert">
                ${this.error}
              </p>`
            : nothing}
          ${this.link
            ? html`<div class="space-y-3" role="status">
                <input
                  type="text"
                  readonly
                  name="resetLink"
                  .value=${this.link}
                  @focus=${(e: Event) =>
                    (e.target as HTMLInputElement).select()}
                  aria-label=${translateText("password_auth.admin_reset_title")}
                  class=${INPUT_CLASS}
                />
                <div class="flex items-center gap-3">
                  <copy-button
                    compact
                    copy-text=${this.link}
                    display-text=${translateText("common.copy")}
                  ></copy-button>
                  <span class="text-white/50 text-sm">
                    ${translateText("password_auth.admin_link_expires", {
                      time: new Date(this.expiresAt).toLocaleString(),
                    })}
                  </span>
                </div>
                <p class="text-white/50 text-sm">
                  ${translateText("password_auth.admin_link_hint")}
                </p>
              </div>`
            : nothing}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="password_auth.admin_create_link"
          ></o-button>
        </form>
      </div>
    `;
  }
}
