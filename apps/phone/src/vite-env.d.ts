/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The hub this page talks to by default. A public URL, never a secret. */
  readonly VITE_HUB_URL?: string;
  /** Where slip and offer links open. A public URL, never a secret. */
  readonly VITE_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
