import { contactSchema } from '../../src/lib/validation';
import { generateTicketId } from '../lib/ticket-id';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface D1Prepared {
  bind: (...values: unknown[]) => D1Prepared;
  run: () => Promise<{ meta?: { changes?: number } }>;
  first: () => Promise<Record<string, unknown> | null>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Prepared;
}

interface ContactContext {
  request: Request;
  env?: {
    DB?: D1DatabaseLike;
  };
}

export async function onRequestPost(context: ContactContext): Promise<Response> {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return json({ success: false, error: 'Validation failed', details: parsed.error.issues }, 400);
  }

  // Honeypot: fake success, do not process.
  if (parsed.data.website && parsed.data.website.trim() !== '') {
    return json({ success: true });
  }

  const sequence = Number(String(Date.now()).slice(-6));
  const ticketId = generateTicketId(sequence);

  if (context.env?.DB) {
    await context.env.DB
      .prepare(
        `INSERT INTO contacts (email, message, source, locale, country_code, ticket_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        parsed.data.email,
        parsed.data.message,
        parsed.data.source ?? null,
        parsed.data.locale ?? 'en',
        parsed.data.countryCode ?? null,
        ticketId,
        new Date().toISOString(),
      )
      .run();
  }

  return json({ success: true, ticketId });
}
