import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DraftModeBar } from './DraftModeBar';

describe('DraftModeBar (auto-save)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render nothing when no changes and never saved', () => {
    const { container } = render(
      <DraftModeBar hasChanges={false} isSaving={false} lastSaved={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should show saving indicator when isSaving is true', () => {
    render(
      <DraftModeBar hasChanges={true} isSaving={true} lastSaved={null} />
    );
    expect(screen.getByText('Ukládám...')).toBeInTheDocument();
  });

  it('should show "Uloženo" with time when lastSaved is set', () => {
    const now = new Date();
    render(
      <DraftModeBar hasChanges={false} isSaving={false} lastSaved={now} />
    );
    expect(screen.getByText(/uloženo/i)).toBeInTheDocument();
  });

  it('should show "právě teď" for very recent saves', () => {
    const now = new Date();
    render(
      <DraftModeBar hasChanges={false} isSaving={false} lastSaved={now} />
    );
    expect(screen.getByText(/právě teď/i)).toBeInTheDocument();
  });

  it('should show error state with retry button when saveError is set', () => {
    render(
      <DraftModeBar
        hasChanges={true}
        isSaving={false}
        lastSaved={null}
        saveError="Network error"
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/nepodařilo se uložit/i)).toBeInTheDocument();
    expect(screen.getByText(/zkusit znovu/i)).toBeInTheDocument();
  });

  it('should call onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(
      <DraftModeBar
        hasChanges={true}
        isSaving={false}
        lastSaved={null}
        saveError="Network error"
        onRetry={onRetry}
      />
    );
    screen.getByText(/zkusit znovu/i).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('should not show manual save or discard buttons (auto-save mode)', () => {
    render(
      <DraftModeBar hasChanges={true} isSaving={false} lastSaved={null} />
    );
    expect(screen.queryByText('Uložit')).not.toBeInTheDocument();
    expect(screen.queryByText('Zahodit')).not.toBeInTheDocument();
  });

  it('should show pending save indicator when hasChanges but not yet saving', () => {
    render(
      <DraftModeBar hasChanges={true} isSaving={false} lastSaved={null} />
    );
    // Should show a subtle indicator that changes are queued
    expect(screen.getByText(/neuložené změny/i)).toBeInTheDocument();
  });
});
