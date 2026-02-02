import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Customer, CreateCustomerRequest, UpdateCustomerRequest, CustomerType, Coordinates } from '@shared/customer';
import {
  validateCustomerForm,
  isFormValid,
  type CustomerFormData,
  type ValidationErrors,
} from '../../utils/customerValidation';
import { 
  submitGeocodeJob, 
  subscribeToGeocodeJobStatus,
  submitGeocodeAddressJob,
  subscribeToGeocodeAddressJobStatus,
  submitReverseGeocodeJob,
  subscribeToReverseGeocodeJobStatus,
  type GeocodeJobStatusUpdate,
  type GeocodeAddressJobStatusUpdate,
  type ReverseGeocodeJobStatusUpdate,
} from '../../services/customerService';
import { AddressMap } from './AddressMap';
import { JobStatusTimeline } from '../common/JobStatusTimeline';
import type { JobStatus } from '../../types/jobStatus';
import styles from './AddCustomerForm.module.css';

interface CustomerFormProps {
  /** Initial customer data for edit mode */
  customer?: Customer;
  /** Called on submit with the form data */
  onSubmit: (data: CreateCustomerRequest | UpdateCustomerRequest) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  onGeocodeCompleted?: () => void;
}

interface ExtendedFormData extends CustomerFormData {
  type: CustomerType;
  contactPerson: string;
  ico: string;
  dic: string;
}

const createInitialFormData = (customer?: Customer): ExtendedFormData => ({
  type: customer?.type ?? 'person',
  name: customer?.name ?? '',
  contactPerson: customer?.contactPerson ?? '',
  ico: customer?.ico ?? '',
  dic: customer?.dic ?? '',
  email: customer?.email ?? '',
  phone: customer?.phone ?? '',
  street: customer?.street ?? '',
  city: customer?.city ?? '',
  postalCode: customer?.postalCode ?? '',
  notes: customer?.notes ?? '',
});

const normalizeAddressKey = (street: string, city: string, postalCode: string) => {
  return `${street.trim()}|${city.trim()}|${postalCode.replace(/\s/g, '')}`;
};

