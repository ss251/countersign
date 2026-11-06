import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { clipSource, showsVideo } from "../src/routes/home/media.ts";
import { HeroPlate } from "../src/routes/home/Plate.tsx";
import { RailSting } from "../src/routes/home/Sting.tsx";

// STEER-0115: the cinematic plate. A broken video is worse than no video, so every clip sits on its poster,
// is asked for only after first paint, and is never there at all under reduced motion.

const plate = (reduced: boolean) => renderToString(createElement(HeroPlate, { reduced }));
const sting = (reduced: boolean) =>
  renderToString(createElement(RailSting, { rail: "arc", line: "On Arc, an escrow contract holds the payment.", reduced }));

describe("the hero plate", () => {
  test("under reduced motion there is no <video> at all: the poster is the plate", () => {
    const html = plate(true);
    expect(html).not.toContain("<video");
    expect(html).toContain("media/hero-poster.jpg");
    expect(html).toContain("payments that only move when the work lands.");
  });

  test("the poster paints first and the loop has no src until after first paint", () => {
    const html = plate(false);
    expect(html).toContain("media/hero-poster.jpg");
    const video = html.match(/<video[^>]*>/)?.[0] ?? "";
    expect(video).not.toBe("");
    expect(video).toContain('preload="none"');
    expect(video).toContain("playsInline");
    expect(video).toContain("loop");
    expect(video).not.toMatch(/\ssrc=/);
    expect(video).not.toMatch(/autoplay/i);
    // The poster comes before the clip in the frame, so it paints first.
    expect(html.indexOf("plate__poster")).toBeLessThan(html.indexOf("<video"));
  });

  test("one line of type, and nothing else on the plate", () => {
    const html = plate(false);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toMatch(/<p[\s>]|badge/);
  });

  test("a clip that fails leaves the poster: the video is dropped and nothing else changes", () => {
    expect(showsVideo(false, false)).toBe(true);
    expect(showsVideo(false, true)).toBe(false);
    expect(showsVideo(true, false)).toBe(false);
  });
});

describe("the rail stings", () => {
  test("under reduced motion they are posters only", () => {
    const html = sting(true);
    expect(html).not.toContain("<video");
    expect(html).toContain("media/sting-arc-poster.jpg");
  });

  test("the clip waits for the beat to arrive: no src until it is in view, and it plays once, never looped", () => {
    const video = sting(false).match(/<video[^>]*>/)?.[0] ?? "";
    expect(video).toContain('preload="none"');
    expect(video).not.toMatch(/\ssrc=/);
    expect(video).not.toMatch(/\sloop/);
  });
});

describe("which file a browser fetches", () => {
  test("VP9 WebM only where the browser is sure; H.264 MP4 everywhere else; nothing when neither plays", () => {
    const yes = (answers: Record<string, string>) => (type: string) => answers[type] ?? "";
    expect(clipSource("hero", yes({ 'video/webm; codecs="vp9"': "probably" }))).toMatch(/media\/hero\.webm$/);
    expect(clipSource("hero", yes({ 'video/webm; codecs="vp9"': "maybe", "video/mp4": "maybe" }))).toMatch(/media\/hero\.mp4$/);
    expect(clipSource("sting-arc", yes({ 'video/mp4; codecs="avc1.42E01E"': "probably" }))).toMatch(/media\/sting-arc\.mp4$/);
    expect(clipSource("hero", yes({}))).toBeNull();
  });
});

describe("the media, as reviewed", () => {
  const dir = new URL("../public/media", import.meta.url).pathname;

  test("every file the manifest lists is here at exactly its byte size", async () => {
    const manifest = (await Bun.file(join(dir, "manifest.json")).json()) as { assets: Array<{ files: Record<string, number> }> };
    const listed = manifest.assets.flatMap((a) => Object.entries(a.files));
    expect(listed.length).toBeGreaterThanOrEqual(13);
    for (const [file, bytes] of listed) expect({ file, bytes: statSync(join(dir, file)).size }).toEqual({ file, bytes });
  });

  test("the plate's files and the two placed stings are all present", () => {
    const files = new Set(readdirSync(dir));
    for (const f of ["hero.webm", "hero.mp4", "hero-poster.jpg", "og.jpg", "sting-arc.webm", "sting-arc.mp4", "sting-arc-poster.jpg", "sting-whitechain.webm", "sting-whitechain.mp4", "sting-whitechain-poster.jpg"]) {
      expect({ f, present: files.has(f) }).toEqual({ f, present: true });
    }
  });
});

describe("the line's contrast through the scrim", () => {
  // WCAG relative luminance, and the browser's sRGB compositing of a flat ink layer at 30%.
  const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const L = ([r, g, b]: number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  const over = (px: number[], ink: number[], a: number) => px.map((p, i) => a * ink[i]! + (1 - a) * p);

  test("is at least 7:1 against the brightest poster pixel behind it (rgb 80,80,78, measured)", () => {
    const text = [0xef, 0xed, 0xe6];
    const bg = over([80, 80, 78], [0x0a, 0x0a, 0x09], 0.3);
    const ratio = (L(text) + 0.05) / (L(bg) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(7);
    expect(Math.round(ratio * 100) / 100).toBe(9.58);
  });
});
