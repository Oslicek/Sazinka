/**
 * Customer Import Service
 * 
 * Handles CSV parsing, validation, and normalization for customer import.
 * See IMPORT_FORMAT.MD for full specification.
 */

import Papa from 'papaparse';
import {
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  CountryCode,
} from 'libphonenumber-js';
import type {
  CustomerType,
  CreateCustomerRequest,
  CsvCustomerRow,
  ImportIssue,
  ImportReport,
  ImportIssueLevel,
} from '@shared/customer';

// =============================================================================
// TYPES
// =============================================================================

export interface ParseResult {
  data: CsvCustomerRow[];
  errors: Papa.ParseError[];
}

export interface NormalizeResult {
  customer: CreateCustomerRequest;
  issues: ImportIssue[];
}

export interface PhoneNormalizeResult {
  phone: string | null;
  phoneRaw: string | null;
  additionalPhones: string[];
  issues: ImportIssue[];
}

export interface FieldNormalizeResult<T> {
  [key: string]: T | null | ImportIssue[];
}

export interface PostalCodeResult {
  postalCode: string | null;
  issues: ImportIssue[];
}

export interface EmailResult {
  email: string | null;
  issues: ImportIssue[];
}

export interface IcoResult {
  ico: string | null;
  issues: ImportIssue[];
}

export interface DicResult {
  dic: string | null;
  issues: ImportIssue[];
}

