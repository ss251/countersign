/**
 * A seller has no logo, only an address. This draws the address itself: a 5×5 grid mirrored down
 * the middle, each cell set by one hex digit, in ink. The same address always makes the same mark,
 * so a reader learns to recognise a seller without anyone choosing a picture for it.
 */
export function AddressGlyph({ address, size = 28 }: { address: string; size?: number }) {
  const hex = address.replace(/^0x/i, "").toLowerCase().padEnd(15, "0");
  const cells: Array<[number, number]> = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const digit = parseInt(hex[row * 3 + col] ?? "0", 16);
      if (digit >= 8) {
        cells.push([col, row]);
        if (col < 2) cells.push([4 - col, row]);
      }
    }
  }
  return (
    <svg className="glyph" viewBox="0 0 29 29" width={size} height={size} aria-hidden="true" focusable="false">
      <rect className="glyph__frame" x="0.5" y="0.5" width="28" height="28" rx="3" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} className="glyph__cell" x={3 + x * 5} y={3 + y * 5} width="4" height="4" rx="0.5" />
      ))}
    </svg>
  );
}
