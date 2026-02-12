interface D1Prepared {
  bind: (...values: unknown[]) => D1Prepared;
  run: () => Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare: (query: string) => D1Prepared;
}

interface ConfirmContext {
  request: Request;
  env?: {
    DB?: D1DatabaseLike;
  };
}

export async function onRequestGet(context: ConfirmContext): Promise<Response> {
  const { searchParams } = new URL(context.request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing confirmation token', { status: 400 });
  }

  if (context.env?.DB) {
    const result = await context.env.DB
      .prepare(
        `UPDATE newsletter_subscribers
         SET status = 'confirmed', confirmed_at = ?
         WHERE confirm_token = ? AND status != 'confirmed'`,
      )
      .bind(new Date().toISOString(), token)
      .run();

    if (!result.meta?.changes) {
      return new Response('Invalid or expired token', { status: 404 });
    }
  }

  const body = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Newsletter confirmed</title>
  </head>
  <body>
    <h1>Newsletter subscription confirmed</h1>
    <p>Your subscription has been confirmed. You can close this tab.</p>
  </body>
</html>`;

  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
