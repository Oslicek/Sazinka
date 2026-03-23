import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { RouteSummaryActions } from './RouteSummaryActions';

// i18next is mocked globally; it returns the key as the displayed text.

describe('RouteSummaryActions', () => {

  // #1
  it('renders print button when onPrint is provided', () => {
    render(<RouteSummaryActions onPrint={vi.fn()} />);
    expect(screen.getByRole('button', { name: /actions_print/i })).toBeInTheDocument();
  });

  // #2
  it('does not render print button when onPrint is undefined', () => {
    render(<RouteSummaryActions />);
    expect(screen.queryByRole('button', { name: /actions_print/i })).toBeNull();
  });

  // #3
  it('calls onPrint on click', () => {
    const onPrint = vi.fn();
    render(<RouteSummaryActions onPrint={onPrint} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_print/i }));
    expect(onPrint).toHaveBeenCalledOnce();
  });

  // #4
  it('renders Google Maps export button when onExportGoogleMaps is provided', () => {
    render(<RouteSummaryActions onExportGoogleMaps={vi.fn()} />);
    expect(screen.getByRole('button', { name: /actions_export_gmaps/i })).toBeInTheDocument();
  });

  // #5
  it('does not render export button when onExportGoogleMaps is undefined', () => {
    render(<RouteSummaryActions />);
    expect(screen.queryByRole('button', { name: /actions_export_gmaps/i })).toBeNull();
  });

  // #6
  it('calls onExportGoogleMaps on click', () => {
    const onExportGoogleMaps = vi.fn();
    render(<RouteSummaryActions onExportGoogleMaps={onExportGoogleMaps} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export_gmaps/i }));
    expect(onExportGoogleMaps).toHaveBeenCalledOnce();
  });

  // #7
  it('export button is disabled when canExport is false', () => {
    render(<RouteSummaryActions onExportGoogleMaps={vi.fn()} canExport={false} />);
    expect(screen.getByRole('button', { name: /actions_export_gmaps/i })).toBeDisabled();
  });

  // #8
  it('print button is disabled when canPrint is false', () => {
    render(<RouteSummaryActions onPrint={vi.fn()} canPrint={false} />);
    expect(screen.getByRole('button', { name: /actions_print/i })).toBeDisabled();
  });

  // #9
  it('existing buttons still render when new props are added (regression)', () => {
    render(
      <RouteSummaryActions
        onOptimize={vi.fn()}
        onAddBreak={vi.fn()}
        onDeleteRoute={vi.fn()}
        onPrint={vi.fn()}
        onExportGoogleMaps={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /actions_optimize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_break/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_delete_route|smazat/i })).toBeInTheDocument();
  });

  // #10
  it('both Print and Export buttons render when both handlers provided', () => {
    render(<RouteSummaryActions onPrint={vi.fn()} onExportGoogleMaps={vi.fn()} />);
    expect(screen.getByRole('button', { name: /actions_print/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_export_gmaps/i })).toBeInTheDocument();
  });

  // #11
  it('neither Print nor Export button renders when neither handler is provided', () => {
    render(<RouteSummaryActions onOptimize={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /actions_print/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /actions_export_gmaps/i })).toBeNull();
  });

  // #12
  it('disabled print button does not fire onPrint on click', () => {
    const onPrint = vi.fn();
    render(<RouteSummaryActions onPrint={onPrint} canPrint={false} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_print/i }));
    expect(onPrint).not.toHaveBeenCalled();
  });

  // #13
  it('canPrint omitted with onPrint provided → button is enabled (default true)', () => {
    render(<RouteSummaryActions onPrint={vi.fn()} />);
    expect(screen.getByRole('button', { name: /actions_print/i })).not.toBeDisabled();
  });
});
