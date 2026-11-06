import { describe, expect, test } from "bun:test";
import type { Locator, Page } from "@playwright/test";
import {
  approveIfPrompted,
  openPrivy,
  recordPrivyRequestFailure,
  recordPrivyResponse,
  signIn,
} from "../lib/privy.ts";

describe("the Privy outage filter", () => {
  test("ERR_ABORTED is ignored and a 503 counts", () => {
    const failures: string[] = [];

    recordPrivyRequestFailure(failures, "https://auth.privy.io/api/v1/otp", "net::ERR_ABORTED");
    expect(failures).toEqual([]);

    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 503);
    expect(failures).toEqual(["auth.privy.io 503"]);

    recordPrivyRequestFailure(failures, "https://auth.privy.io/api/v1/otp", "net::ERR_CONNECTION_RESET");
    expect(failures).toEqual(["auth.privy.io 503", "auth.privy.io net::ERR_CONNECTION_RESET"]);

    recordPrivyResponse(failures, "https://example.test/api", 503);
    expect(failures).toHaveLength(2);
  });

  test("a healthy response is not an outage", () => {
    const failures: string[] = [];
    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 200);
    recordPrivyResponse(failures, "https://auth.privy.io/api/v1/otp", 404);
    expect(failures).toEqual([]);
  });
});

describe("the Privy sign-in click", () => {
  test("a dialog on the first click needs no retry", async () => {
    const calls: string[] = [];
    const notes: string[] = [];

    await openPrivy({
      clickSignIn: async () => {
        calls.push("sign-in");
      },
      clickMenu: async () => {
        calls.push("menu");
      },
      dialogVisible: async () => true,
      note: (text) => notes.push(text),
    });

    expect(calls).toEqual(["sign-in"]);
    expect(notes).toEqual([]);
  });

  test("a dropped first click clicks the menu and the option again, and records the gap", async () => {
    const calls: string[] = [];
    const notes: string[] = [];

    await openPrivy({
      clickSignIn: async () => {
        calls.push("sign-in");
      },
      clickMenu: async () => {
        calls.push("menu");
      },
      dialogVisible: async () => false,
      note: (text) => notes.push(text),
    });

    expect(calls).toEqual(["sign-in", "menu", "sign-in"]);
    expect(notes).toEqual([
      "Privy needed a second click: the first came before it was ready (UX gap, cs-ui)",
    ]);
  });

  test("a visible backdrop skips the menu retry, because the modal is already open", async () => {
    const calls: string[] = [];
    const notes: string[] = [];
    let menuChecked = false;

    await openPrivy({
      clickSignIn: async () => {
        calls.push("sign-in");
      },
      clickMenu: async () => {
        calls.push("menu");
      },
      dialogVisible: async () => false,
      menuUsable: async () => {
        menuChecked = true;
        return false;
      },
      note: (text) => notes.push(text),
    });

    expect(menuChecked).toBe(true);
    expect(calls).toEqual(["sign-in"]);
    expect(notes).toEqual([]);
  });
});

interface SignInLog {
  placeholder: RegExp | undefined;
  buttonQueries: string[];
  fills: string[];
  textboxFills: string[];
  presses: string[];
  codeFocused: boolean;
  keys: string[];
  clicks: string[];
}

function fakeLocator(overrides: Record<string, unknown> = {}): Locator {
  const fake: Record<string, unknown> = {
    _apiName: "Locator",
    count: async () => 1,
    nth: () => fake,
    isVisible: async () => true,
    first: () => fake,
    or: () => fake,
    waitFor: async () => undefined,
    click: async () => undefined,
    ...overrides,
  };
  return fake as unknown as Locator;
}

function emptyLocator(): Locator {
  return fakeLocator({ count: async () => 0, isVisible: async () => false });
}

