import { html, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./components/account/GateLinkCard";
import "./components/baseComponents/Button";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchAuthConfig } from "./GateAuthApi";
import {
  directCall,
  type DirectError,
  type DirectResult,
} from "./GateDirectApi";
import { translateText } from "./Utils";

// Same input styling as <password-auth-form>.
const INPUT_CLASS =
  "w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-malibu-blue/50 focus:border-malibu-blue/50 transition-all font-medium hover:bg-white/10";
const LINK_CLASS =
  "text-xs font-bold text-white/40 hover:text-white transition-colors uppercase tracking-widest";

type Mode = "signin" | "signup" | "code" | "forgot" | "reset" | "link";

/**
 * "Redirect failed? Sign in here": GLL ID's own forms inside Hostile Takeover.
 * The game's server talks to GLL ID; this modal only shows GLL ID's messages.
 */
@customElement("gate-direct-modal")
export class GateDirectModal extends BaseModal {
  @state() private mode: Mode = "signin";
  @state() private busy = false;
  @state() private notice = "";
  @state() private error: DirectError | null = null;
  @state() private gateUrl = "";

  /** The handle GLL ID gave for the emailed code, and what the code is for. */
  private pending = "";
  private codeFor: "login" | "signup" | "reset" = "login";
  private pendingCode = "";

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("gate_direct.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected onOpen(): void {
    this.querySelector("form")?.reset();
    this.setMode("signin");
    void fetchAuthConfig().then((c) => (this.gateUrl = c.gateUrl));
  }

  private setMode(mode: Mode, notice = ""): void {
    this.mode = mode;
    this.notice = notice;
    this.error = null;
  }

  private fieldError(name: string): TemplateResult | typeof nothing {
    const m = this.error?.fields[name];
    return m
      ? html`<p class="text-sm text-red-200" role="alert">${m}</p>`
      : nothing;
  }

  private input(
    key: string,
    type: string,
    placeholderKey: string,
    autocomplete: string,
    hintKey?: string,
  ): TemplateResult {
    return html`
      <div class="space-y-1">
        <input
          type=${type}
          name=${key}
          autocomplete=${autocomplete}
          placeholder=${translateText(placeholderKey)}
          aria-label=${translateText(placeholderKey)}
          class=${INPUT_CLASS}
        />
        ${hintKey
          ? html`<p class="text-xs text-white/50">${translateText(hintKey)}</p>`
          : nothing}
        ${this.fieldError(key)}
      </div>
    `;
  }

  /** Runs a call; on success `next` decides what happens. */
  private async run(
    call: () => Promise<DirectResult>,
    next: (r: Extract<DirectResult, { ok: true }>) => void,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.notice = "";
    const r = await call();
    this.busy = false;
    if (r.ok) return next(r);
    if (r.error.code === "EMAIL_UNVERIFIED" && r.pending) {
      this.toCode(r.pending, "login", r.error.message);
      return;
    }
    this.error = r.error;
  }

  private toCode(
    pending: string,
    codeFor: "login" | "signup" | "reset",
    notice = "",
  ): void {
    this.pending = pending;
    this.codeFor = codeFor;
    this.setMode("code", notice || translateText("gate_direct.code_sent"));
  }

  /** Signed in at GLL ID: reload onto the session, or finish the HT account first. */
  private signedIn(status: "ok" | "match" | "rename"): void {
    if (status !== "ok") return this.setMode("link");
    this.close();
    this.reload();
  }

  /** A seam for tests: jsdom can't reload. */
  private reload(): void {
    window.location.reload();
  }

