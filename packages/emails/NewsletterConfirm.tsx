import * as React from 'react';
import { Body, Button, Container, Head, Heading, Html, Preview, Text } from '@react-email/components';

interface NewsletterConfirmProps {
  confirmUrl: string;
  locale?: 'en' | 'cs' | 'sk';
}

const copy = {
  en: {
    heading: 'Confirm newsletter subscription',
    text: 'Please confirm your subscription by clicking the button below.',
    cta: 'Confirm subscription',
  },
  cs: {
    heading: 'Potvrzení odběru newsletteru',
    text: 'Prosím potvrďte odběr kliknutím na tlačítko níže.',
    cta: 'Potvrdit odběr',
  },
  sk: {
    heading: 'Potvrdenie odberu newslettera',
    text: 'Prosím potvrďte odber kliknutím na tlačidlo nižšie.',
    cta: 'Potvrdiť odber',
  },
} as const;

export function NewsletterConfirm({ confirmUrl, locale = 'en' }: NewsletterConfirmProps) {
  const t = copy[locale];

  return (
    <Html>
      <Head />
      <Preview>{t.heading}</Preview>
      <Body style={{ backgroundColor: '#f8fafc', fontFamily: 'Inter, Arial, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px' }}>
          <Heading style={{ color: '#1e293b' }}>{t.heading}</Heading>
          <Text>{t.text}</Text>
          <Button
            href={confirmUrl}
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '12px 18px',
              textDecoration: 'none',
            }}
          >
            {t.cta}
          </Button>
        </Container>
      </Body>
    </Html>
  );
}
