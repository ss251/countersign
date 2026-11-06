/** The slip hash a console link names, or undefined when the link is not `#/verify/<hash>`. */
export function slipHashFromHref(href: string): string | undefined {
  const match = /#\/verify\/(0x[0-9a-fA-F]{64})$/.exec(href);
  return match?.[1];
}
