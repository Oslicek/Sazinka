let _supported: boolean | null = null;

export function isWebGLSupported(): boolean {
  if (_supported !== null) return _supported;

  try {
    const canvas = document.createElement('canvas');
    const ctx =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    _supported = !!ctx;
  } catch {
    _supported = false;
  }

  return _supported;
}
