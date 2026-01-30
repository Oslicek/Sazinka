import { useState, useEffect, useCallback } from 'react';
import type { Device } from '@shared/device';
import { DEVICE_TYPE_LABELS } from '@shared/device';
import { listDevices, deleteDevice } from '../../services/deviceService';
import { useNatsStore } from '../../stores/natsStore';
import { DeviceForm } from './DeviceForm';
import styles from './DeviceList.module.css';

interface DeviceListProps {
  customerId: string;
  userId: string;
  onDeviceSelect?: (device: Device) => void;
}

export function DeviceList({ customerId, userId, onDeviceSelect }: DeviceListProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const loadDevices = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await listDevices(userId, customerId);
      setDevices(response.items);
    } catch (err) {
      console.error('Failed to load devices:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zařízení');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, userId, customerId]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const handleAddClick = useCallback(() => {
    setEditingDevice(null);
    setShowForm(true);
  }, []);

  const handleEditClick = useCallback((device: Device) => {
    setEditingDevice(device);
    setShowForm(true);
  }, []);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingDevice(null);
  }, []);

  const handleFormSuccess = useCallback(() => {
    setShowForm(false);
    setEditingDevice(null);
    loadDevices();
  }, [loadDevices]);

  const handleDeleteClick = useCallback(async (device: Device) => {
    if (!confirm(`Opravdu chcete smazat zařízení "${DEVICE_TYPE_LABELS[device.deviceType as keyof typeof DEVICE_TYPE_LABELS] || device.deviceType}"?`)) {
      return;
    }

    try {
      setDeletingDeviceId(device.id);
      setError(null);
      await deleteDevice(userId, device.id, customerId);
      loadDevices();
    } catch (err) {
      console.error('Failed to delete device:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se smazat zařízení');
    } finally {
      setDeletingDeviceId(null);
    }
  }, [userId, customerId, loadDevices]);

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('cs-CZ');
    } catch {
      return dateStr;
    }
  };

  if (showForm) {
    return (
      <DeviceForm
        customerId={customerId}
        userId={userId}
        device={editingDevice ?? undefined}
        onSuccess={handleFormSuccess}
        onCancel={handleFormClose}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Zařízení</h3>
        <button 
          className={styles.addButton} 
          onClick={handleAddClick}
          disabled={!isConnected}
        >
          + Přidat zařízení
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isLoading ? (
        <div className={styles.loading}>Načítám zařízení...</div>
      ) : devices.length === 0 ? (
        <div className={styles.empty}>
          <p>Žádná zařízení</p>
          <p className={styles.emptyHint}>Přidejte první zařízení pro tohoto zákazníka.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {devices.map((device) => (
            <div 
              key={device.id} 
              className={styles.deviceCard}
              onClick={() => onDeviceSelect?.(device)}
            >
              <div className={styles.deviceInfo}>
                <div className={styles.deviceType}>
                  {DEVICE_TYPE_LABELS[device.deviceType as keyof typeof DEVICE_TYPE_LABELS] || device.deviceType}
                </div>
                <div className={styles.deviceDetails}>
                  {device.manufacturer && device.model ? (
                    <span className={styles.manufacturerModel}>
                      {device.manufacturer} {device.model}
                    </span>
                  ) : device.manufacturer || device.model ? (
                    <span className={styles.manufacturerModel}>
                      {device.manufacturer || device.model}
                    </span>
                  ) : null}
                  {device.serialNumber && (
                    <span className={styles.serialNumber}>SN: {device.serialNumber}</span>
                  )}
                </div>
                <div className={styles.deviceMeta}>
                  <span className={styles.interval}>
                    Interval: {device.revisionIntervalMonths} měs.
                  </span>
                  {device.installationDate && (
                    <span className={styles.installDate}>
                      Instalace: {formatDate(device.installationDate)}
                    </span>
                  )}
                </div>
                {device.notes && (
                  <div className={styles.notes}>{device.notes}</div>
                )}
              </div>
              <div className={styles.deviceActions}>
                <button
                  className={styles.editButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditClick(device);
                  }}
                  disabled={deletingDeviceId === device.id}
                >
                  Upravit
                </button>
                <button
                  className={styles.deleteButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(device);
                  }}
                  disabled={deletingDeviceId === device.id}
                >
                  {deletingDeviceId === device.id ? 'Mažu...' : 'Smazat'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
