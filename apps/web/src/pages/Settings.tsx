import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
import * as settingsService from '../services/settingsService';
import * as crewService from '../services/crewService';
import * as workerService from '../services/workerService';
import { importCustomersBatch } from '../services/customerService';
import type { Crew } from '../services/crewService';
import type { UserPublic } from '@shared/auth';
import type {
  UserSettings,
  WorkConstraints,
  BusinessInfo,
  EmailTemplateSettings,
  BreakSettings,
  Depot,
} from '@shared/settings';
import { ImportModal, type ImportEntityType } from '../components/import';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import { ExportPlusPanel } from '../components/shared/ExportPlusPanel';
import styles from './Settings.module.css';

type SettingsTab = 'preferences' | 'work' | 'business' | 'email' | 'breaks' | 'depots' | 'crews' | 'workers' | 'import-export';

const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  breakEnabled: true,
  breakDurationMinutes: 45,
  breakEarliestTime: '11:30',
  breakLatestTime: '13:00',
  breakMinKm: 40,
  breakMaxKm: 120,
};

export function Settings() {
  const { isConnected } = useNatsStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('preferences');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [workers, setWorkers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Import state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importEntityType, setImportEntityType] = useState<ImportEntityType>('device');
  const [showCustomerImport, setShowCustomerImport] = useState(false);

  // Load settings and crews
  const loadSettings = useCallback(async () => {
    if (!isConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const [data, crewList, workerList] = await Promise.all([
        settingsService.getSettings(),
        crewService.listCrews(false), // Load all crews, including inactive
        workerService.listWorkers().catch(() => [] as UserPublic[]), // Workers might fail for non-customers
      ]);
      setSettings(data);
      setCrews(crewList);
      setWorkers(workerList);
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

  // Import handlers
  const handleOpenImport = (entityType: ImportEntityType) => {
    setImportEntityType(entityType);
    setImportModalOpen(true);
  };

  const handleCloseImport = () => {
    setImportModalOpen(false);
  };

  const handleOpenCustomerImport = () => {
    setShowCustomerImport(true);
  };

  const handleCloseCustomerImport = () => {
    setShowCustomerImport(false);
  };

  const handleCustomerImportBatch = useCallback(async (customers: Parameters<typeof importCustomersBatch>[0]) => {
    return importCustomersBatch(customers);
  }, []);

  // Tab components
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'preferences', label: 'Moje nastavení' },
    { id: 'work', label: 'Pracovní doba' },
    { id: 'business', label: 'Firemní údaje' },
    { id: 'email', label: 'E-mailové šablony' },
    { id: 'breaks', label: 'Pauzy' },
    { id: 'depots', label: 'Depa' },
    { id: 'crews', label: 'Posádky' },
    { id: 'workers', label: 'Pracovníci' },
    { id: 'import-export', label: 'Import & Export' },
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

      <div className={styles.settingsLayout}>
        {/* Sidebar Navigation */}
        <nav className={styles.sidebar}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`${styles.sidebarItem} ${activeTab === tab.id ? styles.sidebarItemActive : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div className={styles.contentArea}>
          {/* Messages */}
          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}
        {activeTab === 'preferences' && settings && (
          <PreferencesForm
            defaultCrewId={settings.preferences?.defaultCrewId ?? null}
            defaultDepotId={settings.preferences?.defaultDepotId ?? null}
            crews={crews.filter((c) => c.isActive)}
            depots={settings.depots}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updatePreferences(data);
                setSettings((prev) => prev ? { ...prev, preferences: updated } : null);
                showSuccess('Preference uloženy');
              } catch (e) {
                setError('Nepodařilo se uložit preference');
              } finally {
                setSaving(false);
              }
            }}
          />
        )}

        {activeTab === 'work' && settings && (
          <WorkConstraintsForm
            data={settings.workConstraints}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updateWorkConstraints(data);
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
                const updated = await settingsService.updateBusinessInfo(data);
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
                const updated = await settingsService.updateEmailTemplates(data);
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

        {activeTab === 'breaks' && settings && (
          <BreakSettingsForm
            data={settings.breakSettings ?? DEFAULT_BREAK_SETTINGS}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updateBreakSettings(data);
                setSettings((prev) => prev ? { ...prev, breakSettings: updated } : null);
                showSuccess('Nastavení pauz uloženo');
              } catch (e) {
                console.error('Failed to update break settings:', e);
                setError('Nepodařilo se uložit nastavení pauz');
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

        {activeTab === 'crews' && (
          <CrewsManager
            crews={crews}
            onUpdate={async () => {
              await loadSettings();
            }}
          />
        )}

        {activeTab === 'workers' && (
          <WorkersManager
            workers={workers}
            onUpdate={async () => {
              const updatedWorkers = await workerService.listWorkers().catch(() => [] as UserPublic[]);
              setWorkers(updatedWorkers);
            }}
          />
        )}

        {activeTab === 'import-export' && (
          <div className={styles.importExportContent}>
            {/* Export Section */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Export dat</h2>
              <ExportPlusPanel
                crewOptions={crews.map((c) => ({ id: c.id, label: c.name }))}
                depotOptions={(settings?.depots || []).map((d) => ({ id: d.id, label: d.name }))}
              />
            </section>

            {/* Import Section */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Import dat</h2>

              <div className={styles.exportContainer}>
                {/* Customers Import */}
                <div className={styles.exportCard}>
                  <h3>1. Import zákazníků</h3>
                  <p className={styles.exportDescription}>
                    Importuje zákazníky z CSV. Automaticky spustí geokódování adres.
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={handleOpenCustomerImport}
                    disabled={!isConnected}
                  >
                    📤 Importovat zákazníky
                  </button>
                </div>

                {/* Devices Import */}
                <div className={styles.exportCard}>
                  <h3>2. Import zařízení</h3>
                  <p className={styles.exportDescription}>
                    Importuje zařízení z CSV. Vyžaduje existující zákazníky (propojení přes IČO/email/telefon).
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('device')}
                    disabled={!isConnected}
                  >
                    📤 Importovat zařízení
                  </button>
                </div>

                {/* Revisions Import */}
                <div className={styles.exportCard}>
                  <h3>3. Import revizí</h3>
                  <p className={styles.exportDescription}>
                    Importuje revize z CSV. Vyžaduje existující zařízení (propojení přes sériové číslo).
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('revision')}
                    disabled={!isConnected}
                  >
                    📤 Importovat revize
                  </button>
                </div>

                {/* Communications Import */}
                <div className={styles.exportCard}>
                  <h3>4. Import komunikace</h3>
                  <p className={styles.exportDescription}>
                    Importuje historii komunikace (hovory, emaily, poznámky) z CSV.
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('communication')}
                    disabled={!isConnected}
                  >
                    📤 Importovat komunikaci
                  </button>
                </div>

                {/* Work Log Import */}
                <div className={styles.exportCard}>
                  <h3>5. Import pracovního deníku</h3>
                  <p className={styles.exportDescription}>
                    Importuje pracovní deník (work_log) z CSV.
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('work_log')}
                    disabled={!isConnected}
                  >
                    📤 Importovat pracovní deník
                  </button>
                </div>

                {/* ZIP Import */}
                <div className={styles.exportCard}>
                  <h3>📦 Import ZIP</h3>
                  <p className={styles.exportDescription}>
                    Importujte více souborů najednou z jednoho ZIP archivu. Automaticky rozpozná typy souborů
                    a importuje je ve správném pořadí.
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('zip')}
                    disabled={!isConnected}
                  >
                    📦 Importovat ZIP
                  </button>
                </div>
              </div>

              <div className={styles.importHint}>
                <p>
                  📋 <a href="/PROJECT_IMPORT.MD" target="_blank" rel="noopener noreferrer">
                    Dokumentace formátů CSV pro import
                  </a>
                </p>
                <p>
                  Importujte v uvedeném pořadí (1-5). Každý import vyžaduje data z předchozích kroků.
                </p>
              </div>
            </section>
          </div>
        )}
        </div>
      </div>

      {/* Import Modal */}
      <ImportModal
        isOpen={importModalOpen}
        onClose={handleCloseImport}
        entityType={importEntityType}
      />

      {/* Customer Import Modal */}
      <ImportCustomersModal
        isOpen={showCustomerImport}
        onClose={handleCloseCustomerImport}
      />
    </div>
  );
}

// ============================================================================
// Preferences Form (Moje nastavení)
// ============================================================================

interface PreferencesFormProps {
  defaultCrewId: string | null;
  defaultDepotId: string | null;
  crews: Crew[];
  depots: Depot[];
  saving: boolean;
  onSave: (data: { defaultCrewId: string | null; defaultDepotId: string | null }) => Promise<void>;
}

function PreferencesForm({ defaultCrewId, defaultDepotId, crews, depots, saving, onSave }: PreferencesFormProps) {
  const [crewId, setCrewId] = useState(defaultCrewId ?? '');
  const [depotId, setDepotId] = useState(defaultDepotId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      defaultCrewId: crewId || null,
      defaultDepotId: depotId || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h3>Moje nastavení</h3>
      <p className={styles.formDescription}>
        Nastavte svou výchozí posádku a depo. Tyto hodnoty se použijí jako výchozí filtry v plánovači tras.
      </p>

      <div className={styles.formGroup}>
        <label>Výchozí posádka</label>
        <select
          value={crewId}
          onChange={(e) => setCrewId(e.target.value)}
          className={styles.input}
        >
          <option value="">— Žádná —</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label>Výchozí depo</label>
        <select
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
          className={styles.input}
        >
          <option value="">— Žádné —</option>
          {depots.map((depot) => (
            <option key={depot.id} value={depot.id}>
              {depot.name}{depot.isPrimary ? ' (primární)' : ''}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className={styles.saveButton} disabled={saving}>
        {saving ? 'Ukládám...' : 'Uložit'}
      </button>
    </form>
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
// Break Settings Form
// ============================================================================

interface BreakSettingsFormProps {
  data?: BreakSettings;
  saving: boolean;
  onSave: (data: Partial<BreakSettings>) => void;
}

function BreakSettingsForm({ data, saving, onSave }: BreakSettingsFormProps) {
  const resolvedData = data ?? DEFAULT_BREAK_SETTINGS;
  const [enforceDrivingBreakRule, setEnforceDrivingBreakRule] = useState<boolean>(() => {
    const raw = localStorage.getItem('planningInbox.enforceDrivingBreakRule');
    return raw === null ? true : raw === 'true';
  });
  const [formData, setFormData] = useState({
    breakEnabled: resolvedData.breakEnabled,
    breakDurationMinutes: resolvedData.breakDurationMinutes,
    breakEarliestTime: resolvedData.breakEarliestTime,
    breakLatestTime: resolvedData.breakLatestTime,
    breakMinKm: resolvedData.breakMinKm,
    breakMaxKm: resolvedData.breakMaxKm,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', String(enforceDrivingBreakRule));
    onSave(formData);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formSection}>
        <h3>Automatická pauza v trasách</h3>
        <p className={styles.hint}>
          Nastavte, zda se má do nově vytvořených tras automaticky vkládat obědová pauza.
        </p>
        
        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={formData.breakEnabled}
              onChange={(e) => setFormData({ ...formData, breakEnabled: e.target.checked })}
            />
            <span>Automaticky vkládat pauzu do nových tras</span>
          </label>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="duration">Délka pauzy (minuty)</label>
          <input
            type="number"
            id="duration"
            min="1"
            max="180"
            value={formData.breakDurationMinutes}
            onChange={(e) => setFormData({ ...formData, breakDurationMinutes: parseInt(e.target.value) || 30 })}
            disabled={!formData.breakEnabled}
          />
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="earliestTime">Časové rozmezí - od</label>
            <input
              type="time"
              id="earliestTime"
              value={formData.breakEarliestTime}
              onChange={(e) => setFormData({ ...formData, breakEarliestTime: e.target.value })}
              disabled={!formData.breakEnabled}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="latestTime">Časové rozmezí - do</label>
            <input
              type="time"
              id="latestTime"
              value={formData.breakLatestTime}
              onChange={(e) => setFormData({ ...formData, breakLatestTime: e.target.value })}
              disabled={!formData.breakEnabled}
            />
          </div>
        </div>

        <p className={styles.hint}>
          Pauza bude umístěna v čase mezi {formData.breakEarliestTime} a {formData.breakLatestTime}.
        </p>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="minKm">Rozmezí najetých km - od</label>
            <input
              type="number"
              id="minKm"
              min="0"
              max="500"
              step="1"
              value={formData.breakMinKm}
              onChange={(e) => setFormData({ ...formData, breakMinKm: parseFloat(e.target.value) || 0 })}
              disabled={!formData.breakEnabled}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="maxKm">Rozmezí najetých km - do</label>
            <input
              type="number"
              id="maxKm"
              min="0"
              max="500"
              step="1"
              value={formData.breakMaxKm}
              onChange={(e) => setFormData({ ...formData, breakMaxKm: parseFloat(e.target.value) || 0 })}
              disabled={!formData.breakEnabled}
            />
          </div>
        </div>

        <p className={styles.hint}>
          Pauza bude umístěna po najetí {formData.breakMinKm} až {formData.breakMaxKm} km od startu.
        </p>

        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={enforceDrivingBreakRule}
              onChange={(e) => setEnforceDrivingBreakRule(e.target.checked)}
            />
            <span>Vložit pauzu 45 minut nejpozději po 4,5 hodinách kumulovaného řízení</span>
          </label>
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
      const geocoded = await settingsService.geocodeDepotAddress(data);
      
      if (!geocoded.coordinates) {
        setError('Adresa nebyla nalezena. Zkontrolujte prosím zadané údaje.');
        setSaving(false);
        return;
      }
      
      // Create depot with coordinates
      await settingsService.createDepot({
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
      const geocoded = await settingsService.geocodeDepotAddress(data);
      
      await settingsService.updateDepot({
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
      await settingsService.deleteDepot(depotId);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se smazat depo');
    }
  };

  const handleSetPrimary = async (depot: Depot) => {
    try {
      await settingsService.updateDepot({
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

// ============================================================================
// Crews Manager
// ============================================================================

interface CrewsManagerProps {
  crews: Crew[];
  onUpdate: () => Promise<void>;
}

function CrewsManager({ crews, onUpdate }: CrewsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingCrew, setEditingCrew] = useState<Crew | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (data: CrewFormData) => {
    setSaving(true);
    setError(null);
    
    try {
      await crewService.createCrew({
        name: data.name,
        arrivalBufferPercent: data.arrivalBufferPercent,
        arrivalBufferFixedMinutes: data.arrivalBufferFixedMinutes,
        workingHoursStart: data.workingHoursStart,
        workingHoursEnd: data.workingHoursEnd,
      });
      setShowForm(false);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se vytvořit posádku');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data: CrewFormData) => {
    if (!editingCrew) return;
    
    setSaving(true);
    setError(null);
    
    try {
      await crewService.updateCrew({
        id: editingCrew.id,
        name: data.name,
        arrivalBufferPercent: data.arrivalBufferPercent,
        arrivalBufferFixedMinutes: data.arrivalBufferFixedMinutes,
        workingHoursStart: data.workingHoursStart,
        workingHoursEnd: data.workingHoursEnd,
      });
      setEditingCrew(null);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se aktualizovat posádku');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (crewId: string) => {
    if (!confirm('Opravdu chcete smazat tuto posádku?')) return;
    
    try {
      await crewService.deleteCrew(crewId);
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se smazat posádku');
    }
  };

  const handleToggleActive = async (crew: Crew) => {
    try {
      await crewService.updateCrew({
        id: crew.id,
        isActive: !crew.isActive,
      });
      await onUpdate();
    } catch (e) {
      setError('Nepodařilo se změnit stav posádky');
    }
  };

  return (
    <div className={styles.depotsManager}>
      {error && <div className={styles.error}>{error}</div>}
      
      {/* Crew list */}
      <div className={styles.depotList}>
        {crews.length === 0 ? (
          <p className={styles.empty}>Zatím nemáte žádné posádky. Vytvořte první.</p>
        ) : (
          crews.map((crew) => (
            <div key={crew.id} className={`${styles.depotCard} ${!crew.isActive ? styles.inactive : ''}`}>
              <div className={styles.depotInfo}>
                <div className={styles.depotHeader}>
                  <strong>{crew.name}</strong>
                  {!crew.isActive && <span className={styles.inactiveBadge}>Neaktivní</span>}
                </div>
                <small>
                  {crew.workingHoursStart?.slice(0, 5) || '08:00'}–{crew.workingHoursEnd?.slice(0, 5) || '17:00'}
                  {' · '}
                  Rezerva {crew.arrivalBufferPercent ?? 10} %{(crew.arrivalBufferFixedMinutes ?? 0) > 0 ? ` + ${crew.arrivalBufferFixedMinutes} min` : ''}
                </small>
              </div>
              <div className={styles.depotActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => handleToggleActive(crew)}
                  title={crew.isActive ? 'Deaktivovat' : 'Aktivovat'}
                >
                  {crew.isActive ? '✓' : '○'}
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setEditingCrew(crew)}
                  title="Upravit"
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  onClick={() => handleDelete(crew.id)}
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
      {(showForm || editingCrew) && (
        <CrewForm
          crew={editingCrew}
          saving={saving}
          onSave={editingCrew ? handleUpdate : handleCreate}
          onCancel={() => {
            setShowForm(false);
            setEditingCrew(null);
          }}
        />
      )}

      {/* Add button */}
      {!showForm && !editingCrew && (
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowForm(true)}
        >
          + Přidat posádku
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Crew Form
// ============================================================================

interface CrewFormData {
  name: string;
  arrivalBufferPercent: number;
  arrivalBufferFixedMinutes: number;
  workingHoursStart: string;
  workingHoursEnd: string;
}

interface CrewFormProps {
  crew: Crew | null;
  saving: boolean;
  onSave: (data: CrewFormData) => Promise<void>;
  onCancel: () => void;
}

function CrewForm({ crew, saving, onSave, onCancel }: CrewFormProps) {
  const [formData, setFormData] = useState<CrewFormData>({
    name: crew?.name || '',
    arrivalBufferPercent: crew?.arrivalBufferPercent ?? 10,
    arrivalBufferFixedMinutes: crew?.arrivalBufferFixedMinutes ?? 0,
    workingHoursStart: crew?.workingHoursStart || '08:00:00',
    workingHoursEnd: crew?.workingHoursEnd || '17:00:00',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.depotForm} onSubmit={handleSubmit}>
      <h4>{crew ? 'Upravit posádku' : 'Nová posádka'}</h4>
      
      <div className={styles.formGroup}>
        <label htmlFor="crewName">Název</label>
        <input
          type="text"
          id="crewName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          placeholder="např. Posádka 1"
        />
      </div>

      <div className={styles.crewDetailRow}>
        <div className={styles.formGroup}>
          <label htmlFor="crewWorkStart">Začátek směny</label>
          <input
            type="time"
            id="crewWorkStart"
            value={formData.workingHoursStart.slice(0, 5)}
            onChange={(e) => setFormData({ ...formData, workingHoursStart: e.target.value + ':00' })}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="crewWorkEnd">Konec směny</label>
          <input
            type="time"
            id="crewWorkEnd"
            value={formData.workingHoursEnd.slice(0, 5)}
            onChange={(e) => setFormData({ ...formData, workingHoursEnd: e.target.value + ':00' })}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="crewBuffer">Rezerva příjezdu (%)</label>
        <input
          type="number"
          id="crewBuffer"
          value={formData.arrivalBufferPercent}
          onChange={(e) => setFormData({ ...formData, arrivalBufferPercent: parseFloat(e.target.value) || 0 })}
          min={0}
          max={100}
          step={1}
        />
        <p className={styles.bufferHint}>
          Procento doby přejezdu, o které posádka přijede dříve před naplánovaným oknem.
          Např. 10 % z 60minutového přejezdu = příjezd 6 minut před oknem.
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="crewBufferFixed">Fixní rezerva příjezdu (min)</label>
        <input
          type="number"
          id="crewBufferFixed"
          value={formData.arrivalBufferFixedMinutes}
          onChange={(e) => setFormData({ ...formData, arrivalBufferFixedMinutes: parseFloat(e.target.value) || 0 })}
          min={0}
          max={120}
          step={1}
        />
        <p className={styles.bufferHint}>
          Pevná časová rezerva v minutách přidaná ke každému přejezdu navíc k procentuální rezervě.
          Celková rezerva = (přejezd × procento) + fixní minuty.
        </p>
      </div>
      
      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Zrušit
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Ukládám...' : (crew ? 'Uložit' : 'Vytvořit')}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// Workers Manager (Pracovníci)
// =============================================================================

interface WorkersManagerProps {
  workers: UserPublic[];
  onUpdate: () => Promise<void>;
}

function WorkersManager({ workers, onUpdate }: WorkersManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name || !email || !password) {
      setError('Vyplňte všechna povinná pole');
      return;
    }
    if (password.length < 8) {
      setError('Heslo musí mít alespoň 8 znaků');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await workerService.createWorker({ email, password, name });
      resetForm();
      await onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepodařilo se vytvořit pracovníka');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (workerId: string, workerName: string) => {
    if (!confirm(`Opravdu chcete smazat pracovníka "${workerName}"?`)) return;
    try {
      await workerService.deleteWorker(workerId);
      await onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nepodařilo se smazat pracovníka');
    }
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Pracovníci</h2>
        <button className={styles.addButton} onClick={() => setShowForm(true)}>
          + Přidat pracovníka
        </button>
      </div>

      <p className={styles.sectionDescription}>
        Pracovníci mají přístup k zákazníkům, kalendáři, plánovači a dalším stránkám.
        Nemohou měnit nastavení ani spravovat admin panel.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && (
        <div className={styles.formCard}>
          <h3>Nový pracovník</h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Jméno *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.input}
                placeholder="Jan Novák"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                placeholder="jan@firma.cz"
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Heslo * (min. 8 znaků)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                placeholder="Heslo pro přihlášení"
                minLength={8}
              />
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.saveButton} onClick={handleSubmit} disabled={saving}>
              {saving ? 'Ukládám...' : 'Vytvořit pracovníka'}
            </button>
            <button className={styles.cancelButton} onClick={resetForm}>
              Zrušit
            </button>
          </div>
        </div>
      )}

      {workers.length === 0 ? (
        <div className={styles.emptyState}>
          <p>Zatím nemáte žádné pracovníky.</p>
          <p>Pracovníci se mohou přihlásit pod svým účtem a pracovat se systémem.</p>
        </div>
      ) : (
        <div className={styles.crewList}>
          {workers.map((worker) => (
            <div key={worker.id} className={styles.crewCard}>
              <div className={styles.crewInfo}>
                <span className={styles.crewName}>{worker.name}</span>
                <span className={styles.crewDetail}>{worker.email}</span>
              </div>
              <div className={styles.crewActions}>
                <button
                  className={styles.deleteCrewButton}
                  onClick={() => handleDelete(worker.id, worker.name)}
                  title="Smazat pracovníka"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Settings;
