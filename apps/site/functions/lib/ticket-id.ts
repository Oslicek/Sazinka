export function generateTicketId(sequence: number, date = new Date()): string {
  const year = date.getFullYear();
  const padded = String(sequence).padStart(6, '0');
  return `REQ-${year}-${padded}`;
}
