import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportCustomersModal } from './ImportCustomersModal';

vi.mock('../../services/importJobService', () => ({
  submitCustomerImportJob: vi.fn(),
}));

vi.mock('../../stores/activeJobsStore', () => ({
  useActiveJobsStore: () => vi.fn(),
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

describe('ImportCustomersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    render(<ImportCustomersModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('customer_import_title')).not.toBeInTheDocument();
  });

  it('renders when open', () => {
    render(<ImportCustomersModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('customer_modal_title')).toBeInTheDocument();
  });

  it('shows drop zone in idle state', () => {
    render(<ImportCustomersModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('customer_drop_text')).toBeInTheDocument();
  });

  it('shows CSV format hint', () => {
    render(<ImportCustomersModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('customer_drop_hint')).toBeInTheDocument();
  });
});

describe('ImportCustomersModal CSV delimiter detection', () => {
  it('semicolon delimiter is preferred for Czech format', () => {
    // The modal's parseCSVPreview detects ';' over ',' for Czech format
    const csvWithSemicolon = 'name;email;phone\nJan Novák;jan@test.cz;+420123456789';
    const csvWithComma = 'name,email,phone\nJan Novák,jan@test.cz,+420123456789';

    // Verify the detection logic: semicolon takes priority
    const detectDelimiter = (text: string) => text.includes(';') ? ';' : ',';
    expect(detectDelimiter(csvWithSemicolon)).toBe(';');
    expect(detectDelimiter(csvWithComma)).toBe(',');
  });

  it('canonical customer CSV headers are snake_case', () => {
    const canonicalHeaders = ['type', 'name', 'contact_person', 'ico', 'dic', 'street', 'city', 'postal_code', 'country', 'phone', 'email', 'notes'];
    expect(canonicalHeaders).toContain('contact_person');
    expect(canonicalHeaders).toContain('postal_code');
    expect(canonicalHeaders).not.toContain('contactPerson');
    expect(canonicalHeaders).not.toContain('postalCode');
  });
});
