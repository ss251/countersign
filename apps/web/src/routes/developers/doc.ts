// Vite reads the guide at build time. A missing file is an empty match, never a build error.
const files = import.meta.glob("../../../../../docs/onboarding.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const ONBOARDING: string | null = Object.values(files)[0] ?? null;
