import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DynamicFieldRenderer, decodeValueJson, encodeValueJson } from './DynamicFieldRenderer';
import type { DeviceTypeField } from '@shared/deviceTypeConfig';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseField: DeviceTypeField = {
  id: 'f1',
  deviceTypeConfigId: 'cfg1',
  fieldKey: 'test_field',
  label: 'Test Field',
  fieldType: 'text',
  isRequired: false,
  isActive: true,
  sortOrder: 0,
  unit: null,
  placeholder: null,
  defaultValue: null,
  selectOptions: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const field = (overrides: Partial<DeviceTypeField>): DeviceTypeField => ({
  ...baseField,
  ...overrides,
});

// ── value helpers ─────────────────────────────────────────────────────────────

describe('decodeValueJson', () => {
  it('returns empty string for null', () => {
    expect(decodeValueJson(null, 'text')).toBe('');
  });

  it('decodes text', () => {
    expect(decodeValueJson('"hello"', 'text')).toBe('hello');
  });

  it('decodes number to string', () => {
    expect(decodeValueJson('42.5', 'number')).toBe('42.5');
  });

  it('decodes boolean true', () => {
    expect(decodeValueJson('true', 'boolean')).toBe('true');
  });

  it('decodes boolean false', () => {
    expect(decodeValueJson('false', 'boolean')).toBe('false');
  });

  it('decodes date', () => {
    expect(decodeValueJson('"2024-01-15"', 'date')).toBe('2024-01-15');
  });

  it('decodes select key', () => {
    expect(decodeValueJson('"natural_gas"', 'select')).toBe('natural_gas');
  });

  it('falls back gracefully on invalid JSON', () => {
    expect(decodeValueJson('not-json{', 'text')).toBe('not-json{');
  });
});

describe('encodeValueJson', () => {
  it('encodes text to JSON string', () => {
    expect(encodeValueJson('hello', 'text')).toBe('"hello"');
  });

  it('returns null for empty text', () => {
    expect(encodeValueJson('', 'text')).toBeNull();
  });

  it('encodes number', () => {
    expect(encodeValueJson('42.5', 'number')).toBe('42.5');
  });

  it('returns null for invalid number', () => {
    expect(encodeValueJson('abc', 'number')).toBeNull();
  });

  it('encodes boolean true', () => {
    expect(encodeValueJson('true', 'boolean')).toBe('true');
  });

  it('encodes boolean false', () => {
    expect(encodeValueJson('false', 'boolean')).toBe('false');
  });

  it('encodes date', () => {
    expect(encodeValueJson('2024-01-15', 'date')).toBe('"2024-01-15"');
  });

  it('encodes select key', () => {
    expect(encodeValueJson('natural_gas', 'select')).toBe('"natural_gas"');
  });
});

// ── DynamicFieldRenderer component ───────────────────────────────────────────

describe('DynamicFieldRenderer', () => {
  describe('text field', () => {
    it('renders a text input', () => {
      render(<DynamicFieldRenderer field={field({ fieldType: 'text' })} value="" onChange={vi.fn()} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('shows placeholder', () => {
      render(
        <DynamicFieldRenderer
          field={field({ fieldType: 'text', placeholder: 'Enter text here' })}
          value=""
          onChange={vi.fn()}
        />
      );
      expect(screen.getByPlaceholderText('Enter text here')).toBeInTheDocument();
    });

    it('calls onChange with new value', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={field({ fieldType: 'text' })} value="" onChange={onChange} />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
      expect(onChange).toHaveBeenCalledWith('hello');
    });

    it('shows required marker', () => {
      render(
        <DynamicFieldRenderer
          field={field({ fieldType: 'text', isRequired: true })}
          value=""
          onChange={vi.fn()}
        />
      );
      expect(screen.getByText('*', { exact: false })).toBeInTheDocument();
    });
  });

  describe('number field', () => {
    it('renders a number input', () => {
      render(<DynamicFieldRenderer field={field({ fieldType: 'number' })} value="" onChange={vi.fn()} />);
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('shows unit suffix', () => {
      render(
        <DynamicFieldRenderer
          field={field({ fieldType: 'number', unit: 'kWh' })}
          value="100"
          onChange={vi.fn()}
        />
      );
      expect(screen.getByText('kWh')).toBeInTheDocument();
    });

    it('calls onChange with string value', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={field({ fieldType: 'number' })} value="" onChange={onChange} />);
      fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });
      expect(onChange).toHaveBeenCalledWith('42');
    });
  });

  describe('date field', () => {
    it('renders a date input', () => {
      render(<DynamicFieldRenderer field={field({ fieldType: 'date' })} value="" onChange={vi.fn()} />);
      const input = screen.getByDisplayValue('');
      expect(input).toHaveAttribute('type', 'date');
    });

    it('calls onChange with date string', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={field({ fieldType: 'date' })} value="" onChange={onChange} />);
      fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2024-03-15' } });
      expect(onChange).toHaveBeenCalledWith('2024-03-15');
    });
  });

  describe('boolean field', () => {
    it('renders a checkbox', () => {
      render(<DynamicFieldRenderer field={field({ fieldType: 'boolean' })} value="false" onChange={vi.fn()} />);
      expect(screen.getByRole('checkbox')).toBeInTheDocument();
    });

    it('is checked when value is true', () => {
      render(<DynamicFieldRenderer field={field({ fieldType: 'boolean' })} value="true" onChange={vi.fn()} />);
      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('calls onChange with true when checked', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={field({ fieldType: 'boolean' })} value="false" onChange={onChange} />);
      fireEvent.click(screen.getByRole('checkbox'));
      expect(onChange).toHaveBeenCalledWith('true');
    });

    it('calls onChange with false when unchecked', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={field({ fieldType: 'boolean' })} value="true" onChange={onChange} />);
      fireEvent.click(screen.getByRole('checkbox'));
      expect(onChange).toHaveBeenCalledWith('false');
    });
  });

  describe('select field', () => {
    const selectField = field({
      fieldType: 'select',
      selectOptions: [
        { key: 'natural_gas', label: 'Zemní plyn', isDeprecated: false },
        { key: 'propane', label: 'Propan', isDeprecated: false },
        { key: 'old_type', label: 'Starý typ', isDeprecated: true },
      ],
    });

    it('renders a select element', () => {
      render(<DynamicFieldRenderer field={selectField} value="" onChange={vi.fn()} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders all options including deprecated', () => {
      render(<DynamicFieldRenderer field={selectField} value="" onChange={vi.fn()} />);
      expect(screen.getByText('Zemní plyn')).toBeInTheDocument();
      expect(screen.getByText('Propan')).toBeInTheDocument();
    });

    it('marks deprecated options', () => {
      render(<DynamicFieldRenderer field={selectField} value="" onChange={vi.fn()} />);
      expect(screen.getByText(/Starý typ.*device_field_deprecated/)).toBeInTheDocument();
    });

    it('calls onChange with selected key', () => {
      const onChange = vi.fn();
      render(<DynamicFieldRenderer field={selectField} value="" onChange={onChange} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'natural_gas' } });
      expect(onChange).toHaveBeenCalledWith('natural_gas');
    });

    it('shows selected value', () => {
      render(<DynamicFieldRenderer field={selectField} value="propane" onChange={vi.fn()} />);
      expect(screen.getByRole('combobox')).toHaveValue('propane');
    });
  });

  describe('disabled state', () => {
    it('disables text input when disabled=true', () => {
      render(
        <DynamicFieldRenderer field={field({ fieldType: 'text' })} value="" onChange={vi.fn()} disabled />
      );
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('disables checkbox when disabled=true', () => {
      render(
        <DynamicFieldRenderer field={field({ fieldType: 'boolean' })} value="false" onChange={vi.fn()} disabled />
      );
      expect(screen.getByRole('checkbox')).toBeDisabled();
    });
  });
});
