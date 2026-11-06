/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Hub origin for a static build, e.g. https://hub.example. Unset in development, where /hub is proxied. */
  readonly VITE_HUB_URL?: string;
  /** Whitechain relayer for the merchant view (cs-wc), e.g. /relay through the dev proxy. */
  readonly VITE_RELAY_URL?: string;
  /** Merchant API for the merchant view (cs-wc), e.g. /merchant-api through the dev proxy. */
  readonly VITE_MERCHANT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
