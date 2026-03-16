import { useRef } from 'react';

const DEFAULT_FEATURES = 'width=900,height=700,menubar=no,toolbar=no';

interface DetachButtonProps {
  panelUrl: string;
  windowName: string;
  windowFeatures?: string;
  onDetach?: () => void;
  className?: string;
}

export function DetachButton({
  panelUrl,
  windowName,
  windowFeatures = DEFAULT_FEATURES,
  onDetach,
  className,
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
    <button type="button" onClick={handleClick} aria-label="Open in new window" title="Open in new window" className={className}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </button>
  );
}
