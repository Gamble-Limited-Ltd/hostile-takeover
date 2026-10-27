import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  banUser: vi.fn(),
  unbanUser: vi.fn(),
  muteUser: vi.fn(),
  unmuteUser: vi.fn(),
  getSiteStatus: vi.fn(),
  putSiteStatus: vi.fn(),
  listChatReports: vi.fn(),
  deleteChatReport: vi.fn(),
  markGameUnranked: vi.fn(),
}));
const { userAuth } = vi.hoisted(() => ({ userAuth: vi.fn() }));
vi.mock("../../src/client/AdminApi", () => api);
vi.mock("../../src/client/Auth", () => ({ getAuthHeader: vi.fn(), userAuth }));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { AdminModerationCard } from "../../src/client/components/account/AdminModerationCard";

describe("admin-moderation-card", () => {
  let el: AdminModerationCard;

  async function mount(role?: string) {
    userAuth.mockResolvedValue(
      role === undefined ? false : { claims: { role } },
    );
    api.getSiteStatus.mockResolvedValue({
      ok: true,
      data: { banner: "old", maintenance: true },
    });
    api.listChatReports.mockResolvedValue({
      ok: true,
      data: {
        reports: [
          {
            id: "r1",
            gameId: "g1",
            reporter: "a",
            target: "b",
            message: "rude",
            createdAt: "",
          },
        ],
      },
    });
    if (!customElements.get("admin-moderation-card")) {
      customElements.define("admin-moderation-card", AdminModerationCard);
    }
    el = document.createElement("admin-moderation-card") as AdminModerationCard;
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
  afterEach(() => {
    el.remove();
    vi.clearAllMocks();
  });

  const fill = (name: string, value: string) => {
    const i = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    i.value = value;
    i.dispatchEvent(new Event("input"));
  };
  const submit = async (form: string) => {
    el.querySelector(`form[name=${form}]`)!.dispatchEvent(
      new Event("submit", { cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  };
  const click = async (selector: string) => {
    el.querySelector<HTMLElement>(selector)!.click();
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  };

  it("renders nothing for a non-root player or signed out", async () => {
    await mount("mod");
    expect(el.querySelector("form")).toBeNull();
    expect(api.getSiteStatus).not.toHaveBeenCalled();
    el.remove();
    await mount();
    expect(el.querySelector("form")).toBeNull();
  });

  it("bans, unbans, mutes and unmutes through the API", async () => {
    await mount("root");
    api.banUser.mockResolvedValue({ ok: true, data: {} });
    fill("banUser", "bob");
    fill("banMinutes", "30");
    fill("banReason", "spam");
    await submit("ban");
    expect(api.banUser).toHaveBeenCalledWith("bob", 30, "spam");

    fill("banMinutes", "");
    fill("banReason", "");
    await submit("ban");
    expect(api.banUser).toHaveBeenLastCalledWith("bob", null, null);

    api.unbanUser.mockResolvedValue({ ok: true, data: {} });
    await click(".unban");
    expect(api.unbanUser).toHaveBeenCalledWith("bob");

    api.muteUser.mockResolvedValue({ ok: true, data: {} });
    fill("muteUser", "bob");
    fill("muteMinutes", "15");
    const shadow = el.querySelector<HTMLInputElement>("input[name=shadow]")!;
    shadow.checked = true;
    shadow.dispatchEvent(new Event("change"));
    await submit("mute");
    expect(api.muteUser).toHaveBeenCalledWith("bob", 15, true);

    api.unmuteUser.mockResolvedValue({ ok: true, data: {} });
    await click(".unmute");
    expect(api.unmuteUser).toHaveBeenCalledWith("bob");
  });

  it("shows an API error", async () => {
    await mount("root");
    api.banUser.mockResolvedValue({
      ok: false,
      status: 404,
      code: "no_such_user",
    });
    fill("banUser", "ghost");
    await submit("ban");
    expect(el.textContent).toContain("admin.moderation.error_no_such_user");
  });

  it("loads and saves the banner and maintenance", async () => {
    await mount("root");
    expect(
      el.querySelector<HTMLInputElement>("input[name=banner]")!.value,
    ).toBe("old");
    api.putSiteStatus.mockResolvedValue({ ok: true, data: {} });
    fill("banner", "hello");
    const m = el.querySelector<HTMLInputElement>("input[name=maintenance]")!;
    m.checked = false;
    m.dispatchEvent(new Event("change"));
    await submit("site");
    expect(api.putSiteStatus).toHaveBeenCalledWith({
      banner: "hello",
      maintenance: false,
    });
  });

  it("lists chat reports and deletes one", async () => {
    await mount("root");
    expect(el.textContent).toContain("rude");
    api.deleteChatReport.mockResolvedValue({ ok: true, data: {} });
    await click(".delete-report");
    expect(api.deleteChatReport).toHaveBeenCalledWith("r1");
    expect(el.querySelector(".report")).toBeNull();
  });

  it("marks a game unranked", async () => {
    await mount("root");
    api.markGameUnranked.mockResolvedValue({ ok: true, data: {} });
    fill("gameId", "abc123");
    await submit("unranked");
    expect(api.markGameUnranked).toHaveBeenCalledWith("abc123");
  });
});
