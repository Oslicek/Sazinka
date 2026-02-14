import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreateCustomerRequest } from '@shared/customer';
import {
  validateCustomerForm,
  isFormValid,
  type CustomerFormData,
  type ValidationErrors,
} from '../../utils/customerValidation';
import { AddressMap } from './AddressMap';
import styles from './AddCustomerForm.module.css';

interface AddCustomerFormProps {
  onSubmit: (data: CreateCustomerRequest) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const initialFormData: CustomerFormData = {
  name: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  postalCode: '',
  notes: '',
};

export function AddCustomerForm({ onSubmit, onCancel, isSubmitting = false }: AddCustomerFormProps) {
  const [formData, setFormData] = useState<CustomerFormData>(initialFormData);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const { t } = useTranslation('customers');
  
  const handleChange = useCallback((field: keyof CustomerFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    
  }, [errors]);

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
    
    // Convert form data to API request format
    const requestData: CreateCustomerRequest = {
      name: formData.name.trim(),
      email: formData.email.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      street: formData.street.trim(),
      city: formData.city.trim(),
      postalCode: formData.postalCode.replace(/\s/g, ''),
      country: 'CZ',
      notes: formData.notes.trim() || undefined,
    };
    
    await onSubmit(requestData);
  };

  const showError = (field: keyof CustomerFormData) => {
    return touched[field] && errors[field];
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.title}>{t('form_new_title')}</h2>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('form_basic_info')}</h3>
        
        <div className={styles.field}>
          <label htmlFor="name" className={styles.label}>
            {t('form_name')} <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            className={`${styles.input} ${showError('name') ? styles.inputError : ''}`}
            placeholder={t('placeholder_person_name')}
            disabled={isSubmitting}
          />
          {showError('name') && <span className={styles.error}>{errors.name}</span>}
        </div>
        
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>{t('form_email')}</label>
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
            <label htmlFor="phone" className={styles.label}>{t('form_phone')}</label>
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
        <h3 className={styles.sectionTitle}>{t('form_address')}</h3>
        
        <div className={styles.field}>
          <label htmlFor="street" className={styles.label}>
            {t('form_street')} <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="street"
            value={formData.street}
            onChange={(e) => handleChange('street', e.target.value)}
            onBlur={() => handleBlur('street')}
            className={`${styles.input} ${showError('street') ? styles.inputError : ''}`}
            placeholder={t('placeholder_street')}
            disabled={isSubmitting}
          />
          {showError('street') && <span className={styles.error}>{errors.street}</span>}
        </div>
        
        <div className={styles.row}>
          <div className={styles.field} style={{ flex: 2 }}>
            <label htmlFor="city" className={styles.label}>
              {t('form_city')} <span className={styles.required}>*</span>
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
              {t('form_postal_code')} <span className={styles.required}>*</span>
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
          <AddressMap
            draggable={false}
            emptyMessage={t('form_geocode_after_save')}
          />
        </div>
      </div>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('form_notes')}</h3>
        
        <div className={styles.field}>
          <label htmlFor="notes" className={styles.label}>{t('form_notes')}</label>
          <textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            className={styles.textarea}
            placeholder={t('form_notes_placeholder')}
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
          {t('form_cancel')}
        </button>
        <button
          type="submit"
          className={styles.submitButton}
          disabled={isSubmitting}
        >
          {isSubmitting ? t('form_saving') : t('form_save_customer')}
        </button>
      </div>
    </form>
  );
}
