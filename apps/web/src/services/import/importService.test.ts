import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  normalizeCustomerRow,
  normalizePhone,
  normalizePostalCode,
  normalizeEmail,
  normalizeIco,
  normalizeDic,
  inferCustomerType,
  isRowImportable,
  cleanValue,
  generateTextReport,
} from './importService';
import type { ImportReport, ImportIssue } from '@shared/customer';

describe('Import Service', () => {
  // ==========================================================================
  // CSV PARSING
  // ==========================================================================
  describe('parseCsv', () => {
    it('should parse valid CSV with all columns', () => {
      const csv = `type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
person;Jan Novák;;;;Hlavní 123;Praha;11000;CZ;602123456;jan@example.com;Test`;
      
      const result = parseCsv(csv);
      
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Jan Novák');
      expect(result.data[0].street).toBe('Hlavní 123');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle semicolon delimiter', () => {
      const csv = `name;city
Jan;Praha`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].name).toBe('Jan');
      expect(result.data[0].city).toBe('Praha');
    });

    it('should handle quoted values with semicolons', () => {
      const csv = `name;notes
Jan;"Poznámka; s středníkem"`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].notes).toBe('Poznámka; s středníkem');
    });

    it('should handle escaped quotes', () => {
      const csv = `name;notes
Jan;"Poznámka ""důležitá"""`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].notes).toBe('Poznámka "důležitá"');
    });

    it('should handle CRLF and LF line endings', () => {
      const csvCrlf = "name;city\r\nJan;Praha\r\nPetr;Brno";
      const csvLf = "name;city\nJan;Praha\nPetr;Brno";
      
      const resultCrlf = parseCsv(csvCrlf);
      const resultLf = parseCsv(csvLf);
      
      expect(resultCrlf.data).toHaveLength(2);
      expect(resultLf.data).toHaveLength(2);
    });

    it('should handle UTF-8 with Czech characters', () => {
      const csv = `name;city
Jiří Černý;Ústí nad Labem`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].name).toBe('Jiří Černý');
      expect(result.data[0].city).toBe('Ústí nad Labem');
    });

    it('should ignore unknown columns', () => {
      const csv = `name;unknownColumn;city
Jan;ignored;Praha`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].name).toBe('Jan');
      expect(result.data[0].city).toBe('Praha');
      expect((result.data[0] as any).unknownColumn).toBeUndefined();
    });

    it('should handle missing columns as undefined', () => {
      const csv = `name;city
Jan;Praha`;
      
      const result = parseCsv(csv);
      
      expect(result.data[0].phone).toBeUndefined();
      expect(result.data[0].email).toBeUndefined();
    });

    it('should skip completely empty rows', () => {
      const csv = `name;city
Jan;Praha

Petr;Brno`;
      
      const result = parseCsv(csv);
      
      expect(result.data).toHaveLength(2);
    });
  });

  // ==========================================================================
  // VALUE CLEANING
  // ==========================================================================
  describe('cleanValue', () => {
    it('should trim whitespace', () => {
      expect(cleanValue('  Jan  ')).toBe('Jan');
      expect(cleanValue('\tPraha\n')).toBe('Praha');
    });

    it('should convert empty strings to null', () => {
      expect(cleanValue('')).toBeNull();
      expect(cleanValue('   ')).toBeNull();
    });

    it('should convert placeholder values to null', () => {
      expect(cleanValue('-')).toBeNull();
      expect(cleanValue('N/A')).toBeNull();
      expect(cleanValue('n/a')).toBeNull();
      expect(cleanValue('NULL')).toBeNull();
      expect(cleanValue('null')).toBeNull();
    });

    it('should keep valid values', () => {
      expect(cleanValue('Jan Novák')).toBe('Jan Novák');
      expect(cleanValue('0')).toBe('0');
    });
  });

  // ==========================================================================
  // CUSTOMER TYPE INFERENCE
  // ==========================================================================
  describe('inferCustomerType', () => {
    it('should return person when type is explicitly person', () => {
      expect(inferCustomerType({ type: 'person' })).toBe('person');
      expect(inferCustomerType({ type: 'osoba' })).toBe('person');
      expect(inferCustomerType({ type: 'fyzická' })).toBe('person');
      expect(inferCustomerType({ type: 'fo' })).toBe('person');
    });

    it('should return company when type is explicitly company', () => {
      expect(inferCustomerType({ type: 'company' })).toBe('company');
      expect(inferCustomerType({ type: 'firma' })).toBe('company');
      expect(inferCustomerType({ type: 'právnická' })).toBe('company');
      expect(inferCustomerType({ type: 'po' })).toBe('company');
    });

    it('should infer company from IČO', () => {
      expect(inferCustomerType({ ico: '12345678' })).toEqual({ type: 'company', inferred: true });
    });

    it('should infer company from DIČ', () => {
      expect(inferCustomerType({ dic: 'CZ12345678' })).toEqual({ type: 'company', inferred: true });
    });

    it('should infer company from contactPerson', () => {
      expect(inferCustomerType({ contactPerson: 'Jan Novák' })).toEqual({ type: 'company', inferred: true });
    });

    it('should default to person when no indicators', () => {
      expect(inferCustomerType({})).toBe('person');
      expect(inferCustomerType({ name: 'Jan Novák' })).toBe('person');
    });
  });

  // ==========================================================================
  // ROW IMPORTABILITY
  // ==========================================================================
  describe('isRowImportable', () => {
    it('should accept row with name', () => {
      expect(isRowImportable({ name: 'Jan Novák' })).toBe(true);
    });

    it('should accept row with email', () => {
      expect(isRowImportable({ email: 'jan@example.com' })).toBe(true);
    });

    it('should accept row with phone', () => {
      expect(isRowImportable({ phone: '602123456' })).toBe(true);
    });

    it('should accept row with IČO', () => {
      expect(isRowImportable({ ico: '12345678' })).toBe(true);
    });

    it('should accept row with address parts', () => {
      expect(isRowImportable({ street: 'Hlavní 123' })).toBe(true);
      expect(isRowImportable({ city: 'Praha' })).toBe(true);
      expect(isRowImportable({ postalCode: '11000' })).toBe(true);
    });

    it('should accept row with notes only', () => {
      expect(isRowImportable({ notes: 'Some note' })).toBe(true);
    });

    it('should reject completely empty row', () => {
      expect(isRowImportable({})).toBe(false);
      expect(isRowImportable({ type: 'person' })).toBe(false); // type alone is not enough
    });
  });

  // ==========================================================================
  // PHONE NORMALIZATION
  // ==========================================================================
  describe('normalizePhone', () => {
    describe('Czech numbers (CZ)', () => {
      it('should normalize 9-digit number without prefix', () => {
        const result = normalizePhone('602123456', 'CZ');
        expect(result.phone).toBe('+420602123456');
        expect(result.phoneRaw).toBeNull();
        expect(result.issues).toHaveLength(0);
      });

      it('should normalize number with spaces', () => {
        const result = normalizePhone('602 123 456', 'CZ');
        expect(result.phone).toBe('+420602123456');
      });

      it('should normalize number with +420 prefix', () => {
        const result = normalizePhone('+420 602 123 456', 'CZ');
        expect(result.phone).toBe('+420602123456');
      });

      it('should normalize number with 00420 prefix', () => {
        const result = normalizePhone('00420 602123456', 'CZ');
        expect(result.phone).toBe('+420602123456');
      });

      it('should handle leading 0 with warning', () => {
        const result = normalizePhone('0602123456', 'CZ');
        expect(result.phone).toBe('+420602123456');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].level).toBe('warning');
        expect(result.issues[0].message).toContain('úvodní 0');
      });

      it('should normalize number with parentheses and dashes', () => {
        const result = normalizePhone('(602) 123-456', 'CZ');
        expect(result.phone).toBe('+420602123456');
      });

      it('should reject invalid phone and store raw', () => {
        const result = normalizePhone('abc123', 'CZ');
        expect(result.phone).toBeNull();
        expect(result.phoneRaw).toBe('abc123');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].level).toBe('warning');
      });

      it('should reject too short number', () => {
        const result = normalizePhone('12345', 'CZ');
        expect(result.phone).toBeNull();
        expect(result.phoneRaw).toBe('12345');
      });
    });

    describe('International numbers', () => {
      it('should normalize German number', () => {
        const result = normalizePhone('+49 1512 3456789', 'DE');
        expect(result.phone).toBe('+4915123456789');
      });

      it('should normalize Slovak number', () => {
        const result = normalizePhone('+421 905 123 456', 'SK');
        expect(result.phone).toBe('+421905123456');
      });

      it('should preserve international format with +', () => {
        // US numbers need a valid area code - using 212 (New York)
        const result = normalizePhone('+1 212 555 1234', 'US');
        expect(result.phone).toBe('+12125551234');
      });
    });

    describe('Multiple phones', () => {
      it('should take first phone when comma-separated', () => {
        const result = normalizePhone('602111222, 603333444', 'CZ');
        expect(result.phone).toBe('+420602111222');
        expect(result.additionalPhones).toContain('+420603333444');
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].message.toLowerCase()).toContain('více telefonů');
      });

      it('should take first phone when slash-separated', () => {
        const result = normalizePhone('602111222 / 603333444', 'CZ');
        expect(result.phone).toBe('+420602111222');
        expect(result.additionalPhones).toHaveLength(1);
      });
    });

    it('should return null for empty input', () => {
      const result = normalizePhone('', 'CZ');
      expect(result.phone).toBeNull();
      expect(result.phoneRaw).toBeNull();
      expect(result.issues).toHaveLength(0);
    });

    it('should return null for null input', () => {
      const result = normalizePhone(null, 'CZ');
      expect(result.phone).toBeNull();
    });
  });

  // ==========================================================================
  // POSTAL CODE NORMALIZATION
  // ==========================================================================
  describe('normalizePostalCode', () => {
    it('should remove spaces from Czech postal code', () => {
      const result = normalizePostalCode('110 00', 'CZ');
      expect(result.postalCode).toBe('11000');
      expect(result.issues).toHaveLength(0);
    });

    it('should accept valid 5-digit Czech postal code', () => {
      const result = normalizePostalCode('11000', 'CZ');
      expect(result.postalCode).toBe('11000');
      expect(result.issues).toHaveLength(0);
    });

    it('should warn on invalid Czech postal code format', () => {
      const result = normalizePostalCode('1100', 'CZ');
      expect(result.postalCode).toBe('1100');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('warning');
      expect(result.issues[0].message).toContain('PSČ');
    });

    it('should allow foreign postal codes without validation', () => {
      const result = normalizePostalCode('10115', 'DE');
      expect(result.postalCode).toBe('10115');
      expect(result.issues).toHaveLength(0);
    });

    it('should preserve alphanumeric foreign postal codes', () => {
      const result = normalizePostalCode('SW1A 1AA', 'GB');
      expect(result.postalCode).toBe('SW1A 1AA');
      expect(result.issues).toHaveLength(0);
    });

    it('should warn on non-numeric CZ postal code', () => {
      const result = normalizePostalCode('ABC-123', 'CZ');
      expect(result.postalCode).toBe('ABC-123');
      expect(result.issues).toHaveLength(1);
    });

    it('should return null for empty input', () => {
      const result = normalizePostalCode('', 'CZ');
      expect(result.postalCode).toBeNull();
    });
  });

  // ==========================================================================
  // EMAIL NORMALIZATION
  // ==========================================================================
  describe('normalizeEmail', () => {
    it('should lowercase email', () => {
      const result = normalizeEmail('Jan@Example.COM');
      expect(result.email).toBe('jan@example.com');
      expect(result.issues).toHaveLength(0);
    });

    it('should trim email', () => {
      const result = normalizeEmail('  jan@example.com  ');
      expect(result.email).toBe('jan@example.com');
    });

    it('should warn on email without @', () => {
      const result = normalizeEmail('janexample.com');
      expect(result.email).toBe('janexample.com');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('warning');
      expect(result.issues[0].message).toContain('@');
    });

    it('should return null for empty input', () => {
      const result = normalizeEmail('');
      expect(result.email).toBeNull();
    });
  });

  // ==========================================================================
  // IČO NORMALIZATION
  // ==========================================================================
  describe('normalizeIco', () => {
    it('should accept valid 8-digit IČO', () => {
      const result = normalizeIco('12345678', 'company');
      expect(result.ico).toBe('12345678');
      expect(result.issues).toHaveLength(0);
    });

    it('should remove spaces from IČO', () => {
      const result = normalizeIco('123 456 78', 'company');
      expect(result.ico).toBe('12345678');
    });

    it('should pad short IČO with leading zeros', () => {
      const result = normalizeIco('123456', 'company');
      expect(result.ico).toBe('00123456');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('info');
    });

    it('should warn on non-8-digit IČO after cleaning', () => {
      const result = normalizeIco('1234', 'company');
      expect(result.ico).toBe('00001234');
      expect(result.issues.some(i => i.level === 'info')).toBe(true);
    });

    it('should warn when IČO on person type', () => {
      const result = normalizeIco('12345678', 'person');
      expect(result.ico).toBe('12345678');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('warning');
      expect(result.issues[0].message).toContain('fyzické osoby');
    });

    it('should return null for empty input', () => {
      const result = normalizeIco('', 'company');
      expect(result.ico).toBeNull();
    });
  });

  // ==========================================================================
  // DIČ NORMALIZATION
  // ==========================================================================
  describe('normalizeDic', () => {
    it('should accept valid CZ DIČ', () => {
      const result = normalizeDic('CZ12345678', 'CZ', 'company');
      expect(result.dic).toBe('CZ12345678');
      expect(result.issues).toHaveLength(0);
    });

    it('should uppercase DIČ', () => {
      const result = normalizeDic('cz12345678', 'CZ', 'company');
      expect(result.dic).toBe('CZ12345678');
    });

    it('should remove spaces', () => {
      const result = normalizeDic('CZ 123 456 78', 'CZ', 'company');
      expect(result.dic).toBe('CZ12345678');
    });

    it('should add CZ prefix for Czech company if missing', () => {
      const result = normalizeDic('12345678', 'CZ', 'company');
      expect(result.dic).toBe('CZ12345678');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('info');
    });

    it('should accept DIČ with 10 digits', () => {
      const result = normalizeDic('CZ1234567890', 'CZ', 'company');
      expect(result.dic).toBe('CZ1234567890');
      expect(result.issues).toHaveLength(0);
    });

    it('should warn on invalid DIČ format', () => {
      const result = normalizeDic('CZ123', 'CZ', 'company');
      expect(result.dic).toBe('CZ123');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].level).toBe('warning');
    });

    it('should accept foreign DIČ without modification', () => {
      const result = normalizeDic('DE123456789', 'DE', 'company');
      expect(result.dic).toBe('DE123456789');
    });

    it('should warn when DIČ on person type', () => {
      const result = normalizeDic('CZ12345678', 'CZ', 'person');
      expect(result.dic).toBe('CZ12345678');
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('fyzické osoby');
    });

    it('should return null for empty input', () => {
      const result = normalizeDic('', 'CZ', 'company');
      expect(result.dic).toBeNull();
    });
  });

  // ==========================================================================
  // COUNTRY NORMALIZATION
  // ==========================================================================
  describe('normalizeCountry', () => {
    it('should default to CZ when empty', () => {
      const result = normalizeCustomerRow({ name: 'Jan' }, 1);
      expect(result.customer.country).toBe('CZ');
    });

    it('should accept ISO country codes', () => {
      const result = normalizeCustomerRow({ name: 'Jan', country: 'DE' }, 1);
      expect(result.customer.country).toBe('DE');
    });

    it('should normalize common Czech variants', () => {
      expect(normalizeCustomerRow({ name: 'Jan', country: 'Česko' }, 1).customer.country).toBe('CZ');
      expect(normalizeCustomerRow({ name: 'Jan', country: 'Czech Republic' }, 1).customer.country).toBe('CZ');
    });
  });

  // ==========================================================================
  // FULL ROW NORMALIZATION
  // ==========================================================================
  describe('normalizeCustomerRow', () => {
    it('should normalize complete person row', () => {
      const row = {
        type: 'person',
        name: 'Jan Novák',
        street: 'Hlavní 123',
        city: 'Praha',
        postalCode: '110 00',
        country: 'CZ',
        phone: '602 123 456',
        email: 'Jan@Example.com',
        notes: 'Test',
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.customer.type).toBe('person');
      expect(result.customer.name).toBe('Jan Novák');
      expect(result.customer.postalCode).toBe('11000');
      expect(result.customer.phone).toBe('+420602123456');
      expect(result.customer.email).toBe('jan@example.com');
      expect(result.issues).toHaveLength(0);
    });

    it('should normalize complete company row', () => {
      const row = {
        type: 'company',
        name: 'ABC s.r.o.',
        contactPerson: 'Jan Novák',
        ico: '12345678',
        dic: 'CZ12345678',
        street: 'Průmyslová 1',
        city: 'Brno',
        postalCode: '602 00',
        country: 'CZ',
        phone: '+420 541 234 567',
        email: 'info@abc.cz',
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.customer.type).toBe('company');
      expect(result.customer.contactPerson).toBe('Jan Novák');
      expect(result.customer.ico).toBe('12345678');
      expect(result.customer.dic).toBe('CZ12345678');
    });

    it('should infer company type from IČO', () => {
      const row = {
        name: 'Nějaká entita',
        ico: '12345678',
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.customer.type).toBe('company');
      expect(result.issues.some(i => i.message.includes('odvozen'))).toBe(true);
    });

    it('should collect all issues from sub-normalizations', () => {
      const row = {
        name: 'Test',
        postalCode: '1100', // Invalid CZ postal
        phone: 'invalid', // Invalid phone
        email: 'noemail', // No @
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle row with only email', () => {
      const row = {
        email: 'jan@example.com',
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.customer.email).toBe('jan@example.com');
      expect(result.customer.type).toBe('person');
      expect(result.customer.country).toBe('CZ');
    });

    it('should add additional phones to notes', () => {
      const row = {
        name: 'Test',
        phone: '602111222, 603333444',
      };
      
      const result = normalizeCustomerRow(row, 1);
      
      expect(result.customer.phone).toBe('+420602111222');
      expect(result.customer.notes).toContain('+420603333444');
    });
  });

  // ==========================================================================
  // REPORT GENERATION
  // ==========================================================================
  describe('generateTextReport', () => {
    it('should generate report with correct statistics', () => {
      const report: ImportReport = {
        filename: 'test.csv',
        importedAt: '2026-01-27T14:00:00Z',
        durationMs: 5000,
        totalRows: 100,
        importedCount: 90,
        updatedCount: 5,
        skippedCount: 5,
        issues: [],
      };
      
      const text = generateTextReport(report);
      
      expect(text).toContain('test.csv');
      expect(text).toContain('100');
      expect(text).toContain('90');
      expect(text).toContain('5');
    });

    it('should include warnings in report', () => {
      const issues: ImportIssue[] = [
        { rowNumber: 10, level: 'warning', field: 'phone', message: 'Nelze normalizovat', originalValue: 'abc' },
        { rowNumber: 20, level: 'warning', field: 'postalCode', message: 'PSČ není 5 číslic', originalValue: '1100' },
      ];
      
      const report: ImportReport = {
        filename: 'test.csv',
        importedAt: '2026-01-27T14:00:00Z',
        durationMs: 5000,
        totalRows: 100,
        importedCount: 98,
        updatedCount: 0,
        skippedCount: 2,
        issues,
      };
      
      const text = generateTextReport(report);
      
      expect(text).toContain('VAROVÁNÍ');
      expect(text).toContain('Řádek 10');
      expect(text).toContain('phone');
      expect(text).toContain('abc');
    });

    it('should include errors in report', () => {
      const issues: ImportIssue[] = [
        { rowNumber: 5, level: 'error', field: 'csv', message: 'Poškozený řádek' },
      ];
      
      const report: ImportReport = {
        filename: 'test.csv',
        importedAt: '2026-01-27T14:00:00Z',
        durationMs: 5000,
        totalRows: 100,
        importedCount: 99,
        updatedCount: 0,
        skippedCount: 1,
        issues,
      };
      
      const text = generateTextReport(report);
      
      expect(text).toContain('CHYBY');
      expect(text).toContain('Řádek 5');
    });

    it('should format duration correctly', () => {
      const report: ImportReport = {
        filename: 'test.csv',
        importedAt: '2026-01-27T14:00:00Z',
        durationMs: 45000,
        totalRows: 100,
        importedCount: 100,
        updatedCount: 0,
        skippedCount: 0,
        issues: [],
      };
      
      const text = generateTextReport(report);
      
      expect(text).toContain('45');
    });
  });
});
