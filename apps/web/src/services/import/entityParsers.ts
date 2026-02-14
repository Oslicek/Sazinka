/**
 * Entity-specific CSV parsers and normalizers for import
 * See PROJECT_IMPORT.MD for full specification
 */

import Papa from 'papaparse';
import i18n from '../../i18n';
import type { ImportIssue } from '@shared/customer';
import type {
  CsvDeviceRow,
  CsvRevisionRow,
  CsvCommunicationRow,
  CsvWorkLogRow,
  ImportDeviceRequest,
  ImportRevisionRequest,
  ImportCommunicationRequest,
  ImportWorkLogRequest,
} from '@shared/import';
import {
  DEVICE_TYPE_ALIASES as DeviceAliases,
  REVISION_STATUS_ALIASES as RevisionStatusAliases,
  REVISION_RESULT_ALIASES as RevisionResultAliases,
  COMMUNICATION_TYPE_ALIASES as CommTypeAliases,
  COMMUNICATION_DIRECTION_ALIASES as CommDirAliases,
  WORK_TYPE_ALIASES as WorkTypeAliases,
  VISIT_STATUS_ALIASES as VisitStatusAliases,
  WORK_RESULT_ALIASES as WorkResultAliases,
} from '@shared/import';
import { normalizePhone, cleanValue } from './importService';

// =============================================================================
// COMMON UTILITIES
// =============================================================================

const EMPTY_VALUES = ['', '-', 'n/a', 'null'];

function isEmptyValue(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const trimmed = value.trim().toLowerCase();
  return EMPTY_VALUES.includes(trimmed);
}

function normalizeAlias(value: string | undefined, aliases: Record<string, string>): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  if (isEmptyValue(cleaned)) return null;
  return aliases[cleaned] || null;
}

function setMappedValue<T extends object>(target: T, key: keyof T, value: string): void {
  (target as Record<string, string>)[key as string] = value;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  
  // Try ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  
  // Try Czech format (DD.MM.YYYY)
  const czechMatch = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (czechMatch) {
    const [, day, month, year] = czechMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return null;
}

function parseTime(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  
  // Accept HH:MM or HH:MM:SS
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(cleaned)) {
    const parts = cleaned.split(':');
    return `${parts[0].padStart(2, '0')}:${parts[1]}`;
  }
  
  return null;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  if (['true', 'ano', '1', 'yes'].includes(cleaned)) return true;
  if (['false', 'ne', '0', 'no'].includes(cleaned)) return false;
  return null;
}

function parseInt(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = cleanValue(value);
  if (!cleaned) return null;
  const num = Number.parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

// =============================================================================
// DEVICE PARSER
// =============================================================================

const DEVICE_HEADER_MAP: Record<string, keyof CsvDeviceRow> = {
  'customer_ref': 'customer_ref',
  'customerref': 'customer_ref',
  'device_type': 'device_type',
  'devicetype': 'device_type',
  'manufacturer': 'manufacturer',
  'model': 'model',
  'serial_number': 'serial_number',
  'serialnumber': 'serial_number',
  'installation_date': 'installation_date',
  'installationdate': 'installation_date',
  'revision_interval_months': 'revision_interval_months',
  'revisionintervalmonths': 'revision_interval_months',
  'notes': 'notes',
};

export function parseDeviceCsv(csvContent: string): { data: CsvDeviceRow[]; errors: Papa.ParseError[] } {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const data: CsvDeviceRow[] = result.data.map((row) => {
    const cleaned: CsvDeviceRow = {};
    for (const [key, value] of Object.entries(row)) {
      const propName = DEVICE_HEADER_MAP[key];
      if (propName && value !== undefined && value !== '') {
        setMappedValue(cleaned, propName, value);
      }
    }
    return cleaned;
  });

  return { data, errors: result.errors };
}

export function normalizeDeviceRow(row: CsvDeviceRow, rowNumber: number): {
  device: ImportDeviceRequest | null;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];

  // Required: customer_ref
  const customerRef = cleanValue(row.customer_ref);
  if (!customerRef) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'customer_ref',
      message: i18n.t('import:parser_missing_customer_ref'),
    });
    return { device: null, issues };
  }

  // Required: device_type
  const deviceType = normalizeAlias(row.device_type, DeviceAliases);
  if (!deviceType) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'device_type',
      message: row.device_type ? i18n.t('import:parser_unknown_device_type', { type: row.device_type }) : i18n.t('import:parser_missing_device_type'),
      originalValue: row.device_type,
    });
    return { device: null, issues };
  }

  // Required: revision_interval_months
  const revisionIntervalMonths = parseInt(row.revision_interval_months);
  if (revisionIntervalMonths === null || revisionIntervalMonths <= 0) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'revision_interval_months',
      message: i18n.t('import:parser_invalid_interval'),
      originalValue: row.revision_interval_months,
    });
    return { device: null, issues };
  }

  // Optional: installation_date
  const installationDate = parseDate(row.installation_date);
  if (row.installation_date && !installationDate) {
    issues.push({
      rowNumber,
      level: 'warning',
      field: 'installation_date',
      message: i18n.t('import:parser_invalid_install_date'),
      originalValue: row.installation_date,
    });
  }

  const device: ImportDeviceRequest = {
    customerRef,
    deviceType,
    manufacturer: cleanValue(row.manufacturer) || undefined,
    model: cleanValue(row.model) || undefined,
    serialNumber: cleanValue(row.serial_number) || undefined,
    installationDate: installationDate || undefined,
    revisionIntervalMonths,
    notes: cleanValue(row.notes) || undefined,
  };

  return { device, issues };
}

