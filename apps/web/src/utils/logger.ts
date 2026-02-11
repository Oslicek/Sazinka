type LogMethod = (...args: unknown[]) => void;

const isDev = import.meta.env.DEV;

const noop: LogMethod = () => {};

export const logger: Record<'info' | 'warn' | 'error', LogMethod> = {
  info: isDev ? (...args) => console.info(...args) : noop,
  warn: isDev ? (...args) => console.warn(...args) : noop,
  error: isDev ? (...args) => console.error(...args) : noop,
};