/** A fake page that models Privy's modal: an email placeholder, a decoy textbox and a code field. */
function fakeSignInPage(): { page: Page; log: SignInLog } {
  const log: SignInLog = {
    placeholder: undefined,
    buttonQueries: [],
    fills: [],
    textboxFills: [],
    presses: [],
    codeFocused: false,
    keys: [],
    clicks: [],
  };

  const email = fakeLocator({
    fill: async (value: string) => {
      log.fills.push(value);
    },
    press: async (key: string) => {
      log.presses.push(key);
    },
  });

  const textbox = fakeLocator({
    fill: async (value: string) => {
      log.textboxFills.push(value);
    },
  });

  const walletButton = fakeLocator({
    click: async () => {
      log.clicks.push("continue with a wallet");
    },
  });

  const code = fakeLocator({
    focus: async () => {
      log.codeFocused = true;
    },
  });

  const dialog = fakeLocator({
    getByPlaceholder: (pattern: RegExp) => {
      log.placeholder = pattern;
      return email;
    },
    locator: (selector: string) => {
      if (selector === 'input[autocomplete="one-time-code"]') return code;
      return emptyLocator();
    },
    getByRole: (role: string, options?: { name?: RegExp }) => {
      if (role === "textbox") return textbox;
      if (role === "button") {
        log.buttonQueries.push(options?.name?.source ?? "");
        return walletButton;
      }
      return emptyLocator();
    },
  });

  const wallet = fakeLocator({
    _expect: async () => ({
      matches: true,
      received: { value: `0x${"11".repeat(20)}` },
      log: "",
    }),
  });

  const page = fakeLocator({
    getByRole: (role: string) => {
      if (role === "dialog") return dialog;
      return emptyLocator();
    },
    locator: (selector: string) => {
      if (selector === "#privy-modal-content") return fakeLocator();
      if (selector.includes("wallet-address")) return wallet;
      return emptyLocator();
    },
    keyboard: {
      type: async (text: string) => {
        log.keys.push(text);
      },
    },
  });

  return { page: page as unknown as Page, log };
}

describe("the Privy sign-in form", () => {
  test("fills the field matched by placeholder, presses Enter, and never clicks a wallet button", async () => {
    const { page, log } = fakeSignInPage();
    let passedModal = false;

    await signIn(page, "buyer@example.test", "123456", async () => {
      passedModal = true;
    });

    expect(passedModal).toBe(true);
    expect(log.placeholder?.test("your@email.com")).toBe(true);
    expect(log.fills).toEqual(["buyer@example.test"]);
    expect(log.textboxFills).toEqual([]);
    expect(log.presses).toEqual(["Enter"]);
    expect(log.codeFocused).toBe(true);
    expect(log.keys).toEqual(["123456"]);
    expect(log.buttonQueries).toEqual([]);
    expect(log.clicks).toEqual([]);
  });
});

interface SignPrompt {
  errors: number;
  clicks: number;
  promptOpen: boolean;
  errorShown: boolean;
  waits: number[];
}

/** A fake dialog that leaves its button active over the error for the first `errors` clicks. */
function fakeSignPrompt(errors: number): { page: Page; prompt: SignPrompt } {
  const prompt: SignPrompt = { errors, clicks: 0, promptOpen: true, errorShown: false, waits: [] };

  const button = fakeLocator({
    count: async () => 1,
    isVisible: async () => prompt.promptOpen,
    click: async () => {
      prompt.clicks += 1;
      if (prompt.clicks <= prompt.errors) {
        prompt.errorShown = true;
        prompt.promptOpen = true;
      } else {
        prompt.errorShown = false;
        prompt.promptOpen = false;
      }
    },
  });

  const error = fakeLocator({
    count: async () => 1,
    isVisible: async () => prompt.errorShown,
  });

  const dialog = fakeLocator({
    getByRole: (role: string, options?: { name?: RegExp }) => {
      if (role === "button") {
        expect(options?.name?.test("Sign and continue")).toBe(true);
        return button;
      }
      return emptyLocator();
    },
    getByText: (pattern: RegExp) => {
      expect(pattern.test("An error has occurred, please try again")).toBe(true);
      return error;
    },
  });

  const page = fakeLocator({
    getByRole: (role: string) => (role === "dialog" ? dialog : emptyLocator()),
    waitForTimeout: async (ms: number) => {
      prompt.waits.push(ms);
    },
  });

  return { page: page as unknown as Page, prompt };
}

describe("the Privy signature retry", () => {
  test("an error once and then a closed prompt takes two clicks", async () => {
    const { page, prompt } = fakeSignPrompt(1);

    const clicks = await approveIfPrompted(page);

    expect(clicks).toBe(2);
    expect(prompt.clicks).toBe(2);
    expect(prompt.waits).toContain(2_000);
  });

  test("an error after three clicks throws", async () => {
    const { page, prompt } = fakeSignPrompt(3);
    let caught: unknown;

    try {
      await approveIfPrompted(page);
    } catch (error) {
      caught = error;
    }

    expect(prompt.clicks).toBe(3);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'Privy could not sign: "An error has occurred, please try again" after 3 tries',
    );
  });

  test("a prompt that closes after the first click takes one", async () => {
    const { page, prompt } = fakeSignPrompt(0);

    const clicks = await approveIfPrompted(page);

    expect(clicks).toBe(1);
    expect(prompt.clicks).toBe(1);
    expect(prompt.waits).not.toContain(2_000);
  });
});
