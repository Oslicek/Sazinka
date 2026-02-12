export async function submitContact(data: {
  email: string;
  message: string;
  locale: string;
  website?: string;
}): Promise<{ success: boolean; ticketId?: string }> {
  const response = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Contact submit failed: ${response.status}`);
  }
  return response.json();
}

export async function submitNewsletter(data: {
  email: string;
  locale: string;
  gdprConsent: boolean;
  website?: string;
}): Promise<{ success: boolean; pendingConfirmation?: boolean }> {
  const response = await fetch('/api/newsletter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Newsletter submit failed: ${response.status}`);
  }
  return response.json();
}
