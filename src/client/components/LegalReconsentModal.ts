import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { deleteAccount } from "../Api";
import { clearLocalSession, logOut } from "../Auth";
import { acceptLegal, hallDoc } from "../LegalV2";
import { translateText } from "../Utils";
import "./baseComponents/Modal";
import type { OModal } from "./baseComponents/Modal";

/**
 * Legal v2 reconsent. When /users/@me carries `legal` (the API has LEGAL_VERSION
 * on) and the account's accepted version differs, ask once per page load.
 * Accept records the API's current version; Sign out declines. Absent while dark.
 * Same shape as <banned-modal>: reads the `userMeResponse` document event.
 */
@customElement("legal-reconsent-modal")
export class LegalReconsentModal extends LitElement {
  @state() private needed = false;
  @state() private failed = false;
  @query("o-modal") private modalEl?: OModal;
  private opened = false;

  private onUserMeResponse = (event: Event) => {
    const detail = (event as CustomEvent<UserMeResponse | false>).detail;
    const legal = detail === false ? undefined : detail.legal;
    this.needed = !!legal && legal.accepted !== legal.required;
    if (!this.needed) this.opened = false;
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMeResponse);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("userMeResponse", this.onUserMeResponse);
  }

  updated() {
    if (
      this.needed &&
      !this.opened &&
      typeof this.modalEl?.open === "function"
    ) {
      this.opened = true;
      this.modalEl.hideCloseButton = true;
      this.modalEl.onClose = this.keepOpen;
      this.modalEl.open();
    }
  }

  // Blocking: no close button, and a close by any other route (backdrop, Escape) reopens it.
  private keepOpen = () => {
    if (this.needed) this.modalEl?.open();
  };

  private async deleteMine() {
    if (
      !window.confirm(translateText("account_modal.delete_account_warning"))
    ) {
      return;
    }
    const r = await deleteAccount();
    if (r.ok) {
      clearLocalSession();
      window.location.reload();
    }
  }

  private async accept() {
    if (await acceptLegal()) {
      this.failed = false;
      this.needed = false;
    } else {
      this.failed = true;
    }
  }

  render() {
    if (!this.needed) return html``;
    return html`
      <o-modal title=${translateText("legal.reconsent_title")}>
        <div style="max-width: 32rem; line-height: 1.5;">
          <p style="margin: 0 0 0.75rem;">
            ${translateText("legal.reconsent_body")}
          </p>
          <p style="margin: 0 0 0.75rem;">
            <a
              href=${hallDoc("terms")}
              target="_blank"
              rel="noopener"
              class="underline"
              >${translateText("main.terms_of_service")}</a
            >
            ${translateText("password_auth.age_agree_and")}
            <a
              href=${hallDoc("privacy")}
              target="_blank"
              rel="noopener"
              class="underline"
              >${translateText("main.privacy_policy")}</a
            >
          </p>
          ${this.failed
            ? html`<p role="alert" style="margin: 0 0 0.75rem;">
                ${translateText("legal.reconsent_error")}
              </p>`
            : null}
          <div style="display: flex; gap: 0.75rem;">
            <button
              data-legal-accept
              class="underline"
              @click=${() => this.accept()}
            >
              ${translateText("legal.reconsent_accept")}
            </button>
            <button
              data-legal-decline
              class="underline"
              @click=${() => void logOut()}
            >
              ${translateText("legal.reconsent_decline")}
            </button>
          </div>
          <p style="margin: 0.75rem 0 0;">
            <button
              data-legal-delete
              class="underline"
              @click=${() => void this.deleteMine()}
            >
              ${translateText("legal.reconsent_delete")}
            </button>
          </p>
        </div>
      </o-modal>
    `;
  }
}
