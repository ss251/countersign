import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  DotField,
  mountDotField,
  type DotFieldCanvas,
  type DotFieldContext,
  type DotFieldEnvironment,
} from "../src/components/DotField.tsx";

const SRC = new URL("../src/", import.meta.url).pathname;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

interface FakeEnv {
  environment: DotFieldEnvironment;
  frames(): number;
}

function fakeEnvironment(overrides: Partial<DotFieldEnvironment> = {}): FakeEnv {
  let frames = 0;
  const environment: DotFieldEnvironment = {
    reducedMotion: () => false,
    requestFrame: () => {
      frames += 1;
      return frames;
    },
    cancelFrame: () => {},
    setTimer: () => 1,
    clearTimer: () => {},
    now: () => 0,
    viewport: () => ({ width: 1000, height: 700 }),
    pixelRatio: () => 2,
    hidden: () => false,
    dotColor: () => "rgb(23, 23, 15)",
    onPointerMove: () => () => {},
    onPointerGone: () => () => {},
    onResize: () => () => {},
    onVisibility: () => () => {},
    ...overrides,
  };
  return { environment, frames: () => frames };
}

function fakeCanvas(): { canvas: DotFieldCanvas; alphas: number[] } {
  const alphas: number[] = [];
  const context: DotFieldContext = {
    globalAlpha: 1,
    fillStyle: "",
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    arc: () => {
      alphas.push(context.globalAlpha);
    },
    fill: () => {},
  };
  return {
    canvas: { width: 0, height: 0, getContext: () => context },
    alphas,
  };
}

describe("the dot field", () => {
  test("reduced motion draws the static grid once and starts no animation loop", () => {
    const { canvas, alphas } = fakeCanvas();
    const { environment, frames } = fakeEnvironment({ reducedMotion: () => true });

    const dispose = mountDotField(canvas, environment);

    expect(frames()).toBe(0);
    expect(alphas.length).toBeGreaterThan(0);
    expect(new Set(alphas)).toEqual(new Set([0.12]));

    dispose();
    expect(frames()).toBe(0);
  });

  test("the layer is inert and hidden from assistive technology", () => {
    const html = renderToString(createElement(DotField));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="dot-field"');

    const css = readFileSync(join(SRC, "components/DotField.css"), "utf8");
    const block = /\.dot-field\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("pointer-events: none;");
    expect(block).toContain("position: fixed;");
    expect(block).toContain("z-index: -1;");
  });

  test("every font is local, exists under public/fonts and swaps", () => {
    const fonts = new URL("../public/fonts/", import.meta.url);
    const faces = cssFiles(SRC).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => ({
        file: path.slice(SRC.length),
        body: match[1] ?? "",
      })),
    );

    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face.body).toContain("font-display: swap;");
      const url = /url\((?:"|')?([^"')]+)(?:"|')?\)/.exec(face.body)?.[1];
      expect(url).toBeDefined();
      expect(url).not.toMatch(/^(?:https?:)?\/\//);
      expect(url).toMatch(/^\/fonts\/[^/]+\.woff2$/);
      const file = url!.replace(/^\/fonts\//, "");
      expect(existsSync(new URL(file, fonts))).toBe(true);
    }

    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const links = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1] ?? "");
    for (const href of links) expect(href).not.toMatch(/^(?:https?:)?\/\//);

    const preloads = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font"[^>]*>/g)].map(
      (match) => match[1],
    );
    expect(preloads).toContain("/fonts/PlusJakartaSans-Regular.woff2");
    expect(preloads).toContain("/fonts/PlusJakartaSans-SemiBold.woff2");

    const tokens = readFileSync(join(SRC, "styles/tokens.css"), "utf8");
    expect(tokens).toContain('--sans: "Plus Jakarta Sans", ui-sans-serif, system-ui;');
    expect(tokens).toContain('--mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo;');
  });
});