// =============================================================================
// REVISION PARSER
// =============================================================================

const REVISION_HEADER_MAP: Record<string, keyof CsvRevisionRow> = {
  'device_ref': 'device_ref',
  'deviceref': 'device_ref',
  'customer_ref': 'customer_ref',
  'customerref': 'customer_ref',
  'due_date': 'due_date',
  'duedate': 'due_date',
  'status': 'status',
  'scheduled_date': 'scheduled_date',
  'scheduleddate': 'scheduled_date',
  'scheduled_time_start': 'scheduled_time_start',
  'scheduledtimestart': 'scheduled_time_start',
  'scheduled_time_end': 'scheduled_time_end',
  'scheduledtimeend': 'scheduled_time_end',
  'completed_at': 'completed_at',
  'completedat': 'completed_at',
  'duration_minutes': 'duration_minutes',
  'durationminutes': 'duration_minutes',
  'result': 'result',
  'findings': 'findings',
};

export function parseRevisionCsv(csvContent: string): { data: CsvRevisionRow[]; errors: Papa.ParseError[] } {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const data: CsvRevisionRow[] = result.data.map((row) => {
    const cleaned: CsvRevisionRow = {};
    for (const [key, value] of Object.entries(row)) {
      const propName = REVISION_HEADER_MAP[key];
      if (propName && value !== undefined && value !== '') {
        setMappedValue(cleaned, propName, value);
      }
    }
    return cleaned;
  });

  return { data, errors: result.errors };
}

export function normalizeRevisionRow(row: CsvRevisionRow, rowNumber: number): {
  revision: ImportRevisionRequest | null;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];

  // Required: device_ref
  const deviceRef = cleanValue(row.device_ref);
  if (!deviceRef) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'device_ref',
      message: i18n.t('import:parser_missing_device_ref'),
    });
    return { revision: null, issues };
  }

  // Required: customer_ref
  const customerRef = cleanValue(row.customer_ref);
  if (!customerRef) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'customer_ref',
      message: i18n.t('import:parser_missing_customer_ref'),
    });
    return { revision: null, issues };
  }

  // Required: due_date
  const dueDate = parseDate(row.due_date);
  if (!dueDate) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'due_date',
      message: row.due_date ? i18n.t('import:parser_invalid_date_format', { value: row.due_date }) : i18n.t('import:parser_missing_due_date'),
      originalValue: row.due_date,
    });
    return { revision: null, issues };
  }

  // Optional: status
  let status = normalizeAlias(row.status, RevisionStatusAliases);
  const result = normalizeAlias(row.result, RevisionResultAliases);
  
  // Auto-set status to completed if result is provided
  if (result && !status) {
    status = 'completed';
    issues.push({
      rowNumber,
      level: 'info',
      field: 'status',
      message: i18n.t('import:parser_status_set_completed'),
    });
  }

  // Warn if completed without result
  if (status === 'completed' && !result) {
    issues.push({
      rowNumber,
      level: 'warning',
      field: 'result',
      message: i18n.t('import:parser_completed_no_result'),
    });
  }

  const revision: ImportRevisionRequest = {
    deviceRef,
    customerRef,
    dueDate,
    status: status || 'upcoming',
    scheduledDate: parseDate(row.scheduled_date) || undefined,
    scheduledTimeStart: parseTime(row.scheduled_time_start) || undefined,
    scheduledTimeEnd: parseTime(row.scheduled_time_end) || undefined,
    completedAt: cleanValue(row.completed_at) || undefined,
    durationMinutes: parseInt(row.duration_minutes) || undefined,
    result: result || undefined,
    findings: cleanValue(row.findings) || undefined,
  };

  return { revision, issues };
}

