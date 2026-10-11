import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  loginErrorKey,
  loginWithPassword,
  registerAccount,
  registerErrorTarget,
  RegisterField,
  resetErrorKey,
  resetPassword,
  validateNewPassword,
  validateRegisterFields,
} from "../../PasswordAuthApi";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

export type PasswordAuthMode = "signin" | "signup" | "reset";

// Same input styling as the account modal's old email field.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";
const LINK_CLASS =
  "text-xs font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest";

/**
 * Sign in / create account / set-a-new-password form for the signed-out
 * account modal. Fires `auth-success` after a login or sign-up, and
 * `reset-done` after a password reset (it then shows Sign in itself).
 */
@customElement("password-auth-form")
export class PasswordAuthForm extends LitElement {
  @property({ type: String }) resetToken = "";

  @state() mode: PasswordAuthMode = "signin";
  @state() private busy = false;
  @state() private notice = "";
  @state() private formError = "";
  @state() private fieldErrors: Partial<Record<RegisterField, string>> = {};

  private values = {
    usernameOrEmail: "",
    password: "",
    firstName: "",
    lastName: "",
    email: "",
    username: "",
  };
  @state() private ageConfirmed = false;

  createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("resetToken") && this.resetToken) {
      this.setMode("reset");
    }
  }

  private setMode(mode: PasswordAuthMode, notice = ""): void {
    this.mode = mode;
    this.notice = notice;
    this.formError = "";
    this.fieldErrors = {};
    this.values.password = "";
  }

  private onInput(key: keyof typeof this.values, e: Event): void {
    this.values[key] = (e.target as HTMLInputElement).value;
  }

  private async submit(e: Event): Promise<void> {
    e.preventDefault();
    if (this.busy) return;
    this.formError = "";
    this.notice = "";
    this.fieldErrors = {};
    if (this.mode === "signin") return this.submitSignIn();
    if (this.mode === "signup") return this.submitSignUp();
    return this.submitReset();
  }

  private async submitSignIn(): Promise<void> {
    const { usernameOrEmail, password } = this.values;
    if (!usernameOrEmail.trim() || !password) {
      this.formError = translateText("password_auth.error_invalid_credentials");
      return;
    }
    this.busy = true;
    const result = await loginWithPassword(usernameOrEmail.trim(), password);
    this.busy = false;
    if (result.ok) return this.succeed();
    this.formError = translateText(loginErrorKey(result.code));
  }

  private async submitSignUp(): Promise<void> {
    const fields = {
      firstName: this.values.firstName,
      lastName: this.values.lastName,
      email: this.values.email,
      username: this.values.username,
      password: this.values.password,
      ageConfirmed: this.ageConfirmed,
    };
    const problems = validateRegisterFields(fields);
    if (Object.keys(problems).length > 0) {
      this.fieldErrors = Object.fromEntries(
        Object.entries(problems).map(([k, v]) => [k, translateText(v)]),
      );
      return;
    }
    this.busy = true;
    const result = await registerAccount(fields);
    this.busy = false;
    if (result.ok) return this.succeed();
    const target = registerErrorTarget(result.code);
    const message = translateText(target.key);
    if (target.field === "form") this.formError = message;
    else this.fieldErrors = { [target.field]: message };
  }

  private async submitReset(): Promise<void> {
    const problem = validateNewPassword(this.values.password);
    if (problem) {
      this.fieldErrors = { password: translateText(problem) };
      return;
    }
    this.busy = true;
    const result = await resetPassword(this.resetToken, this.values.password);
    this.busy = false;
    if (!result.ok) {
      this.formError = translateText(resetErrorKey(result.code));
      return;
    }
    this.dispatchEvent(
      new CustomEvent("reset-done", { bubbles: true, composed: true }),
    );
    this.setMode("signin", translateText("password_auth.reset_success"));
  }

  private succeed(): void {
    this.dispatchEvent(
      new CustomEvent("auth-success", { bubbles: true, composed: true }),
    );
  }

  private error(message: string | undefined): TemplateResult | typeof nothing {
    return message
      ? html`<p class="text-sm text-red-200" role="alert">${message}</p>`
      : nothing;
  }

  private input(
    key: keyof typeof this.values,
    type: string,
    placeholderKey: string,
    autocomplete: string,
    errorField?: RegisterField,
  ): TemplateResult {
    return html`
      <div class="space-y-1">
        <input
          type=${type}
          name=${key}
          autocomplete=${autocomplete}
          .value=${this.values[key]}
          @input=${(e: Event) => this.onInput(key, e)}
          placeholder=${translateText(placeholderKey)}
          aria-label=${translateText(placeholderKey)}
          class=${INPUT_CLASS}
        />
        ${errorField ? this.error(this.fieldErrors[errorField]) : nothing}
      </div>
    `;
  }

  private renderSignIn(): TemplateResult {
    return html`
      ${this.input(
        "usernameOrEmail",
        "text",
        "password_auth.username_or_email",
        "username",
      )}
      ${this.input(
        "password",
        "password",
        "password_auth.password",
        "current-password",
      )}
    `;
  }

  private renderSignUp(): TemplateResult {
    return html`
      ${this.input(
        "firstName",
        "text",
        "password_auth.first_name",
        "given-name",
        "firstName",
      )}
      ${this.input(
        "lastName",
        "text",
        "password_auth.last_name",
        "family-name",
        "lastName",
      )}
      ${this.input("email", "email", "password_auth.email", "email", "email")}
      <p class="text-white/40 text-xs -mt-2">
        ${translateText("password_auth.email_hint")}
      </p>
      ${this.input(
        "username",
        "text",
        "password_auth.username",
        "username",
        "username",
      )}
      ${this.input(
        "password",
        "password",
        "password_auth.new_password",
        "new-password",
        "password",
      )}
      <div class="space-y-1">
        <label
          class="flex items-start gap-2 text-xs text-white/60 cursor-pointer"
        >
          <input
            type="checkbox"
            name="age"
            class="mt-0.5"
            .checked=${this.ageConfirmed}
            @change=${(e: Event) =>
              (this.ageConfirmed = (e.target as HTMLInputElement).checked)}
          />
          <span>
            ${translateText("password_auth.age_agree_before")}
            <a
              href="/terms-of-service.html"
              target="_blank"
              class="underline hover:text-white transition-colors"
              >${translateText("main.terms_of_service")}</a
            >
            ${translateText("password_auth.age_agree_and")}
            <a
              href="/privacy-policy.html"
              target="_blank"
              class="underline hover:text-white transition-colors"
              >${translateText("main.privacy_policy")}</a
            >
          </span>
        </label>
        ${this.error(this.fieldErrors.age)}
      </div>
    `;
  }

  private renderReset(): TemplateResult {
    return html`
      <p class="text-lg font-semibold text-white text-center">
        ${translateText("password_auth.reset_title")}
      </p>
      ${this.input(
        "password",
        "password",
        "password_auth.new_password",
        "new-password",
        "password",
      )}
    `;
  }

  render() {
    const fields =
      this.mode === "signup"
        ? this.renderSignUp()
        : this.mode === "reset"
          ? this.renderReset()
          : this.renderSignIn();
    const submitKey =
      this.mode === "signup"
        ? "password_auth.create_account"
        : this.mode === "reset"
          ? "password_auth.set_password"
          : "password_auth.sign_in";
    return html`
      <form class="space-y-3" novalidate @submit=${this.submit}>
        ${this.notice
          ? html`<p class="text-sm text-emerald-300" role="status">
              ${this.notice}
            </p>`
          : nothing}
        ${fields} ${this.error(this.formError)}
        <o-button
          variant="primary"
          width="block"
          size="md"
          submit
          ?disable=${this.busy}
          translationKey=${submitKey}
        ></o-button>
        ${this.mode === "reset"
          ? nothing
          : html`<div class="text-center pt-3">
              <button
                type="button"
                class=${LINK_CLASS}
                @click=${() =>
                  this.setMode(this.mode === "signin" ? "signup" : "signin")}
              >
                ${translateText(
                  this.mode === "signin"
                    ? "password_auth.switch_to_signup"
                    : "password_auth.switch_to_signin",
                )}
              </button>
            </div>`}
      </form>
    `;
  }
}
