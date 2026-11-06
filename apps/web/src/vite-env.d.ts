/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Hub origin for a static build, e.g. https://hub.example. Unset in development, where /hub is proxied. */
  readonly VITE_HUB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
