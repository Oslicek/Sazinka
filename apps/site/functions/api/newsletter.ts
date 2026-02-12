import { newsletterSchema } from '../../src/lib/validation';
import { generateConfirmToken } from '../lib/token';

interface D1Prepared {
  bind: (...values: unknown[]) => D1Prepared;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Prepared;
}

interface NewsletterContext {
  request: Request;
  env?: {
    DB?: D1DatabaseLike;
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context: NewsletterContext): Promise<Response> {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const parsed = newsletterSchema.safeParse(body);
  if (!parsed.success) {
    return json({ success: false, error: 'Validation failed', details: parsed.error.issues }, 400);
  }

  // Honeypot: fake success, do not process.
  if (parsed.data.website && parsed.data.website.trim() !== '') {
    return json({ success: true, pendingConfirmation: true });
  }

  const token = generateConfirmToken();

  if (context.env?.DB) {
    await context.env.DB
      .prepare(
        `INSERT INTO newsletter_subscribers (email, locale, status, confirm_token, created_at)
         VALUES (?, ?, 'pending', ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           locale = excluded.locale,
           status = 'pending',
           confirm_token = excluded.confirm_token`,
      )
      .bind(
        parsed.data.email,
        parsed.data.locale ?? 'en',
        token,
        new Date().toISOString(),
      )
      .run();
  }

  // NOTE: Resend send is implemented in dedicated e-mail phase.
  return json({ success: true, pendingConfirmation: true, token });
}