// =============================================================================
// COMMUNICATION PARSER
// =============================================================================

const COMMUNICATION_HEADER_MAP: Record<string, keyof CsvCommunicationRow> = {
  'customer_ref': 'customer_ref',
  'customerref': 'customer_ref',
  'date': 'date',
  'comm_type': 'comm_type',
  'commtype': 'comm_type',
  'type': 'comm_type',
  'direction': 'direction',
  'subject': 'subject',
  'content': 'content',
  'contact_name': 'contact_name',
  'contactname': 'contact_name',
  'contact_phone': 'contact_phone',
  'contactphone': 'contact_phone',
  'duration_minutes': 'duration_minutes',
  'durationminutes': 'duration_minutes',
};

export function parseCommunicationCsv(csvContent: string): { data: CsvCommunicationRow[]; errors: Papa.ParseError[] } {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const data: CsvCommunicationRow[] = result.data.map((row) => {
    const cleaned: CsvCommunicationRow = {};
    for (const [key, value] of Object.entries(row)) {
      const propName = COMMUNICATION_HEADER_MAP[key];
      if (propName && value !== undefined && value !== '') {
        setMappedValue(cleaned, propName, value);
      }
    }
    return cleaned;
  });

  return { data, errors: result.errors };
}

export function normalizeCommunicationRow(row: CsvCommunicationRow, rowNumber: number): {
  communication: ImportCommunicationRequest | null;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];

  // Required: customer_ref
  const customerRef = cleanValue(row.customer_ref);
  if (!customerRef) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'customer_ref',
      message: i18n.t('import:parser_missing_customer_ref'),
    });
    return { communication: null, issues };
  }

  // Required: date
  const date = parseDate(row.date);
  if (!date) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'date',
      message: row.date ? i18n.t('import:parser_invalid_date_format', { value: row.date }) : i18n.t('import:parser_missing_comm_date'),
      originalValue: row.date,
    });
    return { communication: null, issues };
  }

  // Required: comm_type
  const commType = normalizeAlias(row.comm_type, CommTypeAliases);
  if (!commType) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'comm_type',
      message: row.comm_type ? i18n.t('import:parser_unknown_comm_type', { type: row.comm_type }) : i18n.t('import:parser_missing_comm_type'),
      originalValue: row.comm_type,
    });
    return { communication: null, issues };
  }

  // Required: direction
  const direction = normalizeAlias(row.direction, CommDirAliases);
  if (!direction) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'direction',
      message: row.direction ? i18n.t('import:parser_unknown_direction', { value: row.direction }) : i18n.t('import:parser_missing_direction'),
      originalValue: row.direction,
    });
    return { communication: null, issues };
  }

  // Required: content
  const content = cleanValue(row.content);
  if (!content) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'content',
      message: i18n.t('import:parser_missing_content'),
    });
    return { communication: null, issues };
  }

  // Optional: contact_phone normalization
  let contactPhone = cleanValue(row.contact_phone) || undefined;
  if (contactPhone) {
    const phoneResult = normalizePhone(contactPhone, 'CZ');
    if (phoneResult.phone) {
      contactPhone = phoneResult.phone;
    }
    phoneResult.issues.forEach(i => {
      i.rowNumber = rowNumber;
      i.field = 'contact_phone';
    });
    issues.push(...phoneResult.issues);
  }

  const communication: ImportCommunicationRequest = {
    customerRef,
    date,
    commType,
    direction,
    subject: cleanValue(row.subject) || undefined,
    content,
    contactName: cleanValue(row.contact_name) || undefined,
    contactPhone,
    durationMinutes: parseInt(row.duration_minutes) || undefined,
  };

  return { communication, issues };
}

// =============================================================================
// VISIT PARSER
// =============================================================================

