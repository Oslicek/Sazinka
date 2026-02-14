/**
 * Utility functions for calculating and formatting overdue information
 * for device revisions.
 * 
 * Key business logic:
 * - Overdue is calculated from last COMPLETED revision + device interval
 * - If no completed revision exists, device is "never serviced"
 * - Installation date can be used as fallback for calculating when first service was due
 */

import i18n from '@/i18n';

export interface DeviceOverdueInfo {
  deviceId: string;
  isOverdue: boolean;
  neverServiced: boolean;
  nextDueDate: string | null;
  overdueDays: number;
  overdueFromInstallation?: boolean;
}

export interface CalculateOverdueParams {
  deviceId: string;
  revisionIntervalMonths: number;
  lastCompletedDate: string | null;
  installationDate?: string | null;
  today: Date;
}

/**
 * Format overdue duration using i18next pluralization (years, months, days)
 * 
 * @param days - Number of days overdue
 * @returns Formatted string like "2 years, 3 months, 15 days" or null if not overdue
 */
export function formatOverdueDuration(days: number): string | null {
  if (days < 0) {
    return null;
  }

  if (days === 0) {
    return i18n.t('common:duration.zero_days');
  }

  const years = Math.floor(days / 365);
  const remainingAfterYears = days % 365;
  const months = Math.floor(remainingAfterYears / 30);
  const remainingDays = remainingAfterYears % 30;

  const parts: string[] = [];

  if (years > 0) {
    parts.push(i18n.t('common:duration.years', { count: years }));
  }

  if (months > 0) {
    parts.push(i18n.t('common:duration.months', { count: months }));
  }

  if (remainingDays > 0 || parts.length === 0) {
    // Only add days if there are remaining days, or if it's the only unit
    if (remainingDays > 0 || (years === 0 && months === 0)) {
      parts.push(i18n.t('common:duration.days', { count: remainingDays || days }));
    }
  }

  return parts.join(', ');
}

/**
 * Calculate overdue information for a device based on its last completed revision.
 * 
 * Business rules:
 * 1. If there's a completed revision: next_due = last_completed + interval
 * 2. If no completed revision but has installation date: 
 *    next_due = installation_date + interval (and mark as "never serviced")
 * 3. If no completed revision and no installation date: just mark as "never serviced"
 */
export function calculateOverdueInfo(params: CalculateOverdueParams): DeviceOverdueInfo {
  const { deviceId, revisionIntervalMonths, lastCompletedDate, installationDate, today } = params;

  // No completed revisions - device has never been serviced
  if (!lastCompletedDate) {
    // If we have installation date, we can calculate when first service was due
    if (installationDate) {
      const installDate = new Date(installationDate);
      const firstDueDate = addMonths(installDate, revisionIntervalMonths);
      const isOverdue = firstDueDate < today;
      const overdueDays = isOverdue ? Math.floor((today.getTime() - firstDueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

      return {
        deviceId,
        isOverdue,
        neverServiced: true,
        nextDueDate: formatDate(firstDueDate),
        overdueDays,
        overdueFromInstallation: true,
      };
    }

    // No installation date either - we don't know when it's due
    return {
      deviceId,
      isOverdue: false,
      neverServiced: true,
      nextDueDate: null,
      overdueDays: 0,
    };
  }

  // Has completed revision - calculate next due date
  const lastCompleted = new Date(lastCompletedDate);
  const nextDue = addMonths(lastCompleted, revisionIntervalMonths);
  const isOverdue = nextDue < today;
  const overdueDays = isOverdue ? Math.floor((today.getTime() - nextDue.getTime()) / (1000 * 60 * 60 * 24)) : 0;

  return {
    deviceId,
    isOverdue,
    neverServiced: false,
    nextDueDate: formatDate(nextDue),
    overdueDays,
  };
}

/**
 * Add months to a date
 */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
