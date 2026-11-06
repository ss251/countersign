export const PUBLISH_SCOPE = "@countersign-hub";

export const PUBLISHABLE = ["mcp", "cli", "relay"] as const;

export type Publishable = (typeof PUBLISHABLE)[number];

export function publishedName(short: string, scope: string = PUBLISH_SCOPE): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(short)) throw new Error(`invalid package name: ${short}`);
  return `${scope}/${short}`;
}

export function tarballPrefix(short: string, scope: string = PUBLISH_SCOPE): string {
  return publishedName(short, scope).replace(/^@/, "").replace(/\//g, "-");
}