export function CustomerForm({ customer, onSubmit, onCancel, isSubmitting = false, onGeocodeCompleted }: CustomerFormProps) {
  const isEditMode = !!customer;
  const [formData, setFormData] = useState<ExtendedFormData>(() => createInitialFormData(customer));
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  
  // Coordinate state (manual adjustment only)
  const [coordinates, setCoordinates] = useState<Coordinates | null>(
    customer?.lat && customer?.lng ? { lat: customer.lat, lng: customer.lng } : null
  );
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJobStatusUpdate | GeocodeAddressJobStatusUpdate | ReverseGeocodeJobStatusUpdate | null>(null);
  const [isGeocodeSubmitting, setIsGeocodeSubmitting] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [autoCenterMap, setAutoCenterMap] = useState(() => Boolean(customer?.lat && customer?.lng));
  const [needsRecenter, setNeedsRecenter] = useState(false);
  const [mapMoved, setMapMoved] = useState(false);
  const geocodeUnsubscribeRef = useRef<(() => void) | null>(null);
  const suppressMapInteractionRef = useRef(true);
  const [lastGeocodedAddress, setLastGeocodedAddress] = useState(() =>
    customer ? normalizeAddressKey(customer.street, customer.city, customer.postalCode) : null
  );

  // Handle manual position adjustment from map
  const handlePositionChange = useCallback((lat: number, lng: number) => {
    setCoordinates({ lat, lng });
  }, []);

  const handleChange = useCallback((field: keyof ExtendedFormData, value: string | CustomerType) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field as keyof ValidationErrors]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field as keyof ValidationErrors];
        return next;
      });
    }
    
    // Reset coordinates when address changes (geocoding will run asynchronously after save)
    if (['street', 'city', 'postalCode'].includes(field)) {
      setCoordinates(null);
    }
  }, [errors]);

  const handleGeocode = useCallback(async () => {
    if (!customer) return;
    const currentAddressKey = normalizeAddressKey(formData.street, formData.city, formData.postalCode);
    if (lastGeocodedAddress && currentAddressKey === lastGeocodedAddress && mapMoved) {
      suppressMapInteractionRef.current = true;
      setAutoCenterMap(true);
      setNeedsRecenter(false);
      setMapMoved(false);
      return;
    }
    setIsGeocodeSubmitting(true);
    try {
      const job = await submitGeocodeAddressJob(customer.userId, {
        street: formData.street.trim(),
        city: formData.city.trim(),
        postalCode: formData.postalCode.replace(/\s/g, ''),
      });
      setGeocodeJob({
        jobId: job.jobId,
        timestamp: new Date().toISOString(),
        status: { type: 'queued', position: 1 },
      });
      if (geocodeUnsubscribeRef.current) {
        geocodeUnsubscribeRef.current();
      }
      const unsubscribe = await subscribeToGeocodeAddressJobStatus(job.jobId, (update) => {
        setGeocodeJob(update);
        if (update.status.type === 'completed') {
          setCoordinates(update.status.coordinates);
          suppressMapInteractionRef.current = true;
          setAutoCenterMap(true);
          setNeedsRecenter(false);
          setMapMoved(false);
          setLastGeocodedAddress(
            normalizeAddressKey(formData.street, formData.city, formData.postalCode)
          );
          setIsGeocodeSubmitting(false);
          if (geocodeUnsubscribeRef.current) {
            geocodeUnsubscribeRef.current();
            geocodeUnsubscribeRef.current = null;
          }
        } else if (update.status.type === 'failed') {
          setIsGeocodeSubmitting(false);
          if (geocodeUnsubscribeRef.current) {
            geocodeUnsubscribeRef.current();
            geocodeUnsubscribeRef.current = null;
          }
        }
      });
      geocodeUnsubscribeRef.current = unsubscribe;
    } catch (err) {
      setIsGeocodeSubmitting(false);
      setGeocodeJob({
        jobId: 'unknown',
        timestamp: new Date().toISOString(),
        status: { type: 'failed', error: err instanceof Error ? err.message : 'Neznámá chyba' },
      });
    }
  }, [
    customer,
    formData.street,
    formData.city,
    formData.postalCode,
    lastGeocodedAddress,
    mapMoved,
  ]);

  const handleAutoCenterComplete = useCallback(() => {
    setAutoCenterMap(false);
    suppressMapInteractionRef.current = false;
  }, []);

  const handlePickAddress = useCallback(() => {
    setIsPicking(true);
  }, []);

  const handleMapPick = useCallback(async (lat: number, lng: number) => {
    if (!customer) return;
    setCoordinates({ lat, lng });
    setIsPicking(false);
    setIsGeocodeSubmitting(true);
    try {
      const job = await submitReverseGeocodeJob(customer.userId, {
        customerId: customer.id,
        lat,
        lng,
      });
      setGeocodeJob({
        jobId: job.jobId,
        timestamp: new Date().toISOString(),
        status: { type: 'queued', position: 1 },
      });
      if (geocodeUnsubscribeRef.current) {
        geocodeUnsubscribeRef.current();
      }
      const unsubscribe = await subscribeToReverseGeocodeJobStatus(job.jobId, (update) => {
        setGeocodeJob(update);
        if (update.status.type === 'completed') {
          setFormData((prev) => ({
            ...prev,
            street: update.status.street,
            city: update.status.city,
            postalCode: update.status.postalCode,
          }));
          setIsGeocodeSubmitting(false);
          setNeedsRecenter(false);
          setLastGeocodedAddress(
            normalizeAddressKey(update.status.street, update.status.city, update.status.postalCode)
          );
          if (onGeocodeCompleted) {
            onGeocodeCompleted();
          }
          if (geocodeUnsubscribeRef.current) {
            geocodeUnsubscribeRef.current();
            geocodeUnsubscribeRef.current = null;
          }
        } else if (update.status.type === 'failed') {
          setIsGeocodeSubmitting(false);
          if (geocodeUnsubscribeRef.current) {
            geocodeUnsubscribeRef.current();
            geocodeUnsubscribeRef.current = null;
          }
        }
      });
      geocodeUnsubscribeRef.current = unsubscribe;
    } catch (err) {
      setIsGeocodeSubmitting(false);
      setGeocodeJob({
        jobId: 'unknown',
        timestamp: new Date().toISOString(),
        status: { type: 'failed', error: err instanceof Error ? err.message : 'Neznámá chyba' },
      });
    }
  }, [customer, onGeocodeCompleted]);

  useEffect(() => {
    return () => {
      if (geocodeUnsubscribeRef.current) {
        geocodeUnsubscribeRef.current();
        geocodeUnsubscribeRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!geocodeJob) return;
    if (geocodeJob.status.type !== 'completed') return;
    const timer = setTimeout(() => {
      setGeocodeJob(null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [geocodeJob]);

  const handleBlur = useCallback((field: keyof CustomerFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    
    // Validate single field on blur
    const fieldErrors = validateCustomerForm(formData);
    if (fieldErrors[field]) {
      setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] }));
    }
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate all fields
    const validationErrors = validateCustomerForm(formData);
    setErrors(validationErrors);
    
    // Mark all fields as touched
    setTouched(Object.fromEntries(
      Object.keys(formData).map((key) => [key, true])
    ));
    
    if (!isFormValid(validationErrors)) {
      return;
    }
    
    if (isEditMode && customer) {
      // Update request - only include changed fields
      const updateData: UpdateCustomerRequest = {
        id: customer.id,
        type: formData.type !== customer.type ? formData.type : undefined,
        name: formData.name.trim() !== customer.name ? formData.name.trim() : undefined,
        contactPerson: formData.type === 'company' && formData.contactPerson.trim() !== (customer.contactPerson ?? '') 
          ? formData.contactPerson.trim() || undefined 
          : undefined,
        ico: formData.type === 'company' && formData.ico.trim() !== (customer.ico ?? '') 
          ? formData.ico.trim() || undefined 
          : undefined,
        dic: formData.type === 'company' && formData.dic.trim() !== (customer.dic ?? '') 
          ? formData.dic.trim() || undefined 
          : undefined,
        email: formData.email.trim() !== (customer.email ?? '') ? formData.email.trim() || undefined : undefined,
        phone: formData.phone.trim() !== (customer.phone ?? '') ? formData.phone.trim() || undefined : undefined,
        street: formData.street.trim() !== customer.street ? formData.street.trim() : undefined,
        city: formData.city.trim() !== customer.city ? formData.city.trim() : undefined,
        postalCode: formData.postalCode.replace(/\s/g, '') !== customer.postalCode 
          ? formData.postalCode.replace(/\s/g, '') 
          : undefined,
        notes: formData.notes.trim() !== (customer.notes ?? '') ? formData.notes.trim() || undefined : undefined,
        lat: coordinates?.lat !== customer.lat ? coordinates?.lat : undefined,
        lng: coordinates?.lng !== customer.lng ? coordinates?.lng : undefined,
      };
      
      await onSubmit(updateData);
    } else {
      // Create request
      const createData: CreateCustomerRequest = {
        type: formData.type,
        name: formData.name.trim(),
        contactPerson: formData.type === 'company' ? formData.contactPerson.trim() || undefined : undefined,
        ico: formData.type === 'company' ? formData.ico.trim() || undefined : undefined,
        dic: formData.type === 'company' ? formData.dic.trim() || undefined : undefined,
        email: formData.email.trim() || undefined,
        phone: formData.phone.trim() || undefined,
        street: formData.street.trim(),
        city: formData.city.trim(),
        postalCode: formData.postalCode.replace(/\s/g, ''),
        country: 'CZ',
        notes: formData.notes.trim() || undefined,
        lat: coordinates?.lat,
        lng: coordinates?.lng,
      };
      
      await onSubmit(createData);
    }
  };

  const showError = (field: keyof CustomerFormData) => {
    return touched[field] && errors[field];
  };

  const isCompany = formData.type === 'company';

  useEffect(() => {
    if (!customer) return;
    const hasCoords = Boolean(customer.lat && customer.lng);
    if (hasCoords) {
      suppressMapInteractionRef.current = true;
      setAutoCenterMap(true);
    } else {
      suppressMapInteractionRef.current = false;
    }
    setNeedsRecenter(false);
    setMapMoved(false);
    setLastGeocodedAddress(
      normalizeAddressKey(customer.street, customer.city, customer.postalCode)
    );
  }, [customer?.id]);

  useEffect(() => {
    if (!customer) return;
    const currentAddressKey = normalizeAddressKey(formData.street, formData.city, formData.postalCode);
    if (!lastGeocodedAddress || currentAddressKey !== lastGeocodedAddress) {
      setNeedsRecenter(true);
    } else if (!mapMoved) {
      setNeedsRecenter(false);
    }
  }, [
    customer,
    formData.street,
    formData.city,
    formData.postalCode,
    lastGeocodedAddress,
    mapMoved,
  ]);
  // Convert geocode job status to generic JobStatus for timeline
  const timelineStatus: JobStatus | null = useMemo(() => {
    if (!geocodeJob) return null;
    const { status } = geocodeJob;
    switch (status.type) {
      case 'queued':
        return { type: 'queued', position: status.position };
      case 'processing':
        return { type: 'processing', message: 'Hledám adresu...' };
      case 'completed':
        return { type: 'completed' };
      case 'failed':
        return { type: 'failed', error: status.error };
      default:
        return null;
    }
  }, [geocodeJob]);

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>{isEditMode ? 'Upravit zákazníka' : 'Nový zákazník'}</h2>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Typ zákazníka</h3>
        
        <div className={styles.typeSelector}>
          <label className={`${styles.typeOption} ${formData.type === 'person' ? styles.typeSelected : ''}`}>
            <input
              type="radio"
              name="type"
              value="person"
              checked={formData.type === 'person'}
              onChange={() => handleChange('type', 'person')}
              disabled={isSubmitting}
            />
            <span className={styles.typeLabel}>Fyzická osoba</span>
          </label>
          <label className={`${styles.typeOption} ${formData.type === 'company' ? styles.typeSelected : ''}`}>
            <input
              type="radio"
              name="type"
              value="company"
              checked={formData.type === 'company'}
              onChange={() => handleChange('type', 'company')}
              disabled={isSubmitting}
            />
            <span className={styles.typeLabel}>Firma</span>
          </label>
        </div>
      </div>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Základní údaje</h3>
        
        <div className={styles.field}>
          <label htmlFor="name" className={styles.label}>
            {isCompany ? 'Název firmy' : 'Jméno'} <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            className={`${styles.input} ${showError('name') ? styles.inputError : ''}`}
            placeholder={isCompany ? 'ABC s.r.o.' : 'Jan Novák'}
            disabled={isSubmitting}
          />
          {showError('name') && <span className={styles.error}>{errors.name}</span>}
        </div>

        {/* Company-specific fields */}
        {isCompany && (
          <>
            <div className={styles.field}>
              <label htmlFor="contactPerson" className={styles.label}>Kontaktní osoba</label>
              <input
                type="text"
                id="contactPerson"
                value={formData.contactPerson}
                onChange={(e) => handleChange('contactPerson', e.target.value)}
                className={styles.input}
                placeholder="Jan Novák"
                disabled={isSubmitting}
              />
            </div>
            
            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="ico" className={styles.label}>IČO</label>
                <input
                  type="text"
                  id="ico"
                  value={formData.ico}
                  onChange={(e) => handleChange('ico', e.target.value)}
                  className={styles.input}
                  placeholder="12345678"
                  disabled={isSubmitting}
                  maxLength={8}
                />
              </div>
              
              <div className={styles.field}>
                <label htmlFor="dic" className={styles.label}>DIČ</label>
                <input
                  type="text"
                  id="dic"
                  value={formData.dic}
                  onChange={(e) => handleChange('dic', e.target.value)}
                  className={styles.input}
                  placeholder="CZ12345678"
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </>
        )}
        
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              type="email"
              id="email"
              value={formData.email}
              onChange={(e) => handleChange('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              className={`${styles.input} ${showError('email') ? styles.inputError : ''}`}
              placeholder="jan@example.com"
              disabled={isSubmitting}
            />
            {showError('email') && <span className={styles.error}>{errors.email}</span>}
          </div>
          
          <div className={styles.field}>
            <label htmlFor="phone" className={styles.label}>Telefon</label>
            <input
              type="tel"
              id="phone"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              onBlur={() => handleBlur('phone')}
              className={`${styles.input} ${showError('phone') ? styles.inputError : ''}`}
              placeholder="+420 123 456 789"
              disabled={isSubmitting}
            />
            {showError('phone') && <span className={styles.error}>{errors.phone}</span>}
          </div>
        </div>
      </div>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Adresa</h3>
        
        <div className={styles.field}>
          <label htmlFor="street" className={styles.label}>
            Ulice a číslo <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="street"
            value={formData.street}
            onChange={(e) => handleChange('street', e.target.value)}
            onBlur={() => handleBlur('street')}
            className={`${styles.input} ${showError('street') ? styles.inputError : ''}`}
            placeholder="Hlavní 123"
            disabled={isSubmitting}
          />
          {showError('street') && <span className={styles.error}>{errors.street}</span>}
        </div>
        
        <div className={styles.row}>
          <div className={styles.field} style={{ flex: 2 }}>
            <label htmlFor="city" className={styles.label}>
              Město <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              id="city"
              value={formData.city}
              onChange={(e) => handleChange('city', e.target.value)}
              onBlur={() => handleBlur('city')}
              className={`${styles.input} ${showError('city') ? styles.inputError : ''}`}
              placeholder="Praha"
              disabled={isSubmitting}
            />
            {showError('city') && <span className={styles.error}>{errors.city}</span>}
          </div>
          
          <div className={styles.field} style={{ flex: 1 }}>
            <label htmlFor="postalCode" className={styles.label}>
              PSČ <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              id="postalCode"
              value={formData.postalCode}
              onChange={(e) => handleChange('postalCode', e.target.value)}
              onBlur={() => handleBlur('postalCode')}
              className={`${styles.input} ${showError('postalCode') ? styles.inputError : ''}`}
              placeholder="110 00"
              disabled={isSubmitting}
            />
            {showError('postalCode') && <span className={styles.error}>{errors.postalCode}</span>}
          </div>
        </div>
        
        {/* Address Map */}
        <div className={styles.mapContainer}>
          {isEditMode && customer && (
            <div className={styles.geocodeActions}>
              <button
                type="button"
                className={styles.geocodeButton}
                onClick={handleGeocode}
                disabled={isSubmitting || isGeocodeSubmitting || !needsRecenter}
              >
                {isGeocodeSubmitting ? 'Hledám...' : 'Zobraz adresu na mapě'}
              </button>
              <button
                type="button"
                className={styles.geocodeButton}
                onClick={handlePickAddress}
                disabled={isSubmitting || isGeocodeSubmitting}
              >
                Zadej adresu špendlíkem na mapě
              </button>
            </div>
          )}
          <AddressMap
            lat={coordinates?.lat}
            lng={coordinates?.lng}
            onPositionChange={handlePositionChange}
            draggable={!isSubmitting}
            emptyMessage=""
            enablePick={isPicking}
            onPick={handleMapPick}
            autoCenter={autoCenterMap}
            onMapInteraction={() => {
              if (suppressMapInteractionRef.current) {
                return;
              }
              if (!coordinates) return;
              setMapMoved(true);
              setNeedsRecenter(true);
            }}
            onAutoCenterComplete={handleAutoCenterComplete}
          />
          {timelineStatus && (
            <div className={styles.geocodeTimeline}>
              <JobStatusTimeline status={timelineStatus} size="sm" showProgress={false} />
            </div>
          )}
        </div>
      </div>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Poznámky</h3>
        
        <div className={styles.field}>
          <label htmlFor="notes" className={styles.label}>Poznámky</label>
          <textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            className={styles.textarea}
            placeholder="Další informace o zákazníkovi..."
            rows={3}
            disabled={isSubmitting}
          />
        </div>
      </div>
      
      <div className={styles.actions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.cancelButton}
          disabled={isSubmitting}
        >
          Zrušit
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Ukládám...' : (isEditMode ? 'Uložit změny' : 'Uložit zákazníka')}
        </button>
      </div>
    </form>
  );
}
