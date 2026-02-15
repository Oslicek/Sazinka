import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { useNatsStore } from '../stores/natsStore';
import { useAuthStore } from '../stores/authStore';
import * as settingsService from '../services/settingsService';
import * as crewService from '../services/crewService';
import * as workerService from '../services/workerService';
import * as roleService from '../services/roleService';
import { importCustomersBatch } from '../services/customerService';
import type { Crew } from '../services/crewService';
import type { UserPublic, RoleWithPermissions } from '@shared/auth';
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
import { RolesManager } from '../components/settings/RolesManager';
import styles from './Settings.module.css';

type SettingsTab = 'preferences' | 'work' | 'business' | 'email' | 'breaks' | 'depots' | 'crews' | 'workers' | 'import-export' | 'roles';

const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  breakEnabled: true,
  breakDurationMinutes: 45,
  breakEarliestTime: '11:30',
  breakLatestTime: '13:00',
  breakMinKm: 40,
  breakMaxKm: 120,
};

export function Settings() {
  const { t } = useTranslation('settings');
  const { isConnected } = useNatsStore();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
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
      setError(t('error_load'));
    } finally {
      setLoading(false);
    }
  }, [isConnected, t]);

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

  // Tab components - all available tabs
  const allTabs: { id: SettingsTab; label: string; permission: string }[] = [
    { id: 'preferences', label: t('tab_preferences'), permission: 'settings:preferences' },
    { id: 'work', label: t('tab_work'), permission: 'settings:work' },
    { id: 'breaks', label: t('tab_breaks'), permission: 'settings:breaks' },
    { id: 'workers', label: t('tab_workers'), permission: 'settings:workers' },
    { id: 'roles', label: t('tab_roles'), permission: 'settings:roles' },
    { id: 'crews', label: t('tab_crews'), permission: 'settings:crews' },
    { id: 'depots', label: t('tab_depots'), permission: 'settings:depots' },
    { id: 'email', label: t('tab_email'), permission: 'settings:email' },
    { id: 'business', label: t('tab_business'), permission: 'settings:business' },
    { id: 'import-export', label: t('tab_import_export'), permission: 'settings:import-export' },
  ];

  // Filter tabs based on user permissions
  const tabs = allTabs.filter((tab) => hasPermission(tab.permission));

  if (loading) {
    return (
      <div className={styles.settings}>
        <h1>{t('title')}</h1>
        <div className={styles.loading}>{t('loading')}</div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className={styles.settings}>
        <h1>{t('title')}</h1>
        <div className={styles.error}>{error}</div>
        <button className="btn-primary" onClick={loadSettings}>
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.settings}>
      <h1>{t('title')}</h1>

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
            currentLocale={user?.locale ?? i18n.language ?? 'en'}
            crews={crews.filter((c) => c.isActive)}
            depots={settings.depots}
            saving={saving}
            onSave={async (data) => {
              setSaving(true);
              setError(null);
              try {
                const updated = await settingsService.updatePreferences(data);
                await i18n.changeLanguage(data.locale);
                useAuthStore.setState((state) => (
                  state.user ? { user: { ...state.user, locale: data.locale } } : {}
                ));
                setSettings((prev) => prev ? { ...prev, preferences: updated } : null);
                showSuccess(t('success_preferences'));
              } catch (e) {
                setError(t('error_preferences'));
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
                showSuccess(t('success_work'));
              } catch (e) {
                setError(t('error_work'));
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
                showSuccess(t('success_business'));
              } catch (e) {
                setError(t('error_business'));
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
                showSuccess(t('success_email'));
              } catch (e) {
                setError(t('error_email'));
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
                showSuccess(t('success_breaks'));
              } catch (e) {
                console.error('Failed to update break settings:', e);
                setError(t('error_breaks'));
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

        {activeTab === 'roles' && (
          <RolesManager
            onUpdate={async () => {
              // Optionally reload settings or other data if needed
              await loadSettings();
            }}
          />
        )}

        {activeTab === 'import-export' && (
          <div className={styles.importExportContent}>
            {/* Export Section */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('export_title')}</h2>
              <ExportPlusPanel
                crewOptions={crews.map((c) => ({ id: c.id, label: c.name }))}
                depotOptions={(settings?.depots || []).map((d) => ({ id: d.id, label: d.name }))}
              />
            </section>

            {/* Import Section */}
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{t('import_title')}</h2>

              <div className={styles.exportContainer}>
                {/* Customers Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_customers_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_customers_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={handleOpenCustomerImport}
                    disabled={!isConnected}
                  >
                    {t('import_customers_btn')}
                  </button>
                </div>

                {/* Devices Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_devices_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_devices_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('device')}
                    disabled={!isConnected}
                  >
                    {t('import_devices_btn')}
                  </button>
                </div>

                {/* Revisions Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_revisions_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_revisions_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('revision')}
                    disabled={!isConnected}
                  >
                    {t('import_revisions_btn')}
                  </button>
                </div>

                {/* Communications Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_comm_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_comm_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('communication')}
                    disabled={!isConnected}
                  >
                    {t('import_comm_btn')}
                  </button>
                </div>

                {/* Work Log Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_worklog_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_worklog_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('work_log')}
                    disabled={!isConnected}
                  >
                    {t('import_worklog_btn')}
                  </button>
                </div>

                {/* ZIP Import */}
                <div className={styles.exportCard}>
                  <h3>{t('import_zip_title')}</h3>
                  <p className={styles.exportDescription}>
                    {t('import_zip_desc')}
                  </p>
                  <button
                    type="button"
                    className={styles.exportButton}
                    onClick={() => handleOpenImport('zip')}
                    disabled={!isConnected}
                  >
                    {t('import_zip_btn')}
                  </button>
                </div>
              </div>

              <div className={styles.importHint}>
                <p>
                  📋 <a href="/PROJECT_IMPORT.MD" target="_blank" rel="noopener noreferrer">
                    {t('import_docs_link')}
                  </a>
                </p>
                <p>
                  {t('import_order_hint')}
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
  currentLocale: string;
  crews: Crew[];
  depots: Depot[];
  saving: boolean;
  onSave: (data: { defaultCrewId: string | null; defaultDepotId: string | null; locale: string }) => Promise<void>;
}

function PreferencesForm({ defaultCrewId, defaultDepotId, currentLocale, crews, depots, saving, onSave }: PreferencesFormProps) {
  const { t } = useTranslation('settings');
  const [locale, setLocale] = useState(currentLocale.toLowerCase().startsWith('cs') ? 'cs' : 'en');
  const [crewId, setCrewId] = useState(defaultCrewId ?? '');
  const [depotId, setDepotId] = useState(defaultDepotId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      defaultCrewId: crewId || null,
      defaultDepotId: depotId || null,
      locale,
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <h3>{t('pref_title')}</h3>
      <p className={styles.formDescription}>
        {t('pref_description')}
      </p>

      <div className={styles.formGroup}>
        <label>{t('pref_language')}</label>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className={styles.input}
        >
          <option value="en">{t('pref_language_en')}</option>
          <option value="cs">{t('pref_language_cs')}</option>
        </select>
      </div>

      <div className={styles.formGroup}>
        <label>{t('pref_default_crew')}</label>
        <select
          value={crewId}
          onChange={(e) => setCrewId(e.target.value)}
          className={styles.input}
        >
          <option value="">{t('pref_no_crew')}</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label>{t('pref_default_depot')}</label>
        <select
          value={depotId}
          onChange={(e) => setDepotId(e.target.value)}
          className={styles.input}
        >
          <option value="">{t('pref_no_depot')}</option>
          {depots.map((depot) => (
            <option key={depot.id} value={depot.id}>
              {depot.name}{depot.isPrimary ? ` ${t('pref_primary')}` : ''}
            </option>
          ))}
        </select>
      </div>

      <button type="submit" className={styles.saveButton} disabled={saving}>
        {saving ? t('saving') : t('save')}
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
  const { t } = useTranslation('settings');
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
        <h3>{t('work_title')}</h3>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="workStart">{t('work_start')}</label>
            <input
              type="time"
              id="workStart"
              value={formData.workingHoursStart}
              onChange={(e) => setFormData({ ...formData, workingHoursStart: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="workEnd">{t('work_end')}</label>
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
        <h3>{t('work_revisions')}</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="maxRevisions">{t('work_max_per_day')}</label>
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
          <label htmlFor="serviceDuration">{t('work_default_duration')}</label>
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
          <label htmlFor="interval">{t('work_default_interval')}</label>
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
          {saving ? t('saving') : t('save_changes')}
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
  const { t } = useTranslation('settings');
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
        <h3>{t('business_contact')}</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="name">{t('business_full_name')}</label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
        
        <div className={styles.formGroup}>
          <label htmlFor="phone">{t('business_phone')}</label>
          <input
            type="tel"
            id="phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>{t('business_billing')}</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="businessName">{t('business_company_name')}</label>
          <input
            type="text"
            id="businessName"
            value={formData.businessName}
            onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
          />
        </div>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="ico">{t('business_ico')}</label>
            <input
              type="text"
              id="ico"
              value={formData.ico}
              onChange={(e) => setFormData({ ...formData, ico: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="dic">{t('business_dic')}</label>
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
        <h3>{t('business_address')}</h3>
        
        <div className={styles.formGroup}>
          <label htmlFor="street">{t('business_street')}</label>
          <input
            type="text"
            id="street"
            value={formData.street}
            onChange={(e) => setFormData({ ...formData, street: e.target.value })}
          />
        </div>
        
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="city">{t('business_city')}</label>
            <input
              type="text"
              id="city"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="postalCode">{t('business_postal_code')}</label>
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
          {saving ? t('saving') : t('save_changes')}
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
  const { t } = useTranslation('settings');
  const [formData, setFormData] = useState({
    confirmationSubjectTemplate: data.confirmationSubjectTemplate || i18n.t('settings:default_confirmation_subject'),
    confirmationBodyTemplate: data.confirmationBodyTemplate || i18n.t('settings:default_confirmation_body'),
    reminderSubjectTemplate: data.reminderSubjectTemplate || i18n.t('settings:default_reminder_subject'),
    reminderBodyTemplate: data.reminderBodyTemplate || i18n.t('settings:default_reminder_body'),
    reminderSendTime: data.reminderSendTime || '09:00',
    thirdSubjectTemplate: data.thirdSubjectTemplate || '',
    thirdBodyTemplate: data.thirdBodyTemplate || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.formSection}>
        <h3>{t('email_confirmation_title')}</h3>
        <p className={styles.hint}>
          {t('email_confirmation_hint')}
        </p>

        <div className={styles.formGroup}>
          <label htmlFor="subject">{t('email_subject')}</label>
          <input
            type="text"
            id="subject"
            value={formData.confirmationSubjectTemplate}
            onChange={(e) => setFormData({ ...formData, confirmationSubjectTemplate: e.target.value })}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="body">{t('email_body')}</label>
          <textarea
            id="body"
            rows={10}
            value={formData.confirmationBodyTemplate}
            onChange={(e) => setFormData({ ...formData, confirmationBodyTemplate: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>{t('email_reminder_title')}</h3>
        <p className={styles.hint}>
          {t('email_reminder_hint')}
        </p>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="reminderSendTime">{t('email_reminder_send_time')}</label>
            <input
              type="time"
              id="reminderSendTime"
              value={formData.reminderSendTime}
              onChange={(e) => setFormData({ ...formData, reminderSendTime: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="reminderSubject">{t('email_subject')}</label>
          <input
            type="text"
            id="reminderSubject"
            value={formData.reminderSubjectTemplate}
            onChange={(e) => setFormData({ ...formData, reminderSubjectTemplate: e.target.value })}
          />
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="reminderBody">{t('email_body')}</label>
          <textarea
            id="reminderBody"
            rows={10}
            value={formData.reminderBodyTemplate}
            onChange={(e) => setFormData({ ...formData, reminderBodyTemplate: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formSection}>
        <h3>{t('email_third_title')}</h3>
        <p className={styles.hint}>
          {t('email_third_hint')}
        </p>
        <div className={styles.formGroup}>
          <label htmlFor="thirdSubjectTemplate">{t('email_subject')}</label>
          <input
            type="text"
            id="thirdSubjectTemplate"
            value={formData.thirdSubjectTemplate}
            onChange={(e) => setFormData({ ...formData, thirdSubjectTemplate: e.target.value })}
            placeholder={t('email_placeholder_later')}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="thirdBodyTemplate">{t('email_body')}</label>
          <textarea
            id="thirdBodyTemplate"
            rows={8}
            value={formData.thirdBodyTemplate}
            onChange={(e) => setFormData({ ...formData, thirdBodyTemplate: e.target.value })}
            placeholder={t('email_placeholder_later')}
          />
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('saving') : t('save_changes')}
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
  const { t } = useTranslation('settings');
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
        <h3>{t('break_title')}</h3>
        <p className={styles.hint}>
          {t('break_description')}
        </p>
        
        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={formData.breakEnabled}
              onChange={(e) => setFormData({ ...formData, breakEnabled: e.target.checked })}
            />
            <span>{t('break_auto_insert')}</span>
          </label>
        </div>

        <div className={styles.formGroup}>
          <label htmlFor="duration">{t('break_duration')}</label>
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
            <label htmlFor="earliestTime">{t('break_time_from')}</label>
            <input
              type="time"
              id="earliestTime"
              value={formData.breakEarliestTime}
              onChange={(e) => setFormData({ ...formData, breakEarliestTime: e.target.value })}
              disabled={!formData.breakEnabled}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="latestTime">{t('break_time_to')}</label>
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
          {t('break_time_hint', { from: formData.breakEarliestTime, to: formData.breakLatestTime })}
        </p>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label htmlFor="minKm">{t('break_km_from')}</label>
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
            <label htmlFor="maxKm">{t('break_km_to')}</label>
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
          {t('break_km_hint', { min: formData.breakMinKm, max: formData.breakMaxKm })}
        </p>

        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={enforceDrivingBreakRule}
              onChange={(e) => setEnforceDrivingBreakRule(e.target.checked)}
            />
            <span>{t('break_driving_rule')}</span>
          </label>
        </div>
      </div>

      <div className={styles.formActions}>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('saving') : t('save_changes')}
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
  const { t } = useTranslation('settings');
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
        setError(t('depot_error_geocode'));
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
      setError(t('depot_error_create'));
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
      setError(t('depot_error_update'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (depotId: string) => {
    if (!confirm(t('depot_confirm_delete'))) return;
    
    try {
      await settingsService.deleteDepot(depotId);
      await onUpdate();
    } catch (e) {
      setError(t('depot_error_delete'));
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
      setError(t('depot_error_primary'));
    }
  };

  return (
    <div className={styles.depotsManager}>
      {error && <div className={styles.error}>{error}</div>}
      
      {/* Depot list */}
      <div className={styles.depotList}>
        {depots.length === 0 ? (
          <p className={styles.empty}>{t('depot_empty')}</p>
        ) : (
          depots.map((depot) => (
            <div key={depot.id} className={`${styles.depotCard} ${depot.isPrimary ? styles.primary : ''}`}>
              <div className={styles.depotInfo}>
                <div className={styles.depotHeader}>
                  <strong>{depot.name}</strong>
                  {depot.isPrimary && <span className={styles.primaryBadge}>{t('depot_primary')}</span>}
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
                    title={t('depot_set_primary')}
                  >
                    ⭐
                  </button>
                )}
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setEditingDepot(depot)}
                  title={t('edit')}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  onClick={() => handleDelete(depot.id)}
                  title={t('delete_action')}
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
          {t('depot_add')}
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
  const { t } = useTranslation('settings');
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
      <h4>{depot ? t('depot_edit_title') : t('depot_new_title')}</h4>
      
      <div className={styles.formGroup}>
        <label htmlFor="depotName">{t('depot_name')}</label>
        <input
          type="text"
          id="depotName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      
      <div className={styles.formGroup}>
        <label htmlFor="depotStreet">{t('depot_street')}</label>
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
          <label htmlFor="depotCity">{t('depot_city')}</label>
          <input
            type="text"
            id="depotCity"
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="depotPostalCode">{t('depot_postal_code')}</label>
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
          {t('common:cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('saving') : (depot ? t('save') : t('depot_create'))}
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
  const { t } = useTranslation('settings');
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
      setError(t('crew_error_create'));
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
      setError(t('crew_error_update'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (crewId: string) => {
    if (!confirm(t('crew_confirm_delete'))) return;
    
    try {
      await crewService.deleteCrew(crewId);
      await onUpdate();
    } catch (e) {
      setError(t('crew_error_delete'));
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
      setError(t('crew_error_toggle'));
    }
  };

  return (
    <div className={styles.depotsManager}>
      {error && <div className={styles.error}>{error}</div>}
      
      {/* Crew list */}
      <div className={styles.depotList}>
        {crews.length === 0 ? (
          <p className={styles.empty}>{t('crew_empty')}</p>
        ) : (
          crews.map((crew) => (
            <div key={crew.id} className={`${styles.depotCard} ${!crew.isActive ? styles.inactive : ''}`}>
              <div className={styles.depotInfo}>
                <div className={styles.depotHeader}>
                  <strong>{crew.name}</strong>
                  {!crew.isActive && <span className={styles.inactiveBadge}>{t('crew_inactive')}</span>}
                </div>
                <small>
                  {crew.workingHoursStart?.slice(0, 5) || '08:00'}–{crew.workingHoursEnd?.slice(0, 5) || '17:00'}
                  {' · '}
                  {t('crew_buffer')} {crew.arrivalBufferPercent ?? 10} %{(crew.arrivalBufferFixedMinutes ?? 0) > 0 ? ` + ${crew.arrivalBufferFixedMinutes} min` : ''}
                </small>
              </div>
              <div className={styles.depotActions}>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => handleToggleActive(crew)}
                  title={crew.isActive ? t('crew_deactivate') : t('crew_activate')}
                >
                  {crew.isActive ? '✓' : '○'}
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => setEditingCrew(crew)}
                  title={t('edit')}
                >
                  ✏️
                </button>
                <button
                  type="button"
                  className={`${styles.iconButton} ${styles.danger}`}
                  onClick={() => handleDelete(crew.id)}
                  title={t('delete_action')}
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
          {t('crew_add')}
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
  const { t } = useTranslation('settings');
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
      <h4>{crew ? t('crew_edit_title') : t('crew_new_title')}</h4>
      
      <div className={styles.formGroup}>
        <label htmlFor="crewName">{t('crew_name')}</label>
        <input
          type="text"
          id="crewName"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          placeholder={t('crew_name_placeholder')}
        />
      </div>

      <div className={styles.crewDetailRow}>
        <div className={styles.formGroup}>
          <label htmlFor="crewWorkStart">{t('crew_shift_start')}</label>
          <input
            type="time"
            id="crewWorkStart"
            value={formData.workingHoursStart.slice(0, 5)}
            onChange={(e) => setFormData({ ...formData, workingHoursStart: e.target.value + ':00' })}
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="crewWorkEnd">{t('crew_shift_end')}</label>
          <input
            type="time"
            id="crewWorkEnd"
            value={formData.workingHoursEnd.slice(0, 5)}
            onChange={(e) => setFormData({ ...formData, workingHoursEnd: e.target.value + ':00' })}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="crewBuffer">{t('crew_arrival_buffer_percent')}</label>
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
          {t('crew_arrival_buffer_hint')}
        </p>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="crewBufferFixed">{t('crew_arrival_buffer_fixed')}</label>
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
          {t('crew_arrival_buffer_fixed_hint')}
        </p>
      </div>
      
      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('common:cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? t('saving') : (crew ? t('save') : t('crew_create'))}
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
  const { t } = useTranslation('settings');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [workerRoles, setWorkerRoles] = useState<Map<string, RoleWithPermissions[]>>(new Map());
  const [editingWorkerRoles, setEditingWorkerRoles] = useState<string | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [initialRoleIds, setInitialRoleIds] = useState<Set<string>>(new Set());

  // Load roles on mount
  useEffect(() => {
    const loadRoles = async () => {
      try {
        const data = await roleService.listRoles();
        setRoles(data);
      } catch (e) {
        console.error('Failed to load roles:', e);
      }
    };
    loadRoles();
  }, []);

  // Load worker roles
  useEffect(() => {
    const loadWorkerRoles = async () => {
      const rolesMap = new Map<string, RoleWithPermissions[]>();
      for (const worker of workers) {
        try {
          const roles = await roleService.getUserRoles(worker.id);
          rolesMap.set(worker.id, roles);
        } catch (e) {
          console.error(`Failed to load roles for worker ${worker.id}:`, e);
        }
      }
      setWorkerRoles(rolesMap);
    };
    if (workers.length > 0) {
      loadWorkerRoles();
    }
  }, [workers]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setInitialRoleIds(new Set());
    setShowForm(false);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!name || !email || !password) {
      setError(t('worker_error_required'));
      return;
    }
    if (password.length < 8) {
      setError(t('worker_error_password'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const roleIds = Array.from(initialRoleIds);
      await workerService.createWorker({ email, password, name, roleIds });
      resetForm();
      await onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('worker_error_create'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (workerId: string, workerName: string) => {
    if (!confirm(t('worker_confirm_delete', { name: workerName }))) return;
    try {
      await workerService.deleteWorker(workerId);
      await onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('worker_error_delete'));
    }
  };

  const handleEditRoles = (workerId: string) => {
    const currentRoles = workerRoles.get(workerId) || [];
    setSelectedRoleIds(new Set(currentRoles.map((r) => r.id)));
    setEditingWorkerRoles(workerId);
  };

  const handleSaveRoles = async () => {
    if (!editingWorkerRoles) return;
    try {
      await roleService.setUserRoles({
        userId: editingWorkerRoles,
        roleIds: Array.from(selectedRoleIds),
      });
      setEditingWorkerRoles(null);
      setSelectedRoleIds(new Set());
      // Reload worker roles
      const roles = await roleService.getUserRoles(editingWorkerRoles);
      setWorkerRoles(new Map(workerRoles.set(editingWorkerRoles, roles)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('worker_error_roles'));
    }
  };

  const handleCancelEditRoles = () => {
    setEditingWorkerRoles(null);
    setSelectedRoleIds(new Set());
  };

  const toggleRole = (roleId: string) => {
    const newSet = new Set(selectedRoleIds);
    if (newSet.has(roleId)) {
      newSet.delete(roleId);
    } else {
      newSet.add(roleId);
    }
    setSelectedRoleIds(newSet);
  };

  const toggleInitialRole = (roleId: string) => {
    const newSet = new Set(initialRoleIds);
    if (newSet.has(roleId)) {
      newSet.delete(roleId);
    } else {
      newSet.add(roleId);
    }
    setInitialRoleIds(newSet);
  };

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>{t('worker_title')}</h2>
        <button className={styles.addButton} onClick={() => setShowForm(true)}>
          {t('worker_add')}
        </button>
      </div>

      <p className={styles.sectionDescription}>
        {t('worker_description')}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {showForm && (
        <div className={styles.formCard}>
          <h3>{t('worker_new')}</h3>
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.label}>{t('worker_name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.input}
                placeholder={t('worker_name_placeholder')}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.input}
                placeholder={t('worker_email_placeholder')}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>{t('worker_password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                placeholder={t('worker_password_placeholder')}
                minLength={8}
              />
            </div>
          </div>
          
          {roles.length > 0 && (
            <div className={styles.formGroup} style={{ marginTop: '1rem' }}>
              <label className={styles.label}>{t('worker_roles')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                {roles.map((role) => (
                  <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={initialRoleIds.has(role.id)}
                      onChange={() => toggleInitialRole(role.id)}
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          
          <div className={styles.formActions}>
            <button className={styles.saveButton} onClick={handleSubmit} disabled={saving}>
              {saving ? t('saving') : t('worker_create')}
            </button>
            <button className={styles.cancelButton} onClick={resetForm}>
              {t('common:cancel')}
            </button>
          </div>
        </div>
      )}

      {workers.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{t('worker_empty')}</p>
          <p>{t('worker_empty_hint')}</p>
        </div>
      ) : (
        <div className={styles.crewList}>
          {workers.map((worker) => (
            <div key={worker.id} className={styles.crewCard}>
              <div className={styles.crewInfo}>
                <span className={styles.crewName}>{worker.name}</span>
                <span className={styles.crewDetail}>{worker.email}</span>
                {workerRoles.get(worker.id) && workerRoles.get(worker.id)!.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {workerRoles.get(worker.id)!.map((role) => (
                      <span
                        key={role.id}
                        style={{
                          padding: '0.25rem 0.5rem',
                          background: 'var(--color-primary)',
                          color: 'white',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                        }}
                      >
                        {role.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.crewActions}>
                {roles.length > 0 && (
                  <button
                    className={styles.editCrewButton}
                    onClick={() => handleEditRoles(worker.id)}
                    title={t('worker_edit_roles')}
                  >
                    🔑
                  </button>
                )}
                <button
                  className={styles.deleteCrewButton}
                  onClick={() => handleDelete(worker.id, worker.name)}
                  title={t('worker_delete')}
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
