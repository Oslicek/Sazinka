import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeviceTypeConfigManager } from './DeviceTypeConfigManager';
import type { DeviceTypeConfig, DeviceTypeField } from '@shared/deviceTypeConfig';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../services/deviceTypeConfigService', () => ({
  listDeviceTypeConfigs: vi.fn(),
  updateDeviceTypeConfig: vi.fn(),
  createDeviceTypeField: vi.fn(),
  updateDeviceTypeField: vi.fn(),
  setFieldActive: vi.fn(),
  reorderFields: vi.fn(),
}));

import * as service from '../../services/deviceTypeConfigService';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockField: DeviceTypeField = {
  id: 'field-1',
  deviceTypeConfigId: 'config-1',
  fieldKey: 'meter_reading',
  label: 'Stav měřiče',
  fieldType: 'number',
  isRequired: false,
  isActive: true,
  sortOrder: 0,
  unit: 'kWh',
  placeholder: null,
  defaultValue: null,
  selectOptions: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockConfig: DeviceTypeConfig = {
  id: 'config-1',
  tenantId: 'tenant-1',
  deviceTypeKey: 'gas_meter',
  label: 'Plynoměr',
  icon: null,
  isActive: true,
  isBuiltin: true,
  defaultRevisionDurationMinutes: 60,
  defaultRevisionIntervalMonths: 12,
  sortOrder: 0,
  fields: [mockField],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockInactiveConfig: DeviceTypeConfig = {
  ...mockConfig,
  id: 'config-2',
  deviceTypeKey: 'old_device',
  label: 'Starý typ',
  isActive: false,
  fields: [],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DeviceTypeConfigManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(service.listDeviceTypeConfigs).mockResolvedValue([mockConfig, mockInactiveConfig]);
    vi.mocked(service.updateDeviceTypeConfig).mockResolvedValue({ ...mockConfig, isActive: false });
    vi.mocked(service.createDeviceTypeField).mockResolvedValue(mockField);
    vi.mocked(service.updateDeviceTypeField).mockResolvedValue(mockField);
    vi.mocked(service.setFieldActive).mockResolvedValue({ ...mockField, isActive: false });
    vi.mocked(service.reorderFields).mockResolvedValue(true);
  });

  describe('loading and rendering', () => {
    it('shows loading state initially', () => {
      vi.mocked(service.listDeviceTypeConfigs).mockReturnValue(new Promise(() => {}));
      render(<DeviceTypeConfigManager />);
      expect(screen.getByText('loading')).toBeInTheDocument();
    });

    it('renders active configs after load', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => {
        expect(screen.getByText('Plynoměr')).toBeInTheDocument();
      });
    });

    it('hides inactive configs by default', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => {
        expect(screen.getByText('Plynoměr')).toBeInTheDocument();
      });
      expect(screen.queryByText('Starý typ')).not.toBeInTheDocument();
    });

    it('shows inactive configs when toggle is checked', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => {
        expect(screen.getByText('Plynoměr')).toBeInTheDocument();
      });
      const toggle = screen.getByRole('checkbox', { name: 'dt_show_inactive' });
      fireEvent.click(toggle);
      await waitFor(() => {
        expect(screen.getByText('Starý typ')).toBeInTheDocument();
      });
    });

    it('shows error message on load failure', async () => {
      vi.mocked(service.listDeviceTypeConfigs).mockRejectedValue(new Error('network'));
      render(<DeviceTypeConfigManager />);
      await waitFor(() => {
        expect(screen.getByText('dt_error_load')).toBeInTheDocument();
      });
    });

    it('calls listDeviceTypeConfigs with includeInactive: true', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => {
        expect(service.listDeviceTypeConfigs).toHaveBeenCalledWith({ includeInactive: true });
      });
    });
  });

  describe('toggle active/inactive', () => {
    it('calls updateDeviceTypeConfig with isActive: false when deactivating', async () => {
      vi.mocked(service.updateDeviceTypeConfig).mockResolvedValue({
        ...mockConfig,
        isActive: false,
      });
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      const deactivateButtons = screen.getAllByText('dt_deactivate');
      fireEvent.click(deactivateButtons[0]);

      await waitFor(() => {
        expect(service.updateDeviceTypeConfig).toHaveBeenCalledWith('config-1', {
          isActive: false,
        });
      });
    });

    it('shows error when toggle fails', async () => {
      vi.mocked(service.updateDeviceTypeConfig).mockRejectedValue(new Error('fail'));
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      fireEvent.click(screen.getAllByText('dt_deactivate')[0]);

      await waitFor(() => {
        expect(screen.getByText('dt_error_update')).toBeInTheDocument();
      });
    });
  });

  describe('edit config meta', () => {
    it('shows edit form when Edit button is clicked', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      fireEvent.click(screen.getAllByText('edit')[0]);

      expect(screen.getByDisplayValue('Plynoměr')).toBeInTheDocument();
      expect(screen.getByDisplayValue('60')).toBeInTheDocument();
      expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    });

    it('saves updated label when save_changes is clicked', async () => {
      vi.mocked(service.updateDeviceTypeConfig).mockResolvedValue({
        ...mockConfig,
        label: 'Nový název',
      });
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      fireEvent.click(screen.getAllByText('edit')[0]);

      const labelInput = screen.getByDisplayValue('Plynoměr');
      fireEvent.change(labelInput, { target: { value: 'Nový název' } });
      fireEvent.click(screen.getByText('save_changes'));

      await waitFor(() => {
        expect(service.updateDeviceTypeConfig).toHaveBeenCalledWith(
          'config-1',
          expect.objectContaining({ label: 'Nový název' })
        );
      });
    });

    it('cancels edit without saving', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      fireEvent.click(screen.getAllByText('edit')[0]);
      expect(screen.getByDisplayValue('Plynoměr')).toBeInTheDocument();

      fireEvent.click(screen.getByText('common:cancel'));

      expect(screen.queryByDisplayValue('Plynoměr')).not.toBeInTheDocument();
      expect(service.updateDeviceTypeConfig).not.toHaveBeenCalled();
    });
  });

  describe('fields panel', () => {
    it('expands fields section when config is clicked', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));

      fireEvent.click(screen.getByText('Plynoměr'));

      expect(screen.getByText('Stav měřiče')).toBeInTheDocument();
    });

    it('shows Add field button in expanded view', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));

      expect(screen.getByText('dt_add_field')).toBeInTheDocument();
    });

    it('shows add field form when add button is clicked', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('dt_add_field'));

      expect(screen.getByPlaceholderText('dt_field_key_placeholder')).toBeInTheDocument();
    });
  });

  describe('add field', () => {
    it('calls createDeviceTypeField with correct payload', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('dt_add_field'));

      const inputs = screen.getAllByRole('textbox');
      // inputs[0] = fieldKey, inputs[1] = label
      fireEvent.change(inputs[0], { target: { value: 'pressure' } });
      fireEvent.change(inputs[1], { target: { value: 'Tlak' } });

      fireEvent.click(screen.getByText('dt_field_create'));

      await waitFor(() => {
        expect(service.createDeviceTypeField).toHaveBeenCalledWith(
          expect.objectContaining({
            deviceTypeConfigId: 'config-1',
            fieldKey: 'pressure',
          })
        );
      });
    });

    it('shows error when key/label are empty', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('dt_add_field'));

      fireEvent.click(screen.getByText('dt_field_create'));

      expect(screen.getByText('dt_field_error_required')).toBeInTheDocument();
      expect(service.createDeviceTypeField).not.toHaveBeenCalled();
    });
  });

  describe('field toggle active', () => {
    it('calls setFieldActive with inverted value', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));

      // When expanded there are two dt_deactivate buttons: config-level and field-level.
      // The field-level button is the last one.
      await waitFor(() => screen.getByText('Stav měřiče'));
      const deactivateBtns = screen.getAllByText('dt_deactivate');
      fireEvent.click(deactivateBtns[deactivateBtns.length - 1]);

      await waitFor(() => {
        expect(service.setFieldActive).toHaveBeenCalledWith('field-1', false);
      });
    });
  });

  describe('field reorder', () => {
    const field2: DeviceTypeField = {
      ...mockField,
      id: 'field-2',
      fieldKey: 'pressure',
      label: 'Tlak',
      sortOrder: 1,
    };

    beforeEach(() => {
      vi.mocked(service.listDeviceTypeConfigs).mockResolvedValue([
        { ...mockConfig, fields: [mockField, field2] },
      ]);
    });

    it('calls reorderFields when move up is clicked on second item', async () => {
      render(<DeviceTypeConfigManager />);
      await waitFor(() => screen.getByText('Plynoměr'));
      fireEvent.click(screen.getByText('Plynoměr'));

      await waitFor(() => screen.getByText('Tlak'));

      const moveUpButtons = screen.getAllByTitle('dt_move_up');
      fireEvent.click(moveUpButtons[1]);

      await waitFor(() => {
        expect(service.reorderFields).toHaveBeenCalledWith('config-1', ['field-2', 'field-1']);
      });
    });
  });
});
