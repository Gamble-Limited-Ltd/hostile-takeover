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
 * Shown when the player is signed in to GLL ID but has no Hostile Takeover
 * account linked yet (after `#gate=link`, or inline in the direct sign-in
 * modal). One primary button: continue as the account we found by email, or
 * create one under a free name. "It's my old account" links one by password.
 * Fires `auth-success` once the API has set the session cookie.
 */
@customElement("gate-link-card")
export class GateLinkCard extends LitElement {
  @state() private status: Status = "loading";
  @state() private pending: GatePending | null = null;
  @state() private oldAccount = false;
  @state() private busy = false;
  @state() private error = "";

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
    this.status = "ready";
  }

  private async run(
    call: () => Promise<GateResult>,
    keyOf: (code: string) => string,
  ): Promise<void> {
    if (this.busy) return;
    this.error = "";
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
    this.error = translateText(keyOf(result.code));
  }

  // Values are read from the form at submit: password managers fill fields
  // without firing input events.
  private fields(e: Event): FormData {
    e.preventDefault();
    return new FormData(e.target as HTMLFormElement);
  }

  private onLinkPassword(e: Event): Promise<void> {
    const f = this.fields(e);
    const username = String(f.get("username") ?? "").trim();
    const password = String(f.get("password") ?? "");
    if (!username || !password) {
      this.error = translateText("gate_auth.error_invalid_credentials");
      return Promise.resolve();
    }
    return this.run(
      () => gateLinkWithPassword(username, password),
      linkErrorKey,
    );
  }

  private create(username: string): Promise<void> {
    return this.run(() => gateCreate(username), createErrorKey);
  }

  private message(): TemplateResult | typeof nothing {
    return this.error
      ? html`<p class="text-sm text-red-200" role="alert">${this.error}</p>`
      : nothing;
  }

  private input(
    name: string,
    type: string,
    placeholderKey: string,
    autocomplete: string,
  ): TemplateResult {
    return html`
      <input
        type=${type}
        name=${name}
        autocomplete=${autocomplete}
        placeholder=${translateText(placeholderKey)}
        aria-label=${translateText(placeholderKey)}
        class=${INPUT_CLASS}
      />
    `;
  }

  private button(
    label: string,
    onClick?: () => void,
    variant: "primary" | "secondary" = "primary",
  ): TemplateResult {
    return html`<o-button
      variant=${variant}
      width="block"
      size="md"
      title=${label}
      ?submit=${!onClick}
      ?disable=${this.busy}
      @click=${onClick}
    ></o-button>`;
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

  private renderMatch(username: string): TemplateResult {
    return html`
      <div class="space-y-3">
        <p class="text-white font-medium">
          ${translateText("gate_auth.match_found")} <b>${username}</b>.
        </p>
        ${this.button(
          translateText("gate_auth.match_continue", { username }),
          () => void this.run(() => confirmGateLink(), linkErrorKey),
        )}
        ${this.message()}
      </div>
    `;
  }

  private renderRename(pending: GatePending): TemplateResult {
    const { suggestion } = pending;
    return html`
      <div class="space-y-3">
        <p class="text-white font-medium">
          ${translateText("gate_auth.name_taken", { name: pending.loginName })}
        </p>
        ${suggestion
          ? this.button(
              translateText("gate_auth.rename_continue", {
                username: suggestion,
              }),
              () => void this.create(suggestion),
            )
          : html`<form
              class="space-y-3"
              novalidate
              @submit=${(e: Event) =>
                this.create(
                  String(this.fields(e).get("username") ?? "").trim(),
                )}
            >
              <p class="text-white/50 text-sm">
                ${translateText("gate_auth.rename_pick")}
              </p>
              ${this.input(
                "username",
                "text",
                "password_auth.username",
                "username",
              )}
              ${this.button(translateText("gate_auth.create_submit"))}
            </form>`}
        ${this.message()}
        <button
          type="button"
          class="text-xs font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest"
          @click=${() => (this.oldAccount = !this.oldAccount)}
        >
          ${translateText("gate_auth.old_account")}
        </button>
        ${this.oldAccount ? this.renderLinkOld() : nothing}
      </div>
    `;
  }

  private renderLinkOld(): TemplateResult {
    return html`
      <form class="space-y-3" novalidate @submit=${this.onLinkPassword}>
        <div class="text-white/50 text-sm">
          ${translateText("gate_auth.link_old_desc")}
        </div>
        ${this.input("username", "text", "password_auth.username", "username")}
        ${this.input(
          "password",
          "password",
          "password_auth.password",
          "current-password",
        )}
        ${this.button(
          translateText("gate_auth.link_old_submit"),
          undefined,
          "secondary",
        )}
      </form>
    `;
  }

  render() {
    if (this.status === "loading") return nothing;
    if (this.status === "expired" || !this.pending) return this.renderExpired();
    return this.pending.match
      ? this.renderMatch(this.pending.match.username)
      : this.renderRename(this.pending);
  }
}
