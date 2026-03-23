import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { RouteSummaryActions } from './RouteSummaryActions';
import type { ExportTarget } from './RouteSummaryActions';

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

  // #4 — export split button renders when onExport is provided
  it('renders export split button when onExport is provided', () => {
    render(<RouteSummaryActions onExport={vi.fn()} />);
    expect(screen.getByRole('button', { name: /actions_export$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_export_more/i })).toBeInTheDocument();
  });

  // #5 — clicking primary export button calls onExport with google_maps
  it('primary export button calls onExport with google_maps', () => {
    const onExport = vi.fn();
    render(<RouteSummaryActions onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export$/i }));
    expect(onExport).toHaveBeenCalledWith('google_maps');
  });

  // #6 — dropdown shows Google Maps and Mapy.cz options
  it('dropdown shows Google Maps and Mapy.cz options', () => {
    render(<RouteSummaryActions onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export_more/i }));
    expect(screen.getByRole('menuitem', { name: /actions_export_gmaps/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /actions_export_mapycz/i })).toBeInTheDocument();
  });

  // #7 — selecting Mapy.cz from dropdown calls onExport with mapy_cz
  it('selecting Mapy.cz from dropdown calls onExport with mapy_cz', () => {
    const onExport = vi.fn();
    render(<RouteSummaryActions onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export_more/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /actions_export_mapycz/i }));
    expect(onExport).toHaveBeenCalledWith('mapy_cz');
  });

  // #8 — dropdown closes after selecting an option
  it('dropdown closes after selecting an option', () => {
    render(<RouteSummaryActions onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export_more/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /actions_export_gmaps/i }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // #9 — export buttons disabled when canExport is false
  it('export buttons disabled when canExport is false', () => {
    render(<RouteSummaryActions onExport={vi.fn()} canExport={false} />);
    expect(screen.getByRole('button', { name: /actions_export$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /actions_export_more/i })).toBeDisabled();
  });

  // #10
  it('print button is disabled when canPrint is false', () => {
    render(<RouteSummaryActions onPrint={vi.fn()} canPrint={false} />);
    expect(screen.getByRole('button', { name: /actions_print/i })).toBeDisabled();
  });

  // #11
  it('existing buttons still render when new props are added (regression)', () => {
    render(
      <RouteSummaryActions
        onOptimize={vi.fn()}
        onAddBreak={vi.fn()}
        onDeleteRoute={vi.fn()}
        onPrint={vi.fn()}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /actions_optimize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_break/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions_delete_route|smazat/i })).toBeInTheDocument();
  });

  // #12 — backward compat: onExportGoogleMaps still works via primary click
  it('backward compat: onExportGoogleMaps fires on primary export click', () => {
    const onExportGoogleMaps = vi.fn();
    render(<RouteSummaryActions onExportGoogleMaps={onExportGoogleMaps} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export$/i }));
    expect(onExportGoogleMaps).toHaveBeenCalledOnce();
  });

  // #13
  it('disabled print button does not fire onPrint on click', () => {
    const onPrint = vi.fn();
    render(<RouteSummaryActions onPrint={onPrint} canPrint={false} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_print/i }));
    expect(onPrint).not.toHaveBeenCalled();
  });

  // #14 — no export buttons when neither handler provided
  it('no export buttons when neither onExport nor onExportGoogleMaps provided', () => {
    render(<RouteSummaryActions onOptimize={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /actions_export/i })).toBeNull();
  });

  // #15 — dropdown closes on outside click
  it('dropdown closes on outside click', () => {
    render(<RouteSummaryActions onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /actions_export_more/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
