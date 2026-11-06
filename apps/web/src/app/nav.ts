export type NavGroup = "buy" | "sell" | "check";

/** The top bar folds the views into three groups, by why someone came: to buy, to sell, or to check. */
export const GROUPS: readonly { id: NavGroup; label: string }[] = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "check", label: "Check" },
];
