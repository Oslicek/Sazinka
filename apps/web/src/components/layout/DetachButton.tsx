interface DetachButtonProps {
  /** Called when the button is clicked — caller manages window.open */
  onDetach: () => void;
  className?: string;
  'data-testid'?: string;
}

export function DetachButton({
  onDetach,
  className,
  'data-testid': testId,
}: DetachButtonProps) {
  return (
    <button
      type="button"
      onClick={onDetach}
      aria-label="Open in new window"
      title="Open in new window"
      className={className}
      data-testid={testId}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </button>
  );
}
