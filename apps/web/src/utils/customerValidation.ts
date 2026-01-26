/**
 * Customer form data structure
 */
export interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  notes: string;
}

/**
 * Validation errors structure
 */
export interface ValidationErrors {
  name?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  notes?: string;
}

/**
 * Validate customer name
 * - Required
 * - Minimum 2 characters
 */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  
  if (!trimmed) {
    return 'Jméno je povinné';
  }
  
  if (trimmed.length < 2) {
    return 'Jméno musí mít alespoň 2 znaky';
  }
  
  return null;
}

/**
 * Validate email address
 * - Optional
 * - Must be valid format if provided
 */
export function validateEmail(email: string | undefined): string | null {
  if (!email || email.trim() === '') {
    return null; // Optional field
  }
  
  // Basic email regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(email)) {
    return 'Neplatný formát emailu';
  }
  
  return null;
}

/**
 * Validate phone number
 * - Optional
 * - Must have at least 9 digits if provided
 */
export function validatePhone(phone: string | undefined): string | null {
  if (!phone || phone.trim() === '') {
    return null; // Optional field
  }
  
  // Count only digits
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length < 9) {
    return 'Telefon musí mít alespoň 9 číslic';
  }
  
  return null;
}

/**
 * Validate Czech postal code
 * - Required
 * - Must be 5 digits (with optional space after first 3)
 */
export function validatePostalCode(postalCode: string): string | null {
  if (!postalCode || postalCode.trim() === '') {
    return 'PSČ je povinné';
  }
  
  // Remove spaces and check for 5 digits
  const digits = postalCode.replace(/\s/g, '');
  
  if (!/^\d{5}$/.test(digits)) {
    return 'PSČ musí mít 5 číslic';
  }
  
  return null;
}

/**
 * Validate address fields
 */
export function validateAddress(
  street: string,
  city: string,
  postalCode: string
): ValidationErrors {
  const errors: ValidationErrors = {};
  
  if (!street || street.trim() === '') {
    errors.street = 'Ulice je povinná';
  }
  
  if (!city || city.trim() === '') {
    errors.city = 'Město je povinné';
  }
  
  const postalCodeError = validatePostalCode(postalCode);
  if (postalCodeError) {
    errors.postalCode = postalCodeError;
  }
  
  return errors;
}

/**
 * Validate entire customer form
 * Returns object with error messages for invalid fields
 * Empty object means form is valid
 */
export function validateCustomerForm(data: CustomerFormData): ValidationErrors {
  const errors: ValidationErrors = {};
  
  // Validate name
  const nameError = validateName(data.name);
  if (nameError) {
    errors.name = nameError;
  }
  
  // Validate email (optional)
  const emailError = validateEmail(data.email);
  if (emailError) {
    errors.email = emailError;
  }
  
  // Validate phone (optional)
  const phoneError = validatePhone(data.phone);
  if (phoneError) {
    errors.phone = phoneError;
  }
  
  // Validate address
  const addressErrors = validateAddress(data.street, data.city, data.postalCode);
  Object.assign(errors, addressErrors);
  
  return errors;
}

/**
 * Check if form has any validation errors
 */
export function isFormValid(errors: ValidationErrors): boolean {
  return Object.keys(errors).length === 0;
}