export interface TypeInferResult {
  type: CustomerType;
  inferred: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const KNOWN_COLUMNS = [
  'type', 'name', 'contactperson', 'ico', 'dic',
  'street', 'city', 'postalcode', 'country',
  'phone', 'email', 'notes',
];

// Map from lowercase header to CsvCustomerRow property
const HEADER_MAP: Record<string, keyof CsvCustomerRow> = {
  'type': 'type',
  'name': 'name',
  'contactperson': 'contactPerson',
  'ico': 'ico',
  'dic': 'dic',
  'street': 'street',
  'city': 'city',
  'postalcode': 'postalCode',
  'country': 'country',
  'phone': 'phone',
  'email': 'email',
  'notes': 'notes',
};

const EMPTY_VALUES = ['', '-', 'n/a', 'null'];

const TYPE_PERSON_ALIASES = ['person', 'osoba', 'fyzická', 'fo'];
const TYPE_COMPANY_ALIASES = ['company', 'firma', 'právnická', 'po'];

const COUNTRY_ALIASES: Record<string, string> = {
  'česko': 'CZ',
  'czech republic': 'CZ',
  'czech': 'CZ',
  'slovensko': 'SK',
  'slovakia': 'SK',
  'německo': 'DE',
  'germany': 'DE',
};

// =============================================================================
// CSV PARSING
// =============================================================================

/**
 * Parse CSV string into array of customer rows
 */
export function parseCsv(csvContent: string): ParseResult {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  // Filter to only known columns and transform to CsvCustomerRow
  const data: CsvCustomerRow[] = result.data.map((row) => {
    const cleaned: CsvCustomerRow = {};
    
    for (const lowerCol of KNOWN_COLUMNS) {
      const value = row[lowerCol];
      if (value !== undefined && value !== '') {
        const propName = HEADER_MAP[lowerCol];
        if (propName) {
          (cleaned as any)[propName] = value;
        }
      }
    }
    
    return cleaned;
  });

  return {
    data,
    errors: result.errors,
  };
}

// =============================================================================
// VALUE CLEANING
// =============================================================================

/**
 * Clean a value: trim, convert placeholders to null
 */
export function cleanValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  
  if (EMPTY_VALUES.includes(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed || null;
}

// =============================================================================
// TYPE INFERENCE
// =============================================================================

/**
 * Infer customer type from row data
 */
export function inferCustomerType(
  row: Partial<CsvCustomerRow>
): CustomerType | TypeInferResult {
  const typeValue = cleanValue(row.type)?.toLowerCase();

  // Explicit type
  if (typeValue) {
    if (TYPE_PERSON_ALIASES.includes(typeValue)) {
      return 'person';
    }
    if (TYPE_COMPANY_ALIASES.includes(typeValue)) {
      return 'company';
    }
  }

  // Infer from IČO
  if (cleanValue(row.ico)) {
    return { type: 'company', inferred: true };
  }

  // Infer from DIČ
  if (cleanValue(row.dic)) {
    return { type: 'company', inferred: true };
  }

  // Infer from contactPerson
  if (cleanValue(row.contactPerson)) {
    return { type: 'company', inferred: true };
  }

  // Default
  return 'person';
}

// =============================================================================
// ROW VALIDATION
// =============================================================================

/**
 * Check if row has enough data to be imported
 */
export function isRowImportable(row: Partial<CsvCustomerRow>): boolean {
  return !!(
    cleanValue(row.name) ||
    cleanValue(row.email) ||
    cleanValue(row.phone) ||
    cleanValue(row.ico) ||
    cleanValue(row.street) ||
    cleanValue(row.city) ||
    cleanValue(row.postalCode) ||
    cleanValue(row.notes)
  );
}

// =============================================================================
// PHONE NORMALIZATION
// =============================================================================

/**
 * Normalize phone number to E.164 format
 */
export function normalizePhone(
  value: string | undefined | null,
  country: string
): PhoneNormalizeResult {
  const issues: ImportIssue[] = [];
  const additionalPhones: string[] = [];
  
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return { phone: null, phoneRaw: null, additionalPhones: [], issues: [] };
  }

  // Check for multiple phones
  const phoneDelimiters = /[,\/]/;
  if (phoneDelimiters.test(cleaned)) {
    const parts = cleaned.split(phoneDelimiters).map(p => p.trim()).filter(Boolean);
    
    if (parts.length > 1) {
      issues.push({
        rowNumber: 0, // Will be set by caller
        level: 'warning',
        field: 'phone',
        message: 'Více telefonů, použit první',
        originalValue: cleaned,
      });

      // Process additional phones
      for (let i = 1; i < parts.length; i++) {
        const additionalResult = normalizeSinglePhone(parts[i], country);
        if (additionalResult.phone) {
          additionalPhones.push(additionalResult.phone);
        }
      }

      // Process first phone
      const mainResult = normalizeSinglePhone(parts[0], country);
      return {
        phone: mainResult.phone,
        phoneRaw: mainResult.phone ? null : parts[0],
        additionalPhones,
        issues: [...issues, ...mainResult.issues],
      };
    }
  }

  // Single phone
  const result = normalizeSinglePhone(cleaned, country);
  return {
    phone: result.phone,
    phoneRaw: result.phone ? null : cleaned,
    additionalPhones: [],
    issues: result.issues,
  };
}

function normalizeSinglePhone(
  value: string,
  country: string
): { phone: string | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  
  // Clean the phone number
  let cleaned = value.replace(/[\s\-\.\(\)]/g, '');
  
  // Convert 00 prefix to +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // Handle leading 0 for CZ
  if (country === 'CZ' && cleaned.match(/^0[1-9]/)) {
    issues.push({
      rowNumber: 0,
      level: 'warning',
      field: 'phone',
      message: `Odstraněna úvodní 0: "${value}"`,
      originalValue: value,
    });
    cleaned = cleaned.slice(1);
  }

  // Try to parse with libphonenumber
  try {
    const countryCode = country as CountryCode;
    
    // If no + prefix, add country calling code
    if (!cleaned.startsWith('+')) {
      const phoneNumber = parsePhoneNumberFromString(cleaned, countryCode);
      if (phoneNumber && phoneNumber.isValid()) {
        return { phone: phoneNumber.format('E.164'), issues };
      }
    } else {
      const phoneNumber = parsePhoneNumberFromString(cleaned);
      if (phoneNumber && phoneNumber.isValid()) {
        return { phone: phoneNumber.format('E.164'), issues };
      }
    }
  } catch {
    // Fall through to fallback handling
  }

  // Fallback for CZ: if exactly 9 digits, assume valid Czech mobile number
  // This handles newer Czech mobile prefixes (669, 674, 687, etc.) that libphonenumber may not know
  if (country === 'CZ' && !cleaned.startsWith('+')) {
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length === 9 && /^[1-9]/.test(digitsOnly)) {
      // No warning needed - normalization succeeded
      return { phone: `+420${digitsOnly}`, issues };
    }
  }

  // Failed to parse
  issues.push({
    rowNumber: 0,
    level: 'warning',
    field: 'phone',
    message: 'Číslo nelze normalizovat',
    originalValue: value,
  });

  return { phone: null, issues };
}

// =============================================================================
// POSTAL CODE NORMALIZATION
// =============================================================================

/**
 * Normalize postal code
 */
export function normalizePostalCode(
  value: string | undefined | null,
  country: string
): PostalCodeResult {
  const issues: ImportIssue[] = [];
  
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return { postalCode: null, issues: [] };
  }

  // For CZ, remove spaces and validate
  if (country === 'CZ') {
    const noSpaces = cleaned.replace(/\s/g, '');
    
    // Check if it's 5 digits
    if (!/^\d{5}$/.test(noSpaces)) {
      issues.push({
        rowNumber: 0,
        level: 'warning',
        field: 'postalCode',
        message: 'CZ PSČ není 5 číslic',
        originalValue: cleaned,
      });
    }
    
    return { postalCode: noSpaces, issues };
  }

  // For other countries, just return as-is
  return { postalCode: cleaned, issues };
}

