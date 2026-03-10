const SUPPORTED_LOCALES = ['cs', 'sk', 'en'] as const;
const DEFAULT_LOCALE = 'en';

function pickLocale(acceptLanguage: string | null): string {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const entries = acceptLanguage
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.toLowerCase().slice(0, 2), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of entries) {
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      return lang;
    }
  }

  return DEFAULT_LOCALE;
}

interface RootContext {
  request: Request;
}

export async function onRequestGet(context: RootContext): Promise<Response> {
  const url = new URL(context.request.url);

  if (url.pathname !== '/' && url.pathname !== '') {
    return fetch(context.request);
  }

  const acceptLang = context.request.headers.get('accept-language');
  const locale = pickLocale(acceptLang);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${locale}/`,
      'Cache-Control': 'no-cache, no-store',
      Vary: 'Accept-Language',
    },
  });
}
