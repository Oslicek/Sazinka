import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../stores/natsStore';
import { AddressMap } from '../components/customers/AddressMap';
import * as settingsService from '../services/settingsService';
import type { 
  Depot, 
  UserSettings, 
  WorkConstraints,
  BusinessInfo,
  EmailTemplateSettings,
  CreateDepotRequest 
} from '@shared/settings';
import styles from './Settings.module.css';

// Temporary user ID (will be replaced with auth)
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export function Settings() {
  const { isConnected: connected } = useNatsStore();
  
  // State
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'depots' | 'work' | 'business'>('depots');
  
  // Saving states
  const [isSavingWork, setIsSavingWork] = useState(false);
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  
  // Form states (local edits before save)
  const [workForm, setWorkForm] = useState<WorkConstraints | null>(null);
  const [businessForm, setBusinessForm] = useState<BusinessInfo | null>(null);
  const [emailForm, setEmailForm] = useState<EmailTemplateSettings | null>(null);
  
  // Depot editing state
  const [editingDepot, setEditingDepot] = useState<Depot | null>(null);
  const [newDepot, setNewDepot] = useState<CreateDepotRequest | null>(null);
  const [isSavingDepot, setIsSavingDepot] = useState(false);
  const [isDeletingDepot, setIsDeletingDepot] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await settingsService.getSettings(TEMP_USER_ID);
      setSettings(data);
      setWorkForm(data.workConstraints);
      setBusinessForm(data.businessInfo);
      setEmailForm(data.emailTemplates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // Work Constraints Handlers
  // ============================================================================

  const handleWorkChange = (field: keyof WorkConstraints, value: string | number | number[]) => {
    if (!workForm) return;
    setWorkForm({ ...workForm, [field]: value });
  };

  const handleSaveWork = async () => {
    if (!workForm) return;
    
    try {
      setIsSavingWork(true);
      const updated = await settingsService.updateWorkConstraints(TEMP_USER_ID, workForm);
      setSettings(prev => prev ? { ...prev, workConstraints: updated } : null);
      setWorkForm(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save work constraints');
    } finally {
      setIsSavingWork(false);
    }
  };

  // ============================================================================
  // Business Info Handlers
  // ============================================================================

  const handleBusinessChange = (field: keyof BusinessInfo, value: string) => {
    if (!businessForm) return;
    setBusinessForm({ ...businessForm, [field]: value });
  };

  const handleSaveBusiness = async () => {
    if (!businessForm) return;
    
    try {
      setIsSavingBusiness(true);
      const updated = await settingsService.updateBusinessInfo(TEMP_USER_ID, businessForm);
      setSettings(prev => prev ? { ...prev, businessInfo: updated } : null);
      setBusinessForm(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save business info');
    } finally {
      setIsSavingBusiness(false);
    }
  };

  // ============================================================================
  // Email Templates Handlers
  // ============================================================================

  const handleEmailChange = (field: keyof EmailTemplateSettings, value: string) => {
    if (!emailForm) return;
    setEmailForm({ ...emailForm, [field]: value });
  };

  const handleSaveEmail = async () => {
    if (!emailForm) return;
    
    try {
      setIsSavingEmail(true);
      const updated = await settingsService.updateEmailTemplates(TEMP_USER_ID, emailForm);
      setSettings(prev => prev ? { ...prev, emailTemplates: updated } : null);
      setEmailForm(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save email templates');
    } finally {
      setIsSavingEmail(false);
    }
  };

  // ============================================================================
  // Depot Handlers
  // ============================================================================

  const handleAddDepot = () => {
    setNewDepot({
      name: 'Nové depo',
      lat: 50.0755, // Prague default
      lng: 14.4378,
      isPrimary: settings?.depots.length === 0,
    });
    setEditingDepot(null);
  };

  const handleEditDepot = (depot: Depot) => {
    setEditingDepot(depot);
    setNewDepot(null);
  };

  const handleCancelDepotEdit = () => {
    setEditingDepot(null);
    setNewDepot(null);
  };

  const handleSaveNewDepot = async () => {
    if (!newDepot) return;
    
    try {
      setIsSavingDepot(true);
      const created = await settingsService.createDepot(TEMP_USER_ID, newDepot);
      setSettings(prev => prev ? { 
        ...prev, 
        depots: [...prev.depots, created] 
      } : null);
      setNewDepot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create depot');
    } finally {
      setIsSavingDepot(false);
    }
  };

  const handleUpdateDepot = async () => {
    if (!editingDepot) return;
    
    try {
      setIsSavingDepot(true);
      const updated = await settingsService.updateDepot(TEMP_USER_ID, {
        id: editingDepot.id,
        name: editingDepot.name,
        street: editingDepot.street,
        city: editingDepot.city,
        postalCode: editingDepot.postalCode,
        lat: editingDepot.lat,
        lng: editingDepot.lng,
        isPrimary: editingDepot.isPrimary,
      });
      setSettings(prev => prev ? {
        ...prev,
        depots: prev.depots.map(d => d.id === updated.id ? updated : d)
      } : null);
      setEditingDepot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update depot');
    } finally {
      setIsSavingDepot(false);
    }
  };

  const handleDeleteDepot = async (depotId: string) => {
    if (!confirm('Opravdu chcete smazat toto depo?')) return;
    
    try {
      setIsDeletingDepot(depotId);
      await settingsService.deleteDepot(TEMP_USER_ID, depotId);
      setSettings(prev => prev ? {
        ...prev,
        depots: prev.depots.filter(d => d.id !== depotId)
      } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete depot');
    } finally {
      setIsDeletingDepot(null);
    }
  };

  const handleDepotPositionChange = (lat: number, lng: number) => {
    if (editingDepot) {
      setEditingDepot({ ...editingDepot, lat, lng });
    } else if (newDepot) {
      setNewDepot({ ...newDepot, lat, lng });
    }
  };

  const handleGeocodeDepot = async (street: string, city: string, postalCode: string) => {
    try {
      const result = await settingsService.geocodeDepotAddress(TEMP_USER_ID, { street, city, postalCode });
      if (result.geocoded && result.coordinates) {
        handleDepotPositionChange(result.coordinates.lat, result.coordinates.lng);
      }
    } catch (err) {
      console.error('Geocoding failed:', err);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Načítám nastavení...</div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h2>Chyba</h2>
          <p>{error}</p>
          <button onClick={loadSettings} className={styles.primaryButton}>
            Zkusit znovu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Nastavení</h1>
      </header>

      {error && (
        <div className={styles.errorBanner}>
          {error}
          <button onClick={() => setError(null)} className={styles.errorClose}>×</button>
        </div>
      )}

      {/* Tabs */}
      <nav className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'depots' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('depots')}
        >
          Depa
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'work' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('work')}
        >
          Pracovní doba
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'business' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('business')}
        >
          Firemní údaje
        </button>
      </nav>

      {/* Depots Tab */}
      {activeTab === 'depots' && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Depa</h2>
              <p className={styles.sectionDescription}>
                Místa, odkud vyrážíte a kam se vracíte. Můžete mít jedno nebo více dep.
              </p>
            </div>
            <button onClick={handleAddDepot} className={styles.primaryButton}>
              + Přidat depo
            </button>
          </div>

          {/* New depot form */}
          {newDepot && (
            <div className={styles.depotForm}>
              <h3>Nové depo</h3>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label>Název depa</label>
                  <input
                    type="text"
                    value={newDepot.name}
                    onChange={(e) => setNewDepot({ ...newDepot, name: e.target.value })}
                    placeholder="Např. Sklad Praha"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>
                    <input
                      type="checkbox"
                      checked={newDepot.isPrimary || false}
                      onChange={(e) => setNewDepot({ ...newDepot, isPrimary: e.target.checked })}
                    />
                    {' '}Primární depo
                  </label>
                </div>
              </div>
              
              <div className={styles.addressRow}>
                <div className={styles.formGroup}>
                  <label>Ulice</label>
                  <input
                    type="text"
                    value={newDepot.street || ''}
                    onChange={(e) => setNewDepot({ ...newDepot, street: e.target.value })}
                    placeholder="Ulice a číslo"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Město</label>
                  <input
                    type="text"
                    value={newDepot.city || ''}
                    onChange={(e) => setNewDepot({ ...newDepot, city: e.target.value })}
                    placeholder="Město"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>PSČ</label>
                  <input
                    type="text"
                    value={newDepot.postalCode || ''}
                    onChange={(e) => setNewDepot({ ...newDepot, postalCode: e.target.value })}
                    placeholder="PSČ"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleGeocodeDepot(
                    newDepot.street || '',
                    newDepot.city || '',
                    newDepot.postalCode || ''
                  )}
                  className={styles.secondaryButton}
                  disabled={!newDepot.street && !newDepot.city}
                >
                  Najít na mapě
                </button>
              </div>

              <div className={styles.mapContainer}>
                <AddressMap
                  lat={newDepot.lat}
                  lng={newDepot.lng}
                  onPositionChange={handleDepotPositionChange}
                  draggable={true}
                />
              </div>

              <div className={styles.formActions}>
                <button onClick={handleCancelDepotEdit} className={styles.secondaryButton}>
                  Zrušit
                </button>
                <button
                  onClick={handleSaveNewDepot}
                  className={styles.primaryButton}
                  disabled={isSavingDepot}
                >
                  {isSavingDepot ? 'Ukládám...' : 'Uložit depo'}
                </button>
              </div>
            </div>
          )}

          {/* Existing depots */}
          <div className={styles.depotsList}>
            {settings?.depots.map((depot) => (
              <div key={depot.id} className={styles.depotCard}>
                {editingDepot?.id === depot.id ? (
                  // Editing mode
                  <div className={styles.depotForm}>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <label>Název depa</label>
                        <input
                          type="text"
                          value={editingDepot.name}
                          onChange={(e) => setEditingDepot({ ...editingDepot, name: e.target.value })}
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <label>
                          <input
                            type="checkbox"
                            checked={editingDepot.isPrimary}
                            onChange={(e) => setEditingDepot({ ...editingDepot, isPrimary: e.target.checked })}
                          />
                          {' '}Primární depo
                        </label>
                      </div>
                    </div>

                    <div className={styles.addressRow}>
                      <div className={styles.formGroup}>
                        <label>Ulice</label>
                        <input
                          type="text"
                          value={editingDepot.street || ''}
                          onChange={(e) => setEditingDepot({ ...editingDepot, street: e.target.value })}
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <label>Město</label>
                        <input
                          type="text"
                          value={editingDepot.city || ''}
                          onChange={(e) => setEditingDepot({ ...editingDepot, city: e.target.value })}
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <label>PSČ</label>
                        <input
                          type="text"
                          value={editingDepot.postalCode || ''}
                          onChange={(e) => setEditingDepot({ ...editingDepot, postalCode: e.target.value })}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGeocodeDepot(
                          editingDepot.street || '',
                          editingDepot.city || '',
                          editingDepot.postalCode || ''
                        )}
                        className={styles.secondaryButton}
                      >
                        Najít na mapě
                      </button>
                    </div>

                    <div className={styles.mapContainer}>
                      <AddressMap
                        lat={editingDepot.lat}
                        lng={editingDepot.lng}
                        onPositionChange={handleDepotPositionChange}
                        draggable={true}
                      />
                    </div>

                    <div className={styles.formActions}>
                      <button onClick={handleCancelDepotEdit} className={styles.secondaryButton}>
                        Zrušit
                      </button>
                      <button
                        onClick={handleUpdateDepot}
                        className={styles.primaryButton}
                        disabled={isSavingDepot}
                      >
                        {isSavingDepot ? 'Ukládám...' : 'Uložit změny'}
                      </button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <>
                    <div className={styles.depotHeader}>
                      <div className={styles.depotInfo}>
                        <h3>{depot.name}</h3>
                        {depot.isPrimary && <span className={styles.primaryBadge}>Primární</span>}
                      </div>
                      <div className={styles.depotActions}>
                        <button
                          onClick={() => handleEditDepot(depot)}
                          className={styles.smallButton}
                        >
                          Upravit
                        </button>
                        <button
                          onClick={() => handleDeleteDepot(depot.id)}
                          className={styles.dangerSmallButton}
                          disabled={isDeletingDepot === depot.id}
                        >
                          {isDeletingDepot === depot.id ? 'Mažu...' : 'Smazat'}
                        </button>
                      </div>
                    </div>
                    {depot.street && (
                      <p className={styles.depotAddress}>
                        {depot.street}, {depot.city} {depot.postalCode}
                      </p>
                    )}
                    <div className={styles.mapContainerSmall}>
                      <AddressMap
                        lat={depot.lat}
                        lng={depot.lng}
                        draggable={false}
                      />
                    </div>
                  </>
                )}
              </div>
            ))}

            {settings?.depots.length === 0 && !newDepot && (
              <div className={styles.emptyState}>
                <p>Zatím nemáte žádné depo.</p>
                <button onClick={handleAddDepot} className={styles.primaryButton}>
                  Přidat první depo
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Work Constraints Tab */}
      {activeTab === 'work' && workForm && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Pracovní doba a limity</h2>
              <p className={styles.sectionDescription}>
                Nastavení pracovní doby a omezení pro plánování tras.
              </p>
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label>Začátek pracovní doby</label>
              <input
                type="time"
                value={workForm.workingHoursStart}
                onChange={(e) => handleWorkChange('workingHoursStart', e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Konec pracovní doby</label>
              <input
                type="time"
                value={workForm.workingHoursEnd}
                onChange={(e) => handleWorkChange('workingHoursEnd', e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Max. návštěv za den</label>
              <input
                type="number"
                min={1}
                max={50}
                value={workForm.maxRevisionsPerDay}
                onChange={(e) => handleWorkChange('maxRevisionsPerDay', parseInt(e.target.value))}
              />
            </div>
            <div className={styles.formGroup}>
              <label>Obvyklá délka návštěvy (min)</label>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={workForm.defaultServiceDurationMinutes}
                onChange={(e) => handleWorkChange('defaultServiceDurationMinutes', parseInt(e.target.value))}
              />
              <span className={styles.hint}>Výchozí čas strávený u zákazníka</span>
            </div>
            <div className={styles.formGroup}>
              <label>Interval revizí (měsíců)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={workForm.defaultRevisionIntervalMonths}
                onChange={(e) => handleWorkChange('defaultRevisionIntervalMonths', parseInt(e.target.value))}
              />
              <span className={styles.hint}>Výchozí interval mezi revizemi</span>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Upozornění před revizí (dny)</label>
            <input
              type="text"
              value={workForm.reminderDaysBefore.join(', ')}
              onChange={(e) => {
                const days = e.target.value
                  .split(',')
                  .map(s => parseInt(s.trim()))
                  .filter(n => !isNaN(n) && n > 0);
                handleWorkChange('reminderDaysBefore', days);
              }}
              placeholder="30, 14, 7"
            />
            <span className={styles.hint}>Kolik dní před termínem poslat upomínku (oddělte čárkou)</span>
          </div>

          <div className={styles.formActions}>
            <button
              onClick={handleSaveWork}
              className={styles.primaryButton}
              disabled={isSavingWork}
            >
              {isSavingWork ? 'Ukládám...' : 'Uložit nastavení'}
            </button>
          </div>
        </section>
      )}

      {/* Business Info Tab */}
      {activeTab === 'business' && businessForm && emailForm && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Firemní údaje</h2>
                <p className={styles.sectionDescription}>
                  Informace o vás nebo vaší firmě. Použijí se v emailech zákazníkům.
                </p>
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Jméno / Kontaktní osoba *</label>
                <input
                  type="text"
                  value={businessForm.name}
                  onChange={(e) => handleBusinessChange('name', e.target.value)}
                  placeholder="Jan Novák"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Název firmy</label>
                <input
                  type="text"
                  value={businessForm.businessName || ''}
                  onChange={(e) => handleBusinessChange('businessName', e.target.value)}
                  placeholder="Revize s.r.o."
                />
              </div>
              <div className={styles.formGroup}>
                <label>Email *</label>
                <input
                  type="email"
                  value={businessForm.email}
                  onChange={(e) => handleBusinessChange('email', e.target.value)}
                  placeholder="info@example.cz"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Telefon</label>
                <input
                  type="tel"
                  value={businessForm.phone || ''}
                  onChange={(e) => handleBusinessChange('phone', e.target.value)}
                  placeholder="+420 123 456 789"
                />
              </div>
              <div className={styles.formGroup}>
                <label>IČO</label>
                <input
                  type="text"
                  value={businessForm.ico || ''}
                  onChange={(e) => handleBusinessChange('ico', e.target.value)}
                  placeholder="12345678"
                />
              </div>
              <div className={styles.formGroup}>
                <label>DIČ</label>
                <input
                  type="text"
                  value={businessForm.dic || ''}
                  onChange={(e) => handleBusinessChange('dic', e.target.value)}
                  placeholder="CZ12345678"
                />
              </div>
            </div>

            <h3 className={styles.subheading}>Adresa sídla</h3>
            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label>Ulice</label>
                <input
                  type="text"
                  value={businessForm.street || ''}
                  onChange={(e) => handleBusinessChange('street', e.target.value)}
                  placeholder="Ulice a číslo"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Město</label>
                <input
                  type="text"
                  value={businessForm.city || ''}
                  onChange={(e) => handleBusinessChange('city', e.target.value)}
                  placeholder="Město"
                />
              </div>
              <div className={styles.formGroup}>
                <label>PSČ</label>
                <input
                  type="text"
                  value={businessForm.postalCode || ''}
                  onChange={(e) => handleBusinessChange('postalCode', e.target.value)}
                  placeholder="PSČ"
                />
              </div>
            </div>

            <div className={styles.formActions}>
              <button
                onClick={handleSaveBusiness}
                className={styles.primaryButton}
                disabled={isSavingBusiness}
              >
                {isSavingBusiness ? 'Ukládám...' : 'Uložit firemní údaje'}
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Šablona emailu</h2>
                <p className={styles.sectionDescription}>
                  Výchozí text pro upomínkové emaily. Můžete použít proměnné v dvojitých závorkách.
                </p>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Předmět emailu</label>
              <input
                type="text"
                value={emailForm.emailSubjectTemplate}
                onChange={(e) => handleEmailChange('emailSubjectTemplate', e.target.value)}
                placeholder="Připomínka revize - {{device_type}}"
              />
            </div>

            <div className={styles.formGroup}>
              <label>Tělo emailu</label>
              <textarea
                value={emailForm.emailBodyTemplate}
                onChange={(e) => handleEmailChange('emailBodyTemplate', e.target.value)}
                rows={12}
                className={styles.textarea}
              />
            </div>

            <div className={styles.variablesHelp}>
              <h4>Dostupné proměnné:</h4>
              <ul>
                <li><code>{'{{customer_name}}'}</code> - Jméno zákazníka</li>
                <li><code>{'{{device_type}}'}</code> - Typ zařízení</li>
                <li><code>{'{{due_date}}'}</code> - Datum revize</li>
                <li><code>{'{{business_name}}'}</code> - Název vaší firmy</li>
                <li><code>{'{{phone}}'}</code> - Váš telefon</li>
                <li><code>{'{{email}}'}</code> - Váš email</li>
              </ul>
            </div>

            <div className={styles.formActions}>
              <button
                onClick={handleSaveEmail}
                className={styles.primaryButton}
                disabled={isSavingEmail}
              >
                {isSavingEmail ? 'Ukládám...' : 'Uložit šablonu'}
              </button>
            </div>
          </section>
        </>
      )}

      {!connected && (
        <div className={styles.connectionBanner}>
          Odpojeno od serveru. Změny se neuloží.
        </div>
      )}
    </div>
  );
}
