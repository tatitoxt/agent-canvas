/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANVAS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
