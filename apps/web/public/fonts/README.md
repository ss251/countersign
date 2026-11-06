# Fonts

## Plus Jakarta Sans (in use)

`PlusJakartaSans-Variable.woff2`: Plus Jakarta Sans by Tokotype, the variable
weight axis 200 to 800, Latin subset (from `@fontsource-variable/plus-jakarta-sans`
5.1.1). SIL Open Font License 1.1, in `OFL-PlusJakartaSans.txt`.

It is the console's one face, for display and body alike (`--sans` and
`--display` in `src/styles/tokens.css`). The stack names `gordita` first: Gordita
is commercial and is not shipped here, so it shows only on a machine that has it
installed. Hashes, addresses and code stay on `--mono`.

## Countersign Display (no longer referenced)

A house display face derived from Titillium Web (SIL Open Font License 1.1) by
widening the horizontal axis 2% so the letterforms sit squarer, in the manner of
the Klavika family: flat terminals, tall x-height, tight apertures. It is not
Klavika and contains no Klavika outlines. The derivative stays under the OFL,
which is why OFL.txt ships beside it.

Weights: 400 Regular, 600 SemiBold, 700 Bold. Subset to Latin-1, punctuation and
the currency signs we render. ~12 KB per weight as WOFF2.

Usage: the @font-face rules live in `apps/web/src/styles/display.css`. Body text
should stay on the system stack; this face is for the wordmark, the hero line and
display headings only.