const WORK_LOG_HEADER_MAP: Record<string, keyof CsvWorkLogRow> = {
  'customer_ref': 'customer_ref',
  'customerref': 'customer_ref',
  'scheduled_date': 'scheduled_date',
  'scheduleddate': 'scheduled_date',
  'scheduled_time_start': 'scheduled_time_start',
  'scheduledtimestart': 'scheduled_time_start',
  'scheduled_time_end': 'scheduled_time_end',
  'scheduledtimeend': 'scheduled_time_end',
  'device_ref': 'device_ref',
  'deviceref': 'device_ref',
  'work_type': 'work_type',
  'worktype': 'work_type',
  'type': 'work_type',
  'status': 'status',
  'result': 'result',
  'duration_minutes': 'duration_minutes',
  'durationminutes': 'duration_minutes',
  'result_notes': 'result_notes',
  'resultnotes': 'result_notes',
  'findings': 'findings',
  'requires_follow_up': 'requires_follow_up',
  'requiresfollowup': 'requires_follow_up',
  'follow_up_reason': 'follow_up_reason',
  'followupreason': 'follow_up_reason',
};

export function parseWorkLogCsv(csvContent: string): { data: CsvWorkLogRow[]; errors: Papa.ParseError[] } {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  const data: CsvWorkLogRow[] = result.data.map((row) => {
    const cleaned: CsvWorkLogRow = {};
    for (const [key, value] of Object.entries(row)) {
      const propName = WORK_LOG_HEADER_MAP[key];
      if (propName && value !== undefined && value !== '') {
        setMappedValue(cleaned, propName, value);
      }
    }
    return cleaned;
  });

  return { data, errors: result.errors };
}

export function normalizeWorkLogRow(row: CsvWorkLogRow, rowNumber: number): {
  entry: ImportWorkLogRequest | null;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];

  // Required: customer_ref
  const customerRef = cleanValue(row.customer_ref);
  if (!customerRef) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'customer_ref',
      message: i18n.t('import:parser_missing_customer_ref'),
    });
    return { entry: null, issues };
  }

  // Required: scheduled_date
  const scheduledDate = parseDate(row.scheduled_date);
  if (!scheduledDate) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'scheduled_date',
      message: row.scheduled_date ? i18n.t('import:parser_invalid_date_format', { value: row.scheduled_date }) : i18n.t('import:parser_missing_scheduled_date'),
      originalValue: row.scheduled_date,
    });
    return { entry: null, issues };
  }

  // Required: work_type
  const workType = normalizeAlias(row.work_type, WorkTypeAliases);
  if (!workType) {
    issues.push({
      rowNumber,
      level: 'error',
      field: 'work_type',
      message: row.work_type ? i18n.t('import:parser_unknown_work_type', { type: row.work_type }) : i18n.t('import:parser_missing_work_type'),
      originalValue: row.work_type,
    });
    return { entry: null, issues };
  }

  // Optional: device_ref
  const deviceRef = cleanValue(row.device_ref) || undefined;
  if (workType === 'revision' && !deviceRef) {
    issues.push({
      rowNumber,
      level: 'warning',
      field: 'device_ref',
      message: i18n.t('import:parser_revision_no_device'),
    });
  }

  // Optional: status
  let status = normalizeAlias(row.status, VisitStatusAliases);
  const result = normalizeAlias(row.result, WorkResultAliases);
  
  // Auto-set status to completed if result is provided
  if (result && !status) {
    status = 'completed';
    issues.push({
      rowNumber,
      level: 'info',
      field: 'status',
      message: i18n.t('import:parser_status_set_completed'),
    });
  }

  // Warn if completed without result
  if (status === 'completed' && !result) {
    issues.push({
      rowNumber,
      level: 'warning',
      field: 'result',
      message: i18n.t('import:parser_completed_work_no_result'),
    });
  }

  // Optional: duration_minutes
  const durationMinutesVal = parseInt(row.duration_minutes);
  const durationMinutes = durationMinutesVal !== null ? durationMinutesVal : undefined;
  if (row.duration_minutes && durationMinutes === undefined) {
    issues.push({
      rowNumber,
      level: 'warning',
      field: 'duration_minutes',
      message: i18n.t('import:parser_invalid_duration', { value: row.duration_minutes }),
      originalValue: row.duration_minutes,
    });
  }

  const entry: ImportWorkLogRequest = {
    customerRef,
    scheduledDate,
    scheduledTimeStart: parseTime(row.scheduled_time_start) || undefined,
    scheduledTimeEnd: parseTime(row.scheduled_time_end) || undefined,
    deviceRef,
    workType,
    status: status || 'planned',
    result: result || undefined,
    durationMinutes: durationMinutes && !isNaN(durationMinutes) ? durationMinutes : undefined,
    resultNotes: cleanValue(row.result_notes) || undefined,
    findings: cleanValue(row.findings) || undefined,
    requiresFollowUp: parseBoolean(row.requires_follow_up) || undefined,
    followUpReason: cleanValue(row.follow_up_reason) || undefined,
  };

  return { entry, issues };
}

