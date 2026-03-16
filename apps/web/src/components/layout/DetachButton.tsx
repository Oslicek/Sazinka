import { useRef } from 'react';

const DEFAULT_FEATURES = 'width=900,height=700,menubar=no,toolbar=no';

interface DetachButtonProps {
  panelUrl: string;
  windowName: string;
  windowFeatures?: string;
  onDetach?: () => void;
}

export function DetachButton({
  panelUrl,
  windowName,
  windowFeatures = DEFAULT_FEATURES,
  onDetach,
}: DetachButtonProps) {
  const winRef = useRef<Window | null>(null);

  const handleClick = () => {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.focus();
      return;
    }

    const win = window.open(panelUrl, windowName, windowFeatures);
    if (!win) {
      console.warn(`DetachButton: popup blocked for "${windowName}"`);
      return;
    }

    winRef.current = win;
    onDetach?.();
  };

  return (
    <button type="button" onClick={handleClick} aria-label="Open in new window" title="Open in new window">
      ↗
    </button>
  );
}
