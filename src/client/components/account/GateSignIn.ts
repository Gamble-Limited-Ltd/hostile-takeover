import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  AuthConfig,
  fetchAuthConfig,
  gateErrorKey,
  gateStartUrl,
} from "../../GateAuthApi";
import { openInNewTab } from "../../GateTabSignal";
import { whenModalLoaded } from "../../LazyModals";
import { translateText } from "../../Utils";
import "../baseComponents/Button";
import "./GateLinkCard";
import "./PasswordAuthForm";

const LINK_CLASS =
  "text-xs font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest";

/**
 * The signed-out body of the account modal. Reads /auth/config and shows the
 * "Sign in with GLL ID" button, the password form, or both. With GLL ID off
 * it is exactly the password form. `auth-success` bubbles up from either.
 */
@customElement("gate-sign-in")
export class GateSignIn extends LitElement {
  @property({ type: String }) resetToken = "";
  @property({ type: Boolean }) linkMode = false;
  @property({ type: String }) errorCode = "";

  @state() private config: AuthConfig | null = null;
  @state() private showPassword = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void fetchAuthConfig().then((config) => (this.config = config));
  }

  private renderGateButton(): TemplateResult {
    return html`
      <o-button
        variant="primary"
        width="block"
        size="md"
        translationKey="gate_auth.sign_in"
        @click=${() => {
          // A new tab keeps this page; a blocked popup falls back to this tab.
          if (!openInNewTab(gateStartUrl())) {
            window.location.href = gateStartUrl();
          }
        }}
      ></o-button>
      <div class="text-center pt-3">
        <button
          type="button"
          name="redirectFailed"
          class=${LINK_CLASS}
          @click=${() =>
            whenModalLoaded("gate-direct-modal", () =>
              document
                .querySelector<HTMLElement & { open(): void }>(
                  "gate-direct-modal",
                )
                ?.open(),
            )}
        >
          ${translateText("gate_auth.direct_link")}
        </button>
      </div>
    `;
  }

  private renderError(): TemplateResult | typeof nothing {
    if (!this.errorCode) return nothing;
    return html`<p class="text-sm text-red-200 mb-3" role="alert">
      ${translateText(gateErrorKey(this.errorCode))}
    </p>`;
  }

  render() {
    const config = this.config;
    if (!config) return nothing;
    const form = html`<password-auth-form
      .resetToken=${this.resetToken}
    ></password-auth-form>`;
    // Today's behaviour, and the reset link always works.
    if (!config.gate || this.resetToken) return form;
    if (this.linkMode) return html`<gate-link-card></gate-link-card>`;
    if (!config.legacy) {
      return html`${this.renderError()}${this.renderGateButton()}`;
    }
    return html`
      ${this.renderError()}${this.renderGateButton()}
      ${this.showPassword
        ? html`<div class="pt-6">${form}</div>`
        : html`<div class="text-center pt-3">
            <button
              type="button"
              name="usePassword"
              class=${LINK_CLASS}
              @click=${() => (this.showPassword = true)}
            >
              ${translateText("gate_auth.use_password")}
            </button>
          </div>`}
    `;
  }
}