// =============================================================================
// EMAIL NORMALIZATION
// =============================================================================

/**
 * Normalize email address
 */
export function normalizeEmail(
  value: string | undefined | null
): EmailResult {
  const issues: ImportIssue[] = [];
  
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return { email: null, issues: [] };
  }

  const normalized = cleaned.toLowerCase();

  // Basic validation
  if (!normalized.includes('@')) {
    issues.push({
      rowNumber: 0,
      level: 'warning',
      field: 'email',
      message: 'Email neobsahuje @',
      originalValue: value,
    });
  }

  return { email: normalized, issues };
}

// =============================================================================
// IČO NORMALIZATION
// =============================================================================

/**
 * Normalize IČO (Czech company ID)
 */
export function normalizeIco(
  value: string | undefined | null,
  customerType: CustomerType
): IcoResult {
  const issues: ImportIssue[] = [];
  
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return { ico: null, issues: [] };
  }

  // Remove spaces
  let normalized = cleaned.replace(/\s/g, '');

  // Pad with leading zeros if needed
  if (normalized.length < 8 && /^\d+$/.test(normalized)) {
    issues.push({
      rowNumber: 0,
      level: 'info',
      field: 'ico',
      message: `IČO doplněno na 8 číslic: "${cleaned}" → "${normalized.padStart(8, '0')}"`,
      originalValue: cleaned,
    });
    normalized = normalized.padStart(8, '0');
  }

  // Warn if IČO on person type
  if (customerType === 'person') {
    issues.push({
      rowNumber: 0,
      level: 'warning',
      field: 'ico',
      message: 'IČO u fyzické osoby',
      originalValue: cleaned,
    });
  }

  return { ico: normalized, issues };
}

// =============================================================================
// DIČ NORMALIZATION
// =============================================================================

/**
 * Normalize DIČ (VAT ID)
 */
export function normalizeDic(
  value: string | undefined | null,
  country: string,
  customerType: CustomerType
): DicResult {
  const issues: ImportIssue[] = [];
  
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return { dic: null, issues: [] };
  }

  // Remove spaces and uppercase
  let normalized = cleaned.replace(/\s/g, '').toUpperCase();

  // Add CZ prefix if missing for Czech companies
  if (country === 'CZ' && /^\d{8,10}$/.test(normalized)) {
    issues.push({
      rowNumber: 0,
      level: 'info',
      field: 'dic',
      message: `Doplněn prefix CZ: "${cleaned}" → "CZ${normalized}"`,
      originalValue: cleaned,
    });
    normalized = 'CZ' + normalized;
  }

  // Validate CZ DIČ format
  if (country === 'CZ' && normalized.startsWith('CZ')) {
    if (!/^CZ\d{8,10}$/.test(normalized)) {
      issues.push({
        rowNumber: 0,
        level: 'warning',
        field: 'dic',
        message: 'Neplatný formát DIČ',
        originalValue: cleaned,
      });
    }
  }

  // Warn if DIČ on person type
  if (customerType === 'person') {
    issues.push({
      rowNumber: 0,
      level: 'warning',
      field: 'dic',
      message: 'DIČ u fyzické osoby',
      originalValue: cleaned,
    });
  }

  return { dic: normalized, issues };
}

// =============================================================================
// COUNTRY NORMALIZATION
// =============================================================================

/**
 * Normalize country code
 */
export function normalizeCountry(value: string | undefined | null): string {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return 'CZ';
  }

  const upper = cleaned.toUpperCase();
  const lower = cleaned.toLowerCase();

  // Check aliases
  if (COUNTRY_ALIASES[lower]) {
    return COUNTRY_ALIASES[lower];
  }

  // Return as-is (should be ISO code)
  return upper;
}

// =============================================================================
// FULL ROW NORMALIZATION
// =============================================================================

/**
 * Normalize a complete CSV row into CreateCustomerRequest
 */