  // Values are read from the form at submit: password managers fill fields
  // without firing input events.
  private onSubmit = (e: Event): void => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement);
    const v = (k: string) => String(f.get(k) ?? "");
    if (this.mode === "signin") {
      void this.run(
        () =>
          directCall("login", {
            identifier: v("identifier").trim(),
            password: v("password"),
          }),
        (r) => this.signedIn(r.status ?? "ok"),
      );
    } else if (this.mode === "signup") {
      if (!f.has("agreed")) {
        this.error = {
          code: "HT_CONSENT",
          message: translateText("gate_direct.error_consent"),
          fields: {},
        };
        return;
      }
      void this.run(
        () =>
          directCall("signup", {
            firstName: v("firstName").trim(),
            lastName: v("lastName").trim(),
            loginName: v("loginName").trim(),
            email: v("email").trim(),
            password: v("password"),
            ageConfirmed13: true,
            acceptedLegal: true,
          }),
        (r) =>
          r.pending
            ? this.toCode(r.pending, "signup")
            : (this.error = {
                code: "HT_ERROR",
                message: translateText("gate_auth.error_generic"),
                fields: {},
              }),
      );
    } else if (this.mode === "code") {
      const code = v("code").trim();
      if (this.codeFor === "reset") {
        // Reset needs the new password too: collected in the reset step.
        this.pendingCode = code;
        this.setMode("reset");
        return;
      }
      void this.run(
        () => directCall("verify", { pending: this.pending, code }),
        (r) => this.signedIn(r.status ?? "ok"),
      );
    } else if (this.mode === "forgot") {
      void this.run(
        () => directCall("recover", { identifier: v("identifier").trim() }),
        (r) => {
          if (r.pending) this.toCode(r.pending, "reset");
        },
      );
    } else if (this.mode === "reset") {
      void this.run(
        () =>
          directCall("reset", {
            pending: this.pending,
            code: this.pendingCode,
            newPassword: v("newPassword"),
          }),
        // GLL ID signs the player in when it can; otherwise they sign in again.
        (r) =>
          r.status
            ? this.signedIn(r.status)
            : this.setMode("signin", translateText("gate_direct.reset_done")),
      );
    }
  };

  private onResend = (): void => {
    void this.run(
      () => directCall("resend", { pending: this.pending }),
      () => (this.notice = translateText("gate_direct.code_resent")),
    );
  };

  private submitButton(key: string): TemplateResult {
    return html`<o-button
      variant="primary"
      width="block"
      size="md"
      submit
      ?disable=${this.busy}
      translationKey=${key}
    ></o-button>`;
  }

  private link(key: string, onClick: () => void): TemplateResult {
    return html`<button type="button" class=${LINK_CLASS} @click=${onClick}>
      ${translateText(key)}
    </button>`;
  }

  private renderFormError(): TemplateResult | typeof nothing {
    const e = this.error;
    if (!e) return nothing;
    // Messages tied to a field are shown under that field instead.
    if (Object.keys(e.fields).length > 0) return nothing;
    return html`<p class="text-sm text-red-200" role="alert">${e.message}</p>`;
  }

  private renderLegalLinks(): TemplateResult {
    const base = this.gateUrl;
    return html`${translateText("gate_direct.terms_before")}
      <a
        href="${base}/terms"
        target="_blank"
        rel="noopener"
        class="underline hover:text-white transition-colors"
        >${translateText("main.terms_of_service")}</a
      >
      ${translateText("password_auth.age_agree_and")}
      <a
        href="${base}/privacy"
        target="_blank"
        rel="noopener"
        class="underline hover:text-white transition-colors"
        >${translateText("main.privacy_policy")}</a
      >`;
  }

  private renderMode(): TemplateResult {
    switch (this.mode) {
      case "signin":
        return html`
          <form class="space-y-3" novalidate @submit=${this.onSubmit}>
            ${this.input(
              "identifier",
              "text",
              "gate_direct.identifier",
              "username",
            )}
            ${this.input(
              "password",
              "password",
              "password_auth.password",
              "current-password",
            )}
            ${this.renderFormError()}
            ${this.submitButton("password_auth.sign_in")}
            <div class="flex justify-between pt-1">
              ${this.link("gate_direct.create_account", () =>
                this.setMode("signup"),
              )}
              ${this.link("gate_direct.forgot", () => this.setMode("forgot"))}
            </div>
          </form>
        `;
      case "signup":
        return html`
          <form class="space-y-3" novalidate @submit=${this.onSubmit}>
            ${this.input(
              "firstName",
              "text",
              "password_auth.first_name",
              "given-name",
            )}
            ${this.input(
              "lastName",
              "text",
              "password_auth.last_name",
              "family-name",
            )}
            ${this.input(
              "loginName",
              "text",
              "gate_direct.login_name",
              "username",
              "gate_direct.login_name_hint",
            )}
            ${this.input("email", "email", "password_auth.email", "email")}
            ${this.input(
              "password",
              "password",
              "password_auth.new_password",
              "new-password",
            )}
            <label
              class="flex items-start gap-2 text-xs text-white/60 cursor-pointer"
            >
              <input type="checkbox" name="agreed" class="mt-0.5" />
              <span>${this.renderLegalLinks()}</span>
            </label>
            ${this.renderFormError()}
            ${this.submitButton("password_auth.create_account")}
            <div class="pt-1">
              ${this.link("gate_direct.back_to_sign_in", () =>
                this.setMode("signin"),
              )}
            </div>
          </form>
        `;
      case "code":
        return html`
          <form class="space-y-3" novalidate @submit=${this.onSubmit}>
            <p class="text-white/70 text-sm">
              ${translateText("gate_direct.code_help")}
            </p>
            <input
              type="text"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              placeholder=${translateText("gate_direct.code")}
              aria-label=${translateText("gate_direct.code")}
              class=${INPUT_CLASS}
            />
            ${this.renderFormError()}
            ${this.submitButton("gate_direct.confirm_code")}
            <div class="flex justify-between pt-1">
              ${this.link("gate_direct.resend", this.onResend)}
              ${this.link("gate_direct.back_to_sign_in", () =>
                this.setMode("signin"),
              )}
            </div>
          </form>
        `;
      case "forgot":
        return html`
          <form class="space-y-3" novalidate @submit=${this.onSubmit}>
            <p class="text-white/70 text-sm">
              ${translateText("gate_direct.forgot_help")}
            </p>
            ${this.input(
              "identifier",
              "text",
              "gate_direct.identifier",
              "username",
            )}
            ${this.renderFormError()}
            ${this.submitButton("gate_direct.send_code")}
            <div class="pt-1">
              ${this.link("gate_direct.back_to_sign_in", () =>
                this.setMode("signin"),
              )}
            </div>
          </form>
        `;
      case "link":
        return html`<gate-link-card
          @auth-success=${() => this.signedIn("ok")}
        ></gate-link-card>`;
      case "reset":
        return html`
          <form class="space-y-3" novalidate @submit=${this.onSubmit}>
            ${this.input(
              "newPassword",
              "password",
              "password_auth.new_password",
              "new-password",
            )}
            ${this.renderFormError()}
            ${this.submitButton("password_auth.set_password")}
          </form>
        `;
    }
  }

  protected renderBody() {
    return html`
      <div class="flex-1 flex flex-col gap-4 p-6">
        ${this.notice
          ? html`<p class="text-sm text-emerald-300" role="status">
              ${this.notice}
            </p>`
          : nothing}
        ${this.renderMode()}
      </div>
    `;
  }
}
