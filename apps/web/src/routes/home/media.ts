/**
 * The landing's footage (STEER-0115): the hero plate and the two rail stings, from apps/web/public/media,
 * copied byte-identical from the reviewed set with its manifest. Every clip is decoration with a poster
 * under it: the page never waits on a byte of video, and a clip that fails leaves its poster.
 */

/** Relative to the document, like every other asset: the build runs from any host or folder. */
export const MEDIA = `${import.meta.env?.BASE_URL ?? "./"}media/`;

export type Clip = "hero" | "sting-arc" | "sting-whitechain";

/**
 * The file this browser should fetch: VP9 WebM where the browser is sure it plays it (it is the smaller
 * file), H.264 MP4 everywhere else, which every current browser plays, iOS included. Null when neither.
 */
export function clipSource(clip: Clip, canPlay: (type: string) => string): string | null {
  if (canPlay('video/webm; codecs="vp9"') === "probably") return `${MEDIA}${clip}.webm`;
  if (canPlay('video/mp4; codecs="avc1.42E01E"') !== "" || canPlay("video/mp4") !== "") return `${MEDIA}${clip}.mp4`;
  return null;
}

/** The browser's own answer, or none where there is no DOM (tests, the server). */
export function browserCanPlay(type: string): string {
  if (typeof document === "undefined") return "";
  return document.createElement("video").canPlayType(type);
}

/**
 * Whether a clip's <video> exists at all. Never under reduced motion (the poster is the whole plate then),
 * and never again once it has failed: a 404 or a decode error leaves the poster, and nothing else changes.
 */
export function showsVideo(reduced: boolean, failed: boolean): boolean {
  return !reduced && !failed;
}

/**
 * A dev-only way to prove the failure path in a browser: `?plate-src=<url>` on the dev server replaces the
 * hero's file, e.g. with one that 404s. Production builds ignore it.
 */
export function devPlateSource(): string | null {
  if (!import.meta.env?.DEV || typeof window === "undefined") return null;
  const hash = window.location.hash;
  const q = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : window.location.search);
  return q.get("plate-src");
}
