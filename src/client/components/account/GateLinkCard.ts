import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  confirmGateLink,
  createErrorKey,
  fetchGatePending,
  gateCreate,
  gateLinkWithPassword,
  GatePending,
  GateResult,
  gateStartUrl,
  linkErrorKey,
} from "../../GateAuthApi";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

// Same input styling as <password-auth-form>.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";

type Status = "loading" | "ready" | "expired";

/**
 * Shown after `#gate=link`: the player is signed in to GLL ID but has no
 * Hostile Takeover account linked yet. Offers to confirm a matching account,
 * link an old one with its password, or start a new one. Fires `auth-success`
 * once the API has set the session cookie.
 */
@customElement("gate-link-card")
export class GateLinkCard extends LitElement {
  @state() private status: Status = "loading";
  @state() private pending: GatePending | null = null;
  @state() private declinedMatch = false;
  @state() private busy = false;
  @state() private error = "";
  @state() private createError = "";

  private values = { username: "", password: "", newUsername: "" };

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await fetchGatePending();
    if (!result.ok) {
      this.status = "expired";
      return;
    }
    this.pending = result.pending;
    this.values.newUsername = result.pending.loginName;
    this.status = "ready";
  }

  private async run(
    call: () => Promise<GateResult>,
    keyOf: (code: string) => string,
    target: "error" | "createError" = "error",
  ): Promise<void> {
    if (this.busy) return;
    this.error = "";
    this.createError = "";
    this.busy = true;
    const result = await call();
    this.busy = false;
    if (result.ok) {
      this.dispatchEvent(
        new CustomEvent("auth-success", { bubbles: true, composed: true }),
      );
      return;
    }
    if (result.code === "no_pending") {
      this.status = "expired";
      return;
    }
    this[target] = translateText(keyOf(result.code));
  }

  private onConfirm(): Promise<void> {
    return this.run(() => confirmGateLink(), linkErrorKey);
  }

  private onLinkPassword(e: Event): Promise<void> {
    e.preventDefault();
    const { username, password } = this.values;
    if (!username.trim() || !password) {
      this.error = translateText("gate_auth.error_invalid_credentials");
      return Promise.resolve();
    }
    return this.run(
      () => gateLinkWithPassword(username.trim(), password),
      linkErrorKey,
    );
  }

  private onCreate(e: Event): Promise<void> {
    e.preventDefault();
    return this.run(
      () => gateCreate(this.values.newUsername.trim()),
      createErrorKey,
      "createError",
    );
  }

  private message(text: string): TemplateResult | typeof nothing {
    return text
      ? html`<p class="text-sm text-red-200" role="alert">${text}</p>`
      : nothing;
  }

  private input(
    key: keyof typeof this.values,
    type: string,
    placeholderKey: string,
    autocomplete: string,
  ): TemplateResult {
    return html`
      <input
        type=${type}
        name=${key}
        autocomplete=${autocomplete}
        .value=${this.values[key]}
        @input=${(e: Event) => {
          this.values[key] = (e.target as HTMLInputElement).value;
        }}
        placeholder=${translateText(placeholderKey)}
        aria-label=${translateText(placeholderKey)}
        class=${INPUT_CLASS}
      />
    `;
  }

  private renderExpired(): TemplateResult {
    return html`
      <div class="space-y-3">
        <p class="text-sm text-white/70" role="alert">
          ${translateText("gate_auth.link_expired")}
        </p>
        <o-button
          variant="primary"
          width="block"
          size="md"
          translationKey="gate_auth.sign_in"
          @click=${() => (window.location.href = gateStartUrl())}
        ></o-button>
      </div>
    `;
  }

  private renderMatch(match: { username: string }): TemplateResult {
    return html`
      <div class="space-y-3">
        <p class="text-white font-medium">
          ${translateText("gate_auth.match_question", {
            username: match.username,
          })}
        </p>
        <o-button
          variant="primary"
          width="block"
          size="md"
          ?disable=${this.busy}
          translationKey="gate_auth.match_yes"
          @click=${() => void this.onConfirm()}
        ></o-button>
        <o-button
          variant="secondary"
          width="block"
          size="md"
          ?disable=${this.busy}
          translationKey="gate_auth.match_no"
          @click=${() => (this.declinedMatch = true)}
        ></o-button>
        ${this.message(this.error)}
      </div>
    `;
  }

  private renderLinkOld(): TemplateResult {
    return html`
      <form class="space-y-3" novalidate @submit=${this.onLinkPassword}>
        <div>
          <div class="text-white font-medium">
            ${translateText("gate_auth.link_old_title")}
          </div>
          <div class="text-white/50 text-sm mt-1">
            ${translateText("gate_auth.link_old_desc")}
          </div>
        </div>
        ${this.input("username", "text", "password_auth.username", "username")}
        ${this.input(
          "password",
          "password",
          "password_auth.password",
          "current-password",
        )}
        ${this.message(this.error)}
        <o-button
          variant="secondary"
          width="block"
          size="md"
          submit
          ?disable=${this.busy}
          translationKey="gate_auth.link_old_submit"
        ></o-button>
      </form>
    `;
  }

  private renderCreate(pending: GatePending): TemplateResult {
    return html`
      <form class="space-y-3" novalidate @submit=${this.onCreate}>
        <div>
          <div class="text-white font-medium">
            ${translateText("gate_auth.create_title")}
          </div>
          ${pending.usernameTaken
            ? html`<div class="text-white/50 text-sm mt-1">
                ${translateText("gate_auth.username_taken_hint")}
              </div>`
            : nothing}
        </div>
        ${this.input(
          "newUsername",
          "text",
          "password_auth.username",
          "username",
        )}
        ${this.message(this.createError)}
        <o-button
          variant="primary"
          width="block"
          size="md"
          submit
          ?disable=${this.busy}
          translationKey="gate_auth.create_submit"
        ></o-button>
      </form>
    `;
  }

  render() {
    if (this.status === "loading") return nothing;
    if (this.status === "expired" || !this.pending) return this.renderExpired();
    const pending = this.pending;
    const asking = pending.match !== null && !this.declinedMatch;
    return html`
      <div class="space-y-6">
        <p class="text-sm text-emerald-300" role="status">
          ${translateText("gate_auth.signed_in_as", {
            name: pending.loginName,
          })}
        </p>
        ${asking && pending.match
          ? this.renderMatch(pending.match)
          : html`
              ${this.renderLinkOld()}
              ${pending.canCreate
                ? this.renderCreate(pending)
                : pending.match === null
                  ? html`<p class="text-sm text-white/50">
                      ${translateText("gate_auth.cannot_create")}
                    </p>`
                  : nothing}
            `}
      </div>
    `;
  }
}
