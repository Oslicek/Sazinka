import * as React from 'react';
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from '@react-email/components';

interface ContactConfirmationProps {
  ticketId: string;
  messagePreview: string;
}

export function ContactConfirmation({ ticketId, messagePreview }: ContactConfirmationProps) {
  return (
    <Html>
      <Head />
      <Preview>Your request {ticketId} was received</Preview>
      <Body style={{ backgroundColor: '#f8fafc', fontFamily: 'Inter, Arial, sans-serif' }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px' }}>
          <Heading style={{ color: '#1e293b' }}>Ariadline support request received</Heading>
          <Text>Ticket ID: <strong>{ticketId}</strong></Text>
          <Section
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px',
              backgroundColor: '#f8fafc',
            }}
          >
            <Text style={{ margin: 0 }}>{messagePreview}</Text>
          </Section>
          <Text style={{ color: '#64748b' }}>
            We will get back to you as soon as possible.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
