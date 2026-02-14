import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { Device } from '@shared/device';
import type { Revision } from '@shared/revision';
import { DEVICE_TYPE_KEYS } from '@shared/device';
import { REVISION_STATUS_KEYS, REVISION_RESULT_KEYS } from '@shared/revision';
import { listDevices, deleteDevice } from '../../services/deviceService';
import { formatDate } from '../../i18n/formatters';
import { listRevisions } from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import { DeviceForm } from './DeviceForm';
import { RevisionForm } from '../revisions/RevisionForm';
import styles from './DeviceList.module.css';

interface DeviceListProps {
  customerId: string;
  onDeviceSelect?: (device: Device) => void;
}

export function DeviceList({ customerId, onDeviceSelect }: DeviceListProps) {
  const { t } = useTranslation('common');
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
      setError(t('errors.not_connected'));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await listDevices(customerId);
      setDevices(response.items);
      
      // Load revisions for all devices
      const revisionsMap: Record<string, Revision[]> = {};
      await Promise.all(
        response.items.map(async (device) => {
          try {
            const revResponse = await listRevisions({ deviceId: device.id, limit: 100 });
            revisionsMap[device.id] = revResponse.items;
          } catch {
            revisionsMap[device.id] = [];
          }
        })
      );
      setDeviceRevisions(revisionsMap);
    } catch (err) {
      console.error('Failed to load devices:', err);
      setError(err instanceof Error ? err.message : t('device_error_load'));
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, customerId]);

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
    if (!confirm(t('device_confirm_delete', { name: DEVICE_TYPE_KEYS[device.deviceType as keyof typeof DEVICE_TYPE_KEYS] ? t(DEVICE_TYPE_KEYS[device.deviceType as keyof typeof DEVICE_TYPE_KEYS]) : device.deviceType }))) {
      return;
    }

    try {
      setDeletingDeviceId(device.id);
      setError(null);
      await deleteDevice(device.id, customerId);
      loadDevices();
    } catch (err) {
      console.error('Failed to delete device:', err);
      setError(err instanceof Error ? err.message : t('device_error_delete'));
    } finally {
      setDeletingDeviceId(null);
    }
  }, [customerId, loadDevices]);

  const formatDateOrDash = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      return formatDate(dateStr);
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
            {t('device_new_revision_title')} - {DEVICE_TYPE_KEYS[addingRevisionForDevice.deviceType as keyof typeof DEVICE_TYPE_KEYS] ? t(DEVICE_TYPE_KEYS[addingRevisionForDevice.deviceType as keyof typeof DEVICE_TYPE_KEYS]) : addingRevisionForDevice.deviceType}
          </h3>
        </div>
        <RevisionForm
          customerId={customerId}
          deviceId={addingRevisionForDevice.id}
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
        device={editingDevice ?? undefined}
        onSuccess={handleFormSuccess}
        onCancel={handleFormClose}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('device_title')}</h3>
        <button 
          className={styles.addButton} 
          onClick={handleAddClick}
          disabled={!isConnected}
        >
          {t('device_add')}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isLoading ? (
        <div className={styles.loading}>{t('device_loading')}</div>
      ) : devices.length === 0 ? (
        <div className={styles.empty}>
          <p>{t('device_empty')}</p>
          <p className={styles.emptyHint}>{t('device_empty_hint')}</p>
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
                      {DEVICE_TYPE_KEYS[device.deviceType as keyof typeof DEVICE_TYPE_KEYS] ? t(DEVICE_TYPE_KEYS[device.deviceType as keyof typeof DEVICE_TYPE_KEYS]) : device.deviceType}
                      <span className={styles.revisionCount}>
                        ({t('device_revision_count', { count: revisions.length })})
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
                        {t('device_interval')}: {device.revisionIntervalMonths} {t('device_months_abbr')}
                      </span>
                      {device.installationDate && (
                        <span className={styles.installDate}>
                          {t('device_installation')}: {formatDateOrDash(device.installationDate)}
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
                        {t('device_add_revision')}
                      </button>
                      <button
                        className={styles.editButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditClick(device);
                        }}
                        disabled={deletingDeviceId === device.id}
                      >
                        {t('device_edit')}
                      </button>
                      <button
                        className={styles.deleteButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(device);
                        }}
                        disabled={deletingDeviceId === device.id}
                      >
                        {deletingDeviceId === device.id ? t('device_deleting') : t('delete')}
                      </button>
                    </div>
                    
                    <div className={styles.revisionsList}>
                      <h4 className={styles.revisionsTitle}>{t('device_revision_history')}</h4>
                      {revisions.length === 0 ? (
                        <p className={styles.noRevisions}>{t('device_no_revisions')}</p>
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
                                  {formatDateOrDash(revision.dueDate)}
                                </div>
                                <div className={`${styles.revisionStatus} ${getStatusBadgeClass(revision.status)}`}>
                                  {REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS] ? t(REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS]) : revision.status}
                                </div>
                                {revision.result && (
                                  <div className={styles.revisionResult}>
                                    {REVISION_RESULT_KEYS[revision.result as keyof typeof REVISION_RESULT_KEYS] ? t(REVISION_RESULT_KEYS[revision.result as keyof typeof REVISION_RESULT_KEYS]) : revision.result}
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
