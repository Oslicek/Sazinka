import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import type { Device } from '@shared/device';
import type { Revision } from '@shared/revision';
import { DEVICE_TYPE_LABELS } from '@shared/device';
import { REVISION_STATUS_LABELS, REVISION_RESULT_LABELS } from '@shared/revision';
import { listDevices, deleteDevice } from '../../services/deviceService';
import { listRevisions } from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import { DeviceForm } from './DeviceForm';
import { RevisionForm } from '../revisions/RevisionForm';
import styles from './DeviceList.module.css';

interface DeviceListProps {
  customerId: string;
  userId: string;
  onDeviceSelect?: (device: Device) => void;
}

export function DeviceList({ customerId, userId, onDeviceSelect }: DeviceListProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceRevisions, setDeviceRevisions] = useState<Record<string, Revision[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [addingRevisionForDevice, setAddingRevisionForDevice] = useState<Device | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  
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
      
      // Load revisions for all devices
      const revisionsMap: Record<string, Revision[]> = {};
      await Promise.all(
        response.items.map(async (device) => {
          try {
            const revResponse = await listRevisions(userId, { deviceId: device.id, limit: 100 });
            revisionsMap[device.id] = revResponse.items;
          } catch {
            revisionsMap[device.id] = [];
          }
        })
      );
      setDeviceRevisions(revisionsMap);
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

  const handleAddRevision = useCallback((device: Device) => {
    setAddingRevisionForDevice(device);
  }, []);

  const handleRevisionFormClose = useCallback(() => {
    setAddingRevisionForDevice(null);
  }, []);

  const handleRevisionFormSuccess = useCallback(() => {
    setAddingRevisionForDevice(null);
    loadDevices(); // Reload to get updated revisions
  }, [loadDevices]);

  const toggleDeviceExpand = useCallback((deviceId: string) => {
    setExpandedDeviceId((prev) => (prev === deviceId ? null : deviceId));
  }, []);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed': return styles.statusCompleted;
      case 'overdue': return styles.statusOverdue;
      case 'scheduled': 
      case 'confirmed': return styles.statusScheduled;
      default: return styles.statusUpcoming;
    }
  };


  // Show revision form for a specific device
  if (addingRevisionForDevice) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            Nová revize - {DEVICE_TYPE_LABELS[addingRevisionForDevice.deviceType as keyof typeof DEVICE_TYPE_LABELS] || addingRevisionForDevice.deviceType}
          </h3>
        </div>
        <RevisionForm
          customerId={customerId}
          deviceId={addingRevisionForDevice.id}
          userId={userId}
          onSuccess={handleRevisionFormSuccess}
          onCancel={handleRevisionFormClose}
        />
      </div>
    );
  }

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
          {devices.map((device) => {
            const revisions = deviceRevisions[device.id] || [];
            const isExpanded = expandedDeviceId === device.id;
            
            return (
              <div 
                key={device.id} 
                className={`${styles.deviceCard} ${isExpanded ? styles.expanded : ''}`}
              >
                <div 
                  className={styles.deviceHeader}
                  onClick={() => toggleDeviceExpand(device.id)}
                >
                  <div className={styles.deviceInfo}>
                    <div className={styles.deviceType}>
                      {DEVICE_TYPE_LABELS[device.deviceType as keyof typeof DEVICE_TYPE_LABELS] || device.deviceType}
                      <span className={styles.revisionCount}>
                        ({revisions.length} {revisions.length === 1 ? 'revize' : revisions.length < 5 ? 'revize' : 'revizí'})
                      </span>
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
                  <div className={styles.expandIcon}>
                    {isExpanded ? '▼' : '▶'}
                  </div>
                </div>
                
                {isExpanded && (
                  <div className={styles.deviceExpanded}>
                    <div className={styles.deviceActions}>
                      <button
                        className={styles.addRevisionButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddRevision(device);
                        }}
                      >
                        + Přidat revizi
                      </button>
                      <button
                        className={styles.editButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(device);
                        }}
                        disabled={deletingDeviceId === device.id}
                      >
                        Upravit zařízení
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
                    
                    <div className={styles.revisionsList}>
                      <h4 className={styles.revisionsTitle}>Historie revizí</h4>
                      {revisions.length === 0 ? (
                        <p className={styles.noRevisions}>Zatím žádné revize</p>
                      ) : (
                        <div className={styles.revisionsTable}>
                          {revisions
                            .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime())
                            .map((revision) => (
                              <Link 
                                key={revision.id} 
                                to="/revisions/$revisionId"
                                params={{ revisionId: revision.id }}
                                className={styles.revisionRow}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className={styles.revisionDate}>
                                  {formatDate(revision.dueDate)}
                                </div>
                                <div className={`${styles.revisionStatus} ${getStatusBadgeClass(revision.status)}`}>
                                  {REVISION_STATUS_LABELS[revision.status as keyof typeof REVISION_STATUS_LABELS] || revision.status}
                                </div>
                                {revision.result && (
                                  <div className={styles.revisionResult}>
                                    {REVISION_RESULT_LABELS[revision.result as keyof typeof REVISION_RESULT_LABELS] || revision.result}
                                  </div>
                                )}
                                {revision.findings && (
                                  <div className={styles.revisionFindings}>
                                    {revision.findings}
                                  </div>
                                )}
                              </Link>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
