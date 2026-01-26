import { useState, useCallback } from 'react';
import type { CreateCustomerRequest } from '@shared/customer';
import {
  validateCustomerForm,
  isFormValid,
  type CustomerFormData,
  type ValidationErrors,
} from '../../utils/customerValidation';
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
      <h2 className={styles.title}>Nový zákazník</h2>
      
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Základní údaje</h3>
        
        <div className={styles.field}>
          <label htmlFor="name" className={styles.label}>
            Jméno <span className={styles.required}>*</span>
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            onBlur={() => handleBlur('name')}
            className={`${styles.input} ${showError('name') ? styles.inputError : ''}`}
            placeholder="Jan Novák"
            disabled={isSubmitting}
          />
          {showError('name') && <span className={styles.error}>{errors.name}</span>}
        </div>
        
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
          {isSubmitting ? 'Ukládám...' : 'Uložit zákazníka'}
        </button>
      </div>
    </form>
  );
}
