# Ariadline Marketing Site

Modern, performant marketing website built with Astro, React, and TypeScript.

## 🚀 Tech Stack

- **Framework**: Astro 5 (SSG)
- **UI Components**: React 19 (islands architecture)
- **Styling**: CSS Modules + Astro Scoped CSS
- **i18n**: 3 languages (English, Czech, Slovak)
- **Backend**: Cloudflare Pages Functions (TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Email**: Resend + React Email
- **Analytics**: Umami Cloud
- **Testing**: Vitest (Node + jsdom + workerd environments)
- **CI/CD**: GitHub Actions + Cloudflare Pages

## 📦 Project Structure

```
apps/site/
├── src/
│   ├── components/
│   │   ├── layout/          # Header, Footer
│   │   ├── sections/        # Hero, Features, CTA, etc.
│   │   └── react/           # Interactive React islands
│   ├── content/
│   │   └── blog/            # Blog posts (Markdown)
│   ├── i18n/                # Translation files
│   ├── layouts/             # Page layouts
│   ├── lib/                 # Utilities (validation, API)
│   ├── pages/               # Routes (en, cs, sk)
│   ├── styles/              # Global CSS
│   └── test/                # Test helpers
├── functions/               # Cloudflare Pages Functions
│   ├── api/                 # API endpoints
│   └── lib/                 # Shared utilities
├── migrations/              # D1 database migrations
└── public/                  # Static assets
```

## 🛠️ Development

### Prerequisites

- Node.js 22+
- pnpm 9+

### Commands

```bash
# Install dependencies (from monorepo root)
pnpm install

# Development server
pnpm --filter @ariadline/site dev

# Run tests
pnpm --filter @ariadline/site test

# Run Pages Functions tests
pnpm --filter @ariadline/site test:functions

# Type checking
pnpm --filter @ariadline/site check

# Build for production
pnpm --filter @ariadline/site build

# Preview production build
pnpm --filter @ariadline/site preview
```

## 🧪 Testing

The project uses Vitest with three different environments:

1. **Node environment** (default): Astro components, utilities
2. **jsdom environment**: React components
3. **workerd environment**: Cloudflare Pages Functions

Run all tests:
```bash
pnpm test
```

Run specific test suites:
```bash
pnpm test -- accessibility
pnpm test:functions
```

## 🌍 Internationalization

The site supports 3 languages:

- English (`/en/`)
- Czech (`/cs/`)
- Slovak (`/sk/`)

Root `/` redirects via Cloudflare Pages Function (302 based on `Accept-Language`). Fallback `index.astro` uses `navigator.language` with `/en/` default for local dev without wrangler. Astro's built-in `redirectToDefaultLocale` is disabled to prevent a visible "Redirecting..." flash.

Translation files: `src/i18n/{en,cs,sk}.json`

## 🎨 Design Tokens

Shared design tokens are defined in `packages/design-tokens/tokens.json` and compiled to CSS variables.

Update tokens:
```bash
pnpm --filter @ariadline/design-tokens build
```

## 📧 Email Templates

Email templates use React Email and are shared across the monorepo (`packages/emails/`).

Preview emails:
```bash
pnpm --filter @ariadline/emails dev
```

## 🚢 Deployment

### Cloudflare Pages

The site is automatically deployed to Cloudflare Pages on push to `master`.

**Required secrets** (GitHub repository settings):
- `CLOUDFLARE_API_TOKEN`: API token with Pages write permissions
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID

**Environment variables** (Cloudflare Pages settings):
- `RESEND_API_KEY`: Resend API key for sending emails
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret (anti-spam)

### D1 Database

Create D1 database:
```bash
cd apps/site
wrangler d1 create ariadline-site-db
```

Run migrations:
```bash
wrangler d1 migrations apply ariadline-site-db --remote
```

Bind database in `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "ariadline-site-db"
database_id = "your-database-id"
```

## 📊 Performance Goals

| Metric | Target |
|--------|--------|
| Lighthouse Performance | 95+ |
| Lighthouse Accessibility | 95+ |
| Lighthouse Best Practices | 95+ |
| Lighthouse SEO | 95+ |
| First Contentful Paint | < 1.5s |
| Largest Contentful Paint | < 2.5s |
| Cumulative Layout Shift | < 0.1 |
| Total Blocking Time | < 300ms |

Lighthouse CI runs on every PR and enforces these thresholds.

## 🔒 Security

- **Honeypot**: Hidden `website` field in forms
- **Cloudflare Turnstile**: CAPTCHA alternative
- **Rate limiting**: Built into Cloudflare Pages
- **GDPR compliance**: Cookie-free analytics (Umami)
- **Double opt-in**: Newsletter subscriptions

## 📝 License

Proprietary - All rights reserved
