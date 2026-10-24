import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { userAuth } from "../../Auth";
import {
  adminRenameErrorKey,
  adminResetErrorKey,
  createResetLink,
  renameUserAsAdmin,
} from "../../PasswordAuthApi";
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
  private renameFrom = "";
  private renameTo = "";
  @state() private renameBusy = false;
  @state() private renameError = "";
  @state() private renameDone = "";

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

  private async submitRename(e: Event): Promise<void> {
    e.preventDefault();
    if (this.renameBusy) return;
    this.renameError = "";
    this.renameDone = "";
    const from = this.renameFrom.trim();
    const to = this.renameTo.trim();
    if (!from || !to) {
      this.renameError = translateText(
        "password_auth.admin_error_no_such_user",
      );
      return;
    }
    this.renameBusy = true;
    const result = await renameUserAsAdmin(from, to);
    this.renameBusy = false;
    if (!result.ok) {
      this.renameError = translateText(adminRenameErrorKey(result.code));
      return;
    }
    this.renameDone = translateText("password_auth.admin_rename_done", {
      name: result.username,
    });
  }

  render() {
    if (!this.isRoot) return nothing;
    return html`${this.renderReset()}${this.renderRename()}`;
  }

  private renderRename() {
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6 mt-4">
        <form class="space-y-3" novalidate @submit=${this.submitRename}>
          <div>
            <div class="text-white font-medium">
              ${translateText("password_auth.admin_rename_title")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("password_auth.admin_rename_desc")}
            </div>
          </div>
          <input
            type="text"
            name="renameFrom"
            autocomplete="off"
            @input=${(e: Event) => {
              this.renameFrom = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("password_auth.admin_username")}
            aria-label=${translateText("password_auth.admin_username")}
            class=${INPUT_CLASS}
          />
          <input
            type="text"
            name="renameTo"
            autocomplete="off"
            @input=${(e: Event) => {
              this.renameTo = (e.target as HTMLInputElement).value;
            }}
            placeholder=${translateText("password_auth.admin_new_username")}
            aria-label=${translateText("password_auth.admin_new_username")}
            class=${INPUT_CLASS}
          />
          ${this.renameError
            ? html`<p class="text-sm text-red-200" role="alert">
                ${this.renameError}
              </p>`
            : nothing}
          ${this.renameDone
            ? html`<p class="text-white/50 text-sm" role="status">
                ${this.renameDone}
              </p>`
            : nothing}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.renameBusy}
            translationKey="password_auth.admin_rename_button"
          ></o-button>
        </form>
      </div>
    `;
  }

  private renderReset() {
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
