import React from 'react';
import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContactConfirmation } from '../ContactConfirmation';
import { NewsletterConfirm } from '../NewsletterConfirm';

describe('ContactConfirmation email', () => {
  test('renders ticket ID and message preview', () => {
    const html = renderToStaticMarkup(
      <ContactConfirmation ticketId="REQ-2026-000123" messagePreview="Need help with import." />,
    );
    expect(html).toContain('REQ-2026-000123');
    expect(html).toContain('Need help with import.');
  });
});

describe('NewsletterConfirm email', () => {
  test('renders confirmation link', () => {
    const html = renderToStaticMarkup(
      <NewsletterConfirm confirmUrl="https://ariadline.com/api/newsletter/confirm?token=abc" />,
    );
    expect(html).toContain('/api/newsletter/confirm?token=abc');
  });

  test('renders localized Czech copy', () => {
    const html = renderToStaticMarkup(
      <NewsletterConfirm
        confirmUrl="https://ariadline.com/api/newsletter/confirm?token=abc"
        locale="cs"
      />,
    );
    expect(html).toContain('Potvrzení odběru newsletteru');
  });
});
