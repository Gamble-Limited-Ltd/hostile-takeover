import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  changePassword,
  changePasswordErrorKey,
  validateNewPassword,
} from "../../PasswordAuthApi";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

// Same input styling as <password-auth-form>.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";

/**
 * Change-password card for the signed-in account panel: current + new
 * password, then PATCH /users/@me/password. The API signs out every other
 * session and reissues this browser's session cookie, so the player stays
 * signed in; nothing else has to happen here.
 */
@customElement("change-password-card")
export class ChangePasswordCard extends LitElement {
  @state() private busy = false;
  @state() private error = "";
  @state() private notice = "";

  private current = "";
  private next = "";

  createRenderRoot() {
    return this;
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy) return;
    this.error = "";
    this.notice = "";
    if (!this.current) {
      this.error = translateText("password_auth.error_wrong_password");
      return;
    }
    const problem = validateNewPassword(this.next);
    if (problem) {
      this.error = translateText(problem);
      return;
    }
    this.busy = true;
    const result = await changePassword(this.current, this.next);
    this.busy = false;
    if (!result.ok) {
      this.error = translateText(changePasswordErrorKey(result.code));
      return;
    }
    this.current = "";
    this.next = "";
    this.notice = translateText("password_auth.change_password_done");
    // The inputs are uncontrolled while typing; clear what is on screen.
    this.querySelectorAll("input").forEach((i) => (i.value = ""));
  }

  private field(
    name: "current" | "next",
    placeholderKey: string,
    autocomplete: string,
  ): TemplateResult {
    return html`<input
      type="password"
      name=${name === "current" ? "currentPassword" : "newPassword"}
      autocomplete=${autocomplete}
      @input=${(e: Event) => {
        this[name] = (e.target as HTMLInputElement).value;
      }}
      placeholder=${translateText(placeholderKey)}
      aria-label=${translateText(placeholderKey)}
      class=${INPUT_CLASS}
    />`;
  }

  render() {
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <form class="space-y-3" novalidate @submit=${this.submit}>
          <div>
            <div class="text-white font-medium">
              ${translateText("password_auth.change_password")}
            </div>
            <div class="text-white/50 text-sm mt-1">
              ${translateText("password_auth.change_password_desc")}
            </div>
          </div>
          ${this.field(
            "current",
            "password_auth.current_password",
            "current-password",
          )}
          ${this.field(
            "next",
            "password_auth.new_password_change",
            "new-password",
          )}
          ${this.error
            ? html`<p class="text-sm text-red-200" role="alert">
                ${this.error}
              </p>`
            : nothing}
          ${this.notice
            ? html`<p class="text-sm text-emerald-300" role="status">
                ${this.notice}
              </p>`
            : nothing}
          <o-button
            variant="primary"
            width="block"
            size="md"
            submit
            ?disable=${this.busy}
            translationKey="password_auth.change_password"
          ></o-button>
        </form>
      </div>
    `;
  }
}
