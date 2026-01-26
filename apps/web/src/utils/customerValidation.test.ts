import { describe, it, expect } from 'vitest';
import {
  validateCustomerForm,
  validateName,
  validateEmail,
  validatePhone,
  validatePostalCode,
  validateAddress,
  type CustomerFormData,
} from './customerValidation';

describe('customerValidation', () => {
  describe('validateName', () => {
    it('should return error for empty name', () => {
      expect(validateName('')).toBe('Jméno je povinné');
    });

    it('should return error for whitespace-only name', () => {
      expect(validateName('   ')).toBe('Jméno je povinné');
    });

    it('should return error for name shorter than 2 characters', () => {
      expect(validateName('A')).toBe('Jméno musí mít alespoň 2 znaky');
    });

    it('should return null for valid name', () => {
      expect(validateName('Jan Novák')).toBeNull();
    });

    it('should return null for name with exactly 2 characters', () => {
      expect(validateName('AB')).toBeNull();
    });
  });

  describe('validateEmail', () => {
    it('should return null for empty email (optional field)', () => {
      expect(validateEmail('')).toBeNull();
      expect(validateEmail(undefined)).toBeNull();
    });

    it('should return error for invalid email format', () => {
      expect(validateEmail('invalid')).toBe('Neplatný formát emailu');
      expect(validateEmail('invalid@')).toBe('Neplatný formát emailu');
      expect(validateEmail('@example.com')).toBe('Neplatný formát emailu');
      expect(validateEmail('invalid@.com')).toBe('Neplatný formát emailu');
    });

    it('should return null for valid email', () => {
      expect(validateEmail('jan@example.com')).toBeNull();
      expect(validateEmail('jan.novak@example.co.cz')).toBeNull();
      expect(validateEmail('jan+test@example.com')).toBeNull();
    });
  });

  describe('validatePhone', () => {
    it('should return null for empty phone (optional field)', () => {
      expect(validatePhone('')).toBeNull();
      expect(validatePhone(undefined)).toBeNull();
    });

    it('should return error for phone with less than 9 digits', () => {
      expect(validatePhone('12345678')).toBe('Telefon musí mít alespoň 9 číslic');
    });

    it('should return null for valid Czech phone formats', () => {
      expect(validatePhone('+420123456789')).toBeNull();
      expect(validatePhone('+420 123 456 789')).toBeNull();
      expect(validatePhone('123456789')).toBeNull();
      expect(validatePhone('123 456 789')).toBeNull();
    });

    it('should count only digits for validation', () => {
      expect(validatePhone('+420-123-456-789')).toBeNull(); // 12 digits
      expect(validatePhone('(+420) 123 456 789')).toBeNull();
    });
  });

  describe('validatePostalCode', () => {
    it('should return error for empty postal code', () => {
      expect(validatePostalCode('')).toBe('PSČ je povinné');
    });

    it('should return error for invalid Czech postal code format', () => {
      expect(validatePostalCode('1234')).toBe('PSČ musí mít 5 číslic');
      expect(validatePostalCode('123456')).toBe('PSČ musí mít 5 číslic');
      expect(validatePostalCode('abcde')).toBe('PSČ musí mít 5 číslic');
    });

    it('should return null for valid Czech postal codes', () => {
      expect(validatePostalCode('11000')).toBeNull();
      expect(validatePostalCode('110 00')).toBeNull();
      expect(validatePostalCode('60200')).toBeNull();
    });
  });

  describe('validateAddress', () => {
    it('should return error for empty street', () => {
      const errors = validateAddress('', 'Praha', '11000');
      expect(errors.street).toBe('Ulice je povinná');
    });

    it('should return error for empty city', () => {
      const errors = validateAddress('Hlavní 123', '', '11000');
      expect(errors.city).toBe('Město je povinné');
    });

    it('should return error for empty postal code', () => {
      const errors = validateAddress('Hlavní 123', 'Praha', '');
      expect(errors.postalCode).toBe('PSČ je povinné');
    });

    it('should return no errors for valid address', () => {
      const errors = validateAddress('Hlavní 123', 'Praha', '11000');
      expect(errors).toEqual({});
    });
  });

  describe('validateCustomerForm', () => {
    const validFormData: CustomerFormData = {
      name: 'Jan Novák',
      email: 'jan@example.com',
      phone: '+420 123 456 789',
      street: 'Hlavní 123',
      city: 'Praha',
      postalCode: '11000',
      notes: '',
    };

    it('should return no errors for valid form data', () => {
      const errors = validateCustomerForm(validFormData);
      expect(errors).toEqual({});
    });

    it('should return all validation errors', () => {
      const invalidFormData: CustomerFormData = {
        name: '',
        email: 'invalid',
        phone: '123',
        street: '',
        city: '',
        postalCode: '123',
        notes: '',
      };

      const errors = validateCustomerForm(invalidFormData);

      expect(errors.name).toBeDefined();
      expect(errors.email).toBeDefined();
      expect(errors.phone).toBeDefined();
      expect(errors.street).toBeDefined();
      expect(errors.city).toBeDefined();
      expect(errors.postalCode).toBeDefined();
    });

    it('should validate optional fields only when provided', () => {
      const formWithoutOptionals: CustomerFormData = {
        name: 'Jan Novák',
        email: '',
        phone: '',
        street: 'Hlavní 123',
        city: 'Praha',
        postalCode: '11000',
        notes: '',
      };

      const errors = validateCustomerForm(formWithoutOptionals);
      expect(errors).toEqual({});
    });

    it('should return isValid true when no errors', () => {
      const result = validateCustomerForm(validFormData);
      expect(Object.keys(result).length).toBe(0);
    });

    it('should return isValid false when there are errors', () => {
      const invalidFormData: CustomerFormData = {
        name: '',
        email: '',
        phone: '',
        street: '',
        city: '',
        postalCode: '',
        notes: '',
      };

      const errors = validateCustomerForm(invalidFormData);
      expect(Object.keys(errors).length).toBeGreaterThan(0);
    });
  });
});