// =============================================================================
// GENERIC PROCESSING
// =============================================================================

export type EntityType = 'customer' | 'device' | 'revision' | 'communication' | 'work_log';

export interface ParsedEntity<T> {
  entity: T | null;
  issues: ImportIssue[];
}

export function processDeviceCsv(csvContent: string): {
  devices: ImportDeviceRequest[];
  issues: ImportIssue[];
  totalRows: number;
  skippedCount: number;
} {
  const { data, errors } = parseDeviceCsv(csvContent);
  const devices: ImportDeviceRequest[] = [];
  const issues: ImportIssue[] = [];
  let skippedCount = 0;

  // Add parsing errors
  errors.forEach(err => {
    issues.push({
      rowNumber: err.row || 0,
      level: 'error',
      field: 'csv',
      message: err.message,
    });
  });

  // Process each row
  data.forEach((row, index) => {
    const rowNumber = index + 2; // +2 because of header and 1-based indexing
    const result = normalizeDeviceRow(row, rowNumber);
    
    issues.push(...result.issues);
    
    if (result.device) {
      devices.push(result.device);
    } else {
      skippedCount++;
    }
  });

  return {
    devices,
    issues,
    totalRows: data.length,
    skippedCount,
  };
}

export function processRevisionCsv(csvContent: string): {
  revisions: ImportRevisionRequest[];
  issues: ImportIssue[];
  totalRows: number;
  skippedCount: number;
} {
  const { data, errors } = parseRevisionCsv(csvContent);
  const revisions: ImportRevisionRequest[] = [];
  const issues: ImportIssue[] = [];
  let skippedCount = 0;

  errors.forEach(err => {
    issues.push({
      rowNumber: err.row || 0,
      level: 'error',
      field: 'csv',
      message: err.message,
    });
  });

  data.forEach((row, index) => {
    const rowNumber = index + 2;
    const result = normalizeRevisionRow(row, rowNumber);
    
    issues.push(...result.issues);
    
    if (result.revision) {
      revisions.push(result.revision);
    } else {
      skippedCount++;
    }
  });

  return {
    revisions,
    issues,
    totalRows: data.length,
    skippedCount,
  };
}

export function processCommunicationCsv(csvContent: string): {
  communications: ImportCommunicationRequest[];
  issues: ImportIssue[];
  totalRows: number;
  skippedCount: number;
} {
  const { data, errors } = parseCommunicationCsv(csvContent);
  const communications: ImportCommunicationRequest[] = [];
  const issues: ImportIssue[] = [];
  let skippedCount = 0;

  errors.forEach(err => {
    issues.push({
      rowNumber: err.row || 0,
      level: 'error',
      field: 'csv',
      message: err.message,
    });
  });

  data.forEach((row, index) => {
    const rowNumber = index + 2;
    const result = normalizeCommunicationRow(row, rowNumber);
    
    issues.push(...result.issues);
    
    if (result.communication) {
      communications.push(result.communication);
    } else {
      skippedCount++;
    }
  });

  return {
    communications,
    issues,
    totalRows: data.length,
    skippedCount,
  };
}

export function processWorkLogCsv(csvContent: string): {
  entries: ImportWorkLogRequest[];
  issues: ImportIssue[];
  totalRows: number;
  skippedCount: number;
} {
  const { data, errors } = parseWorkLogCsv(csvContent);
  const entries: ImportWorkLogRequest[] = [];
  const issues: ImportIssue[] = [];
  let skippedCount = 0;

  errors.forEach(err => {
    issues.push({
      rowNumber: err.row || 0,
      level: 'error',
      field: 'csv',
      message: err.message,
    });
  });

  data.forEach((row, index) => {
    const rowNumber = index + 2;
    const result = normalizeWorkLogRow(row, rowNumber);
    
    issues.push(...result.issues);
    
    if (result.entry) {
      entries.push(result.entry);
    } else {
      skippedCount++;
    }
  });

  return {
    entries,
    issues,
    totalRows: data.length,
    skippedCount,
  };
}
