# Fonts

## Plus Jakarta Sans

The console's text face. Plus Jakarta Sans is by Gumpita Rahayu / Tokotype, commissioned
for the +Jakarta City of Collaboration identity (2020), and released under the SIL Open
Font License 1.1 (see `PlusJakartaSans-OFL.txt`). Files are Latin subset WOFF2 built with
`pyftsubset` from the official static webfonts in
[github.com/tokotype/PlusJakartaSans](https://github.com/tokotype/PlusJakartaSans).

Weights: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, plus 400 Italic. ~22 KB each.
The `@font-face` rules live in `apps/web/src/styles/tokens.css`; the preload links in
`apps/web/index.html` cover 400 and 600, the weights the landing reads first.

## Geist Mono

The console's mono face. Geist Mono is by Vercel in collaboration with basement.studio,
released under the SIL Open Font License 1.1 (see `GeistMono-OFL.txt`). Files are the
official WOFF2 builds from the [vercel/geist-font](https://github.com/vercel/geist-font)
release (v1.9.2).

Weights: 400 Regular and 500 Medium. ~50 KB each.

## Countersign Display

A house display face derived from Titillium Web (SIL Open Font License 1.1) by
widening the horizontal axis 2% so the letterforms sit squarer, in the manner of
the Klavika family: flat terminals, tall x-height, tight apertures. It is not
Klavika and contains no Klavika outlines. The derivative stays under the OFL,
which is why OFL.txt ships beside it.

Weights: 400 Regular, 600 SemiBold, 700 Bold. Subset to Latin-1, punctuation and
the currency signs we render. ~12 KB per weight as WOFF2.

Usage: the @font-face rules live in `apps/web/src/styles/display.css`. Body text
runs on Plus Jakarta Sans; this face is for the wordmark, the hero line and
display headings only.

