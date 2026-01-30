import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
import * as settingsService from '../services/settingsService';
import type {
  UserSettings,
  WorkConstraints,
  BusinessInfo,
  EmailTemplateSettings,
  Depot,
} from '@sazinka/shared-types';
import styles from './Settings.module.css';

const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

type SettingsTab = 'work' | 'business' | 'email' | 'depots';

export function Settings() {
  const { isConnected } = useNatsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('work');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load settings
  const loadSettings = useCallback(async () => {
    if (!isConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const data = await settingsService.getSettings(TEMP_USER_ID);
      setSettings(data);
    } catch (e) {
      console.error('Failed to load settings:', e);
      setError('Nepodařilo se načíst nastavení');
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Show success message temporarily
  const showSuccess = (message: string) => {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 3000);
  };

  // Tab components
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'work', label: 'Pracovní doba' },
    { id: 'business', label: 'Firemní údaje' },
    { id: 'email', label: 'E-mailové šablony' },
    { id: 'depots', label: 'Depa' },
  ];

  if (loading) {
    return (
      <div className={styles.settings}>
        <h1>Nastavení</h1>
        <div className={styles.loading}>Načítám nastavení...</div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className={styles.settings}>
        <h1>Nastavení</h1>
        <div className={styles.error}>{error}</div>
        <button className="btn-primary" onClick={loadSettings}>
          Zkusit znovu
        </button>
      </div>
    );
  }

  return (
    <div className={styles.settings}>
      <h1>Nastavení</h1>

      {/* Tabs */}
      <div className={styles.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      {/* Tab content */}
      <div className={styles.tabContent}>
        {activeTab === 'work' && settings && (
          <WorkConstraintsForm
            data={settings.workConstraints}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updateWorkConstraints(TEMP_USER_ID, data);
                setSettings((prev) => prev ? { ...prev, workConstraints: updated } : null);
                showSuccess('Nastavení pracovní doby uloženo');
              } catch (e) {
                setError('Nepodařilo se uložit nastavení');
              } finally {
                setSaving(false);
              }
            }}
          />
        )}

        {activeTab === 'business' && settings && (
          <BusinessInfoForm
            data={settings.businessInfo}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updateBusinessInfo(TEMP_USER_ID, data);
                setSettings((prev) => prev ? { ...prev, businessInfo: updated } : null);
                showSuccess('Firemní údaje uloženy');
              } catch (e) {
                setError('Nepodařilo se uložit firemní údaje');
              } finally {
                setSaving(false);
              }
            }}
          />
        )}

        {activeTab === 'email' && settings && (
          <EmailTemplatesForm
            data={settings.emailTemplates}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updateEmailTemplates(TEMP_USER_ID, data);
                setSettings((prev) => prev ? { ...prev, emailTemplates: updated } : null);
                showSuccess('E-mailové šablony uloženy');
              } catch (e) {
                setError('Nepodařilo se uložit šablony');
              } finally {
                setSaving(false);
              }
            }}
          />
        )}

        {activeTab === 'depots' && settings && (
          <DepotsManager
            depots={settings.depots}
            onUpdate={async () => {
              await loadSettings();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Work Constraints Form
// ============================================================================

interface WorkConstraintsFormProps {
  data: WorkConstraints;
  saving: boolean;
  onSave: (data: Partial<WorkConstraints>) => Promise<void>;
}

function WorkConstraintsForm({ data, saving, onSave }: WorkConstraintsFormProps) {
  const [formData, setFormData] = useState({
    workingHoursStart: data.workingHoursStart || '08:00',
    workingHoursEnd: data.workingHoursEnd || '17:00',
    maxRevisionsPerDay: data.maxRevisionsPerDay || 8,
    defaultServiceDurationMinutes: data.defaultServiceDurationMinutes || 30,
    defaultRevisionIntervalMonths: data.defaultRevisionIntervalMonths || 12,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formSection}>
        <h3>Pracovní doba</h3>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="workStart">Začátek</label>
            <input
              type="time"
              id="workStart"
              value={formData.workingHoursStart}
              onChange={(e) => setFormData({ ...formData, workingHoursStart: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="workEnd">Konec</label>
            <input
              type="time"
              id="workEnd"
              value={formData.workingHoursEnd}
              onChange={(e) => setFormData({ ...formData, workingHoursEnd: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>Revize</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="maxRevisions">Max revizí za den</label>
          <input
            type="number"
            id="maxRevisions"
            min={1}
            max={20}
            value={formData.maxRevisionsPerDay}
            onChange={(e) => setFormData({ ...formData, maxRevisionsPerDay: parseInt(e.target.value) || 8 })}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label htmlFor="serviceDuration">Výchozí doba revize (min)</label>
          <input
            type="number"
            id="serviceDuration"
            min={15}
            max={180}
            step={15}
            value={formData.defaultServiceDurationMinutes}
            onChange={(e) => setFormData({ ...formData, defaultServiceDurationMinutes: parseInt(e.target.value) || 30 })}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label htmlFor="interval">Výchozí interval revizí (měsíce)</label>
          <input
            type="number"
            id="interval"
            min={1}
            max={60}
            value={formData.defaultRevisionIntervalMonths}
            onChange={(e) => setFormData({ ...formData, defaultRevisionIntervalMonths: parseInt(e.target.value) || 12 })}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Ukládám...' : 'Uložit změny'}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Business Info Form
// ============================================================================

interface BusinessInfoFormProps {
  data: BusinessInfo;
  saving: boolean;
  onSave: (data: Partial<BusinessInfo>) => Promise<void>;
}

function BusinessInfoForm({ data, saving, onSave }: BusinessInfoFormProps) {
  const [formData, setFormData] = useState({
    name: data.name || '',
    phone: data.phone || '',
    businessName: data.businessName || '',
    ico: data.ico || '',
    dic: data.dic || '',
    street: data.street || '',
    city: data.city || '',
    postalCode: data.postalCode || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formSection}>
        <h3>Kontaktní údaje</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="name">Jméno a příjmení</label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label htmlFor="phone">Telefon</label>
          <input
            type="tel"
            id="phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>Fakturační údaje</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="businessName">Název firmy</label>
          <input
            type="text"
            id="businessName"
            value={formData.businessName}
            onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
          />
        </div>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="ico">IČO</label>
            <input
              type="text"
              id="ico"
              value={formData.ico}
              onChange={(e) => setFormData({ ...formData, ico: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="dic">DIČ</label>
            <input
              type="text"
              id="dic"
              value={formData.dic}
              onChange={(e) => setFormData({ ...formData, dic: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>Adresa</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="street">Ulice a č.p.</label>
          <input
            type="text"
            id="street"
            value={formData.street}
            onChange={(e) => setFormData({ ...formData, street: e.target.value })}
          />
        </div>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="city">Město</label>
            <input
              type="text"
              id="city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="postalCode">PSČ</label>
            <input
              type="text"
              id="postalCode"
              value={formData.postalCode}
              onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Ukládám...' : 'Uložit změny'}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Email Templates Form
// ============================================================================

interface EmailTemplatesFormProps {
  data: EmailTemplateSettings;
  saving: boolean;
  onSave: (data: Partial<EmailTemplateSettings>) => Promise<void>;
}

function EmailTemplatesForm({ data, saving, onSave }: EmailTemplatesFormProps) {
  const [formData, setFormData] = useState({
    emailSubjectTemplate: data.emailSubjectTemplate || 'Revize hasicího přístroje - {{customerName}}',
    emailBodyTemplate: data.emailBodyTemplate || 'Dobrý den,\n\nblíží se termín revize vašeho hasicího přístroje.\n\nS pozdravem',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formSection}>
        <h3>Šablona e-mailu pro upomínky</h3>
        <p className={styles.hint}>
          Použijte proměnné: {'{{customerName}}'}, {'{{deviceName}}'}, {'{{dueDate}}'}
        </p>
        
        <div className={styles.formGroup}>
          <label htmlFor="subject">Předmět e-mailu</label>
          <input
            type="text"
            id="subject"
            value={formData.emailSubjectTemplate}
            onChange={(e) => setFormData({ ...formData, emailSubjectTemplate: e.target.value })}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label htmlFor="body">Text e-mailu</label>
          <textarea
            id="body"
            rows={10}
            value={formData.emailBodyTemplate}
            onChange={(e) => setFormData({ ...formData, emailBodyTemplate: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Ukládám...' : 'Uložit změny'}
        </button>
      </div>
    </form>
  );
}

// ============================================================================
// Depots Manager
// ============================================================================

interface DepotsManagerProps {
  depots: Depot[];
  onUpdate: () => Promise<void>;
}

function DepotsManager({ depots, onUpdate }: DepotsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingDepot, setEditingDepot] = useState<Depot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (data: { name: string; street: string; city: string; postalCode: string }) => {
    setSaving(true);
    setError(null);
    
    try {
      // First geocode the address
      const geocoded = await settingsService.geocodeDepotAddress(TEMP_USER_ID, data);
      
      if (!geocoded.coordinates) {
        setError('Adresa nebyla nalezena. Zkontrolujte prosím zadané údaje.');
        setSaving(false);
        return;
      }
      
      // Create depot with coordinates
      await settingsService.createDepot(TEMP_USER_ID, {
        name: data.name,
        street: data.street,
        city: data.city,
        postalCode: data.postalCode,
        lat: geocoded.coordinates.lat,
        lng: geocoded.coordinates.lng,
        isPrimary: depots.length === 0, // First depot is primary
      });
      
      setShowForm(false);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se vytvořit depo');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data: { name: string; street: string; city: string; postalCode: string }) => {
    if (!editingDepot) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Geocode if address changed
      const geocoded = await settingsService.geocodeDepotAddress(TEMP_USER_ID, data);
      
      await settingsService.updateDepot(TEMP_USER_ID, {
        id: editingDepot.id,
        name: data.name,
        street: data.street,
        city: data.city,
        postalCode: data.postalCode,
        lat: geocoded.coordinates?.lat ?? editingDepot.lat,
        lng: geocoded.coordinates?.lng ?? editingDepot.lng,
      });
      
      setEditingDepot(null);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se aktualizovat depo');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depotId: string) => {
    if (!confirm('Opravdu chcete smazat toto depo?')) return;
    
    try {
      await settingsService.deleteDepot(TEMP_USER_ID, depotId);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se smazat depo');
    }
  };

  const handleSetPrimary = async (depot: Depot) => {
    try {
      await settingsService.updateDepot(TEMP_USER_ID, {
        id: depot.id,
        isPrimary: true,
      });
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se nastavit primární depo');
    }
  };

  return (
    <div className={styles.depotsManager}>
      {error && <div className={styles.error}>{error}</div>}
      
      {/* Depot list */}
      <div className={styles.depotList}>
        {depots.length === 0 ? (
          <p className={styles.empty}>Zatím nemáte žádné depo. Vytvořte první.</p>
        ) : (
          depots.map((depot) => (
            <div key={depot.id} className={`${styles.depotCard} ${depot.isPrimary ? styles.primary : ''}`}>
              <div className={styles.depotInfo}>
                <div className={styles.depotHeader}>
                  <strong>{depot.name}</strong>
                  {depot.isPrimary && <span className={styles.primaryBadge}>Primární</span>}
                </div>
                <small>
                  {depot.street && `${depot.street}, `}
                  {depot.city}
                  {depot.postalCode && `, ${depot.postalCode}`}
                </small>
              </div>
              <div className={styles.depotActions}>
                {!depot.isPrimary && (
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => handleSetPrimary(depot)}
                    title="Nastavit jako primární"
                  >
                    ⭐
                  </button>
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setEditingDepot(depot)}
                  title="Upravit"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  onClick={() => handleDelete(depot.id)}
                  title="Smazat"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add/Edit form */}
      {(showForm || editingDepot) && (
        <DepotForm
          depot={editingDepot}
          saving={saving}
          onSave={editingDepot ? handleUpdate : handleCreate}
          onCancel={() => {
            setShowForm(false);
            setEditingDepot(null);
          }}
        />
      )}

      {/* Add button */}
      {!showForm && !editingDepot && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowForm(true)}
        >
          + Přidat depo
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Depot Form
// ============================================================================

interface DepotFormProps {
  depot: Depot | null;
  saving: boolean;
  onSave: (data: { name: string; street: string; city: string; postalCode: string }) => Promise<void>;
  onCancel: () => void;
}

function DepotForm({ depot, saving, onSave, onCancel }: DepotFormProps) {
  const [formData, setFormData] = useState({
    name: depot?.name || '',
    street: depot?.street || '',
    city: depot?.city || '',
    postalCode: depot?.postalCode || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.depotForm} onSubmit={handleSubmit}>
      <h4>{depot ? 'Upravit depo' : 'Nové depo'}</h4>
      
      <div className={styles.formGroup}>
        <label htmlFor="depotName">Název</label>
        <input
          type="text"
          id="depotName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      
      <div className={styles.formGroup}>
        <label htmlFor="depotStreet">Ulice a č.p.</label>
        <input
          type="text"
          id="depotStreet"
          value={formData.street}
          onChange={(e) => setFormData({ ...formData, street: e.target.value })}
          required
        />
      </div>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="depotCity">Město</label>
          <input
            type="text"
            id="depotCity"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="depotPostalCode">PSČ</label>
          <input
            type="text"
            id="depotPostalCode"
            value={formData.postalCode}
            onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
          />
        </div>
      </div>
      
      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Zrušit
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Ukládám...' : (depot ? 'Uložit' : 'Vytvořit')}
        </button>
      </div>
    </form>
  );
}

export default Settings;
