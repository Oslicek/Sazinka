/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

interface ImportMetaEnv {
  readonly VITE_NATS_WS_URL: string;
  readonly VITE_NATS_USER: string;
  readonly VITE_NATS_PASS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