export function normalizeCustomerRow(
  row: CsvCustomerRow,
  rowNumber: number
): NormalizeResult {
  const issues: ImportIssue[] = [];

  // Normalize country first (needed for other normalizations)
  const country = normalizeCountry(row.country);

  // Determine customer type
  const typeResult = inferCustomerType(row);
  let customerType: CustomerType;
  
  if (typeof typeResult === 'string') {
    customerType = typeResult;
  } else {
    customerType = typeResult.type;
    if (typeResult.inferred) {
      issues.push({
        rowNumber,
        level: 'info',
        field: 'type',
        message: `Typ odvozen: ${customerType}`,
      });
    }
  }

  // Normalize phone
  const phoneResult = normalizePhone(row.phone, country);
  phoneResult.issues.forEach(i => { i.rowNumber = rowNumber; });
  issues.push(...phoneResult.issues);

  // Normalize postal code
  const postalCodeResult = normalizePostalCode(row.postalCode, country);
  postalCodeResult.issues.forEach(i => { i.rowNumber = rowNumber; });
  issues.push(...postalCodeResult.issues);

  // Normalize email
  const emailResult = normalizeEmail(row.email);
  emailResult.issues.forEach(i => { i.rowNumber = rowNumber; });
  issues.push(...emailResult.issues);

  // Normalize IČO
  const icoResult = normalizeIco(row.ico, customerType);
  icoResult.issues.forEach(i => { i.rowNumber = rowNumber; });
  issues.push(...icoResult.issues);

  // Normalize DIČ
  const dicResult = normalizeDic(row.dic, country, customerType);
  dicResult.issues.forEach(i => { i.rowNumber = rowNumber; });
  issues.push(...dicResult.issues);

  // Build notes (including additional phones)
  let notes = cleanValue(row.notes);
  if (phoneResult.additionalPhones.length > 0) {
    const additionalNote = `[Import: další tel. ${phoneResult.additionalPhones.join(', ')}]`;
    notes = notes ? `${notes}\n${additionalNote}` : additionalNote;
  }

  // Build customer request
  const customer: CreateCustomerRequest = {
    type: customerType,
    name: cleanValue(row.name) || '',
    contactPerson: customerType === 'company' ? cleanValue(row.contactPerson) : undefined,
    ico: icoResult.ico || undefined,
    dic: dicResult.dic || undefined,
    email: emailResult.email || undefined,
    phone: phoneResult.phone || undefined,
    phoneRaw: phoneResult.phoneRaw || undefined,
    street: cleanValue(row.street) || '',
    city: cleanValue(row.city) || '',
    postalCode: postalCodeResult.postalCode || '',
    country,
    notes: notes || undefined,
  };

  return { customer, issues };
}

// =============================================================================
// REPORT GENERATION
// =============================================================================

/**
 * Generate human-readable text report
 */
export function generateTextReport(report: ImportReport): string {
  const date = new Date(report.importedAt);
  const formattedDate = date.toLocaleDateString('cs-CZ') + ' ' + date.toLocaleTimeString('cs-CZ');
  const durationSec = Math.round(report.durationMs / 1000);

  const warnings = report.issues.filter(i => i.level === 'warning');
  const errors = report.issues.filter(i => i.level === 'error');
  const infos = report.issues.filter(i => i.level === 'info');

  let text = `
═══════════════════════════════════════════════════════════════
                    IMPORT ZÁKAZNÍKŮ - REPORT
═══════════════════════════════════════════════════════════════

Soubor:     ${report.filename}
Datum:      ${formattedDate}
Doba:       ${durationSec} sekund

───────────────────────────────────────────────────────────────
                         SOUHRN
───────────────────────────────────────────────────────────────

Celkem řádků:        ${report.totalRows.toLocaleString('cs-CZ').padStart(10)}
Importováno:         ${report.importedCount.toLocaleString('cs-CZ').padStart(10)}  ✓
Aktualizováno:       ${report.updatedCount.toLocaleString('cs-CZ').padStart(10)}  ↻
Přeskočeno:          ${report.skippedCount.toLocaleString('cs-CZ').padStart(10)}  ○
`;

  if (warnings.length > 0) {
    text += `
───────────────────────────────────────────────────────────────
                       VAROVÁNÍ (${warnings.length})
───────────────────────────────────────────────────────────────

`;
    for (const issue of warnings.slice(0, 100)) {
      text += `Řádek ${issue.rowNumber}: [${issue.field}] ${issue.message}`;
      if (issue.originalValue) {
        text += `: "${issue.originalValue}"`;
      }
      text += '\n';
    }
    if (warnings.length > 100) {
      text += `\n... a dalších ${warnings.length - 100} varování\n`;
    }
  }

  if (errors.length > 0) {
    text += `
───────────────────────────────────────────────────────────────
                        CHYBY (${errors.length})
───────────────────────────────────────────────────────────────

`;
    for (const issue of errors) {
      text += `Řádek ${issue.rowNumber}: [${issue.field}] ${issue.message}`;
      if (issue.originalValue) {
        text += `: "${issue.originalValue}"`;
      }
      text += '\n';
    }
  } else {
    text += `
───────────────────────────────────────────────────────────────
                        CHYBY (0)
───────────────────────────────────────────────────────────────

(žádné)
`;
  }

  text += `
═══════════════════════════════════════════════════════════════
`;

  return text;
}
