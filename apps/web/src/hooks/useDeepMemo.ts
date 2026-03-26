import { useRef } from 'react';

/**
 * Like `useMemo`, but uses deep equality (JSON serialization) for the
 * dependency comparison instead of referential identity.
 *
 * Useful when dependencies are arrays/objects that may be structurally
 * identical but have a new reference on every render (e.g. values from
 * the persistence layer).
 */
export function useDeepMemo<T>(factory: () => T, deps: unknown[]): T {
  const ref = useRef<{ value: T; key: string } | null>(null);
  const key = JSON.stringify(deps);

  if (!ref.current || ref.current.key !== key) {
    ref.current = { value: factory(), key };
  }

  return ref.current.value;
}
