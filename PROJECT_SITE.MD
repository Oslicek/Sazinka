# PROJECT_SITE.MD — Ariadline Marketing Website

> Status: **Planning**  
> Last updated: 2026-02-12

---

## 1. Přehled

Marketingový web pro produkt **Ariadline** ("Untangle your workday.") — SaaS pro řemeslníky
zaměřený na plánování tras, CRM a správu pravidelných revizí.

Web je **oddělený** od hlavní aplikace (která používá WebSockets/NATS pro real-time
interaktivitu). Marketing site je statický SSG web optimalizovaný na maximální rychlost
načtení, SEO a konverzní rate.

### Klíčová rozhodnutí

| Otázka | Rozhodnutí |
|--------|-----------|
| Repo struktura | **Monorepo** — nový workspace `apps/site` vedle `apps/web` a `worker` |
| Framework | **Astro** s React islands |
| Styling | **CSS Modules** (React islands) + **Astro Scoped CSS** (`.astro`) + sdílené design tokeny |
| Hosting | **Cloudflare Pages** (statické HTML na globální CDN) |
| Backend formulářů | **Cloudflare Pages Functions** (API na stejné doméně) |
| Lokalizace | **3 jazyky od startu**: en, cs, sk |
| Doménové schéma | `ariadline.com` (web + Pages Functions API `/api/...`), `app.ariadline.com` (SPA), `api.ariadline.com` (hlavní aplikace — Rust) |
| Registrace/Login | Redirect na `app.ariadline.com` |
| Analytics | **Umami Cloud** (cookie-free, GDPR-compliant, ~2 KB, `defer`) |
| ROI kalkulačka | Pozdější fáze (ne v MVP) |

---

## 2. Sitemap — struktura stránek

```
/                           → Landing page (Hero, Problem/Solution, Features, CTA)
/features                   → Detailní popis funkcí (Routing, CRM, Kalendář)
/pricing                    → Ceník + porovnání planů
/blog                       → Blog / Akademie (Astro Content Collections)
/blog/[slug]                → Jednotlivý blogpost
/contact                    → Kontaktní formulář + FAQ
/legal/privacy              → Ochrana osobních údajů (GDPR)
/legal/terms                → Obchodní podmínky / Terms of Service
/legal/cookies              → Cookie policy (i když nepoužíváme cookies, je dobré to uvést)
```

Všechny stránky existují ve všech 3 jazykových verzích:
```
/en/...                     → English (default, zobrazí se i pro /)
/cs/...                     → Čeština
/sk/...                     → Slovenština
```

Root `/` — minimalistický JS redirect podle `navigator.language` na `/en/`, `/cs/` nebo `/sk/`.
Při vypnutém JS je default `/en/` (angličtina).

---

## 3. Technologický stack

### 3.1 Frontend: Astro + React Islands

**Astro** generuje statické HTML při buildu (SSG). JavaScript se do prohlížeče posílá
pouze pro interaktivní "ostrovy" (formuláře). Výsledek: téměř nulový JS bundle pro
většinu stránek → Lighthouse 100/100.

| Komponenta | Typ | Hydratace |
|-----------|-----|-----------|
| Hero | `.astro` | Žádná (čisté HTML) |
| Features | `.astro` | Žádná |
| Pricing | `.astro` | Žádná |
| Blog post | `.astro` + Content Collections | Žádná |
| Navigace | `.astro` | Žádná (hamburger menu přes CSS `:target` / details) |
| Language switcher | `.astro` | Žádná (vygenerované linky) |
| ContactForm | React `.tsx` | `client:visible` — pouze na stránce Contact |
| NewsletterForm | React `.tsx` | `client:visible` — **výrazně** na stránce Contact, **méně výrazně** v patičce na všech stránkách |

### 3.2 Styling: CSS Modules + Astro Scoped CSS + Design Tokens

Stejný přístup jako hlavní aplikace (`apps/web`) — žádný utility-first framework.

**Dva mechanismy stylování:**

| Kontext | Technologie | Scope |
|---------|-------------|-------|
| Astro komponenty (`.astro`) | **Astro Scoped CSS** (`<style>` blok) | Automaticky scoped na komponentu |
| React islands (`.tsx`) | **CSS Modules** (`.module.css`) | Scope přes generované class names |
| Globální reset, tokeny | **Globální CSS** (`global.css`) | Import v `Layout.astro` |

**Astro Scoped CSS** — styl se píše přímo v `.astro` souboru:
```astro
<section class="hero">
  <h1>Ariadline</h1>
</section>

<style>
  .hero {
    padding: 5rem 0;
    background: var(--color-bg);
  }
  .hero h1 {
    font-family: var(--font-heading);
    font-size: 3rem;
    font-weight: 800;
    color: var(--color-text);
  }
</style>
```

**CSS Modules** — pro React ostrovy:
```tsx
// ContactForm.tsx
import styles from './ContactForm.module.css';
export default function ContactForm() {
  return <form className={styles.form}>...</form>;
}
```

**Design tokeny** — sdílené CSS custom properties vycházejí z aktuálního designu
aplikace (`apps/web/src/index.css`):

```css
/* packages/design-tokens/variables.css */
:root {
  /* Primární barva — Science Blue (stávající) */
  --color-primary: #2563eb;
  --color-primary-dark: #1d4ed8;

  /* Akcentní barva — Zlatá Ariadline (#D97706, amber-700) */
  /* Použití: logo, trasa na mapě ("Ariadnina nit"), akcenty mimo science blue */
  --color-accent: #D97706;
  --color-accent-light: #F59E0B;   /* Světlejší varianta pro hover/subtle akcenty */

  /* Neutrální */
  --color-secondary: #64748b;
  --color-bg: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-border: #e2e8f0;
  --color-text: #1e293b;
  --color-text-secondary: #64748b;

  /* Sémantické */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;

  /* Zaoblení */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Fonty */
  --font-body: 'Inter Variable', system-ui, sans-serif;
  --font-heading: 'Montserrat Variable', system-ui, sans-serif;
}
```

**Barevné schéma — dvě osy:**
- **Science Blue** (`#2563eb`) — primární barva. Důvěryhodnost, profesionalita, UI prvky (navigace, linky, formuláře).
- **Zlatá** (`#D97706`) — akcentní barva. Logo, trasa na mapě ("Ariadnina zlatá nit"),
  CTA tlačítka, zvýraznění, hover stavy. Kontrastní poměr 3:1 na bílém mapovém podkladu.
  Uživatel si může v nastavení aplikace zvolit jinou barvu trasy pro vyšší kontrast.

Tokeny budou v sdíleném balíčku (`packages/design-tokens/`). Astro scoped CSS i CSS Modules
přistupují k tokenům přes `var(--color-primary)`, `var(--color-accent)` atd.
Jak generovat `variables.css` z `tokens.json` — viz otevřené otázky (sekce 11).

**Logo**: Logotyp Ariadline ve **zlaté barvě** (kruh s A + map piny). Uložen v `assets/`.

### 3.3 Lokalizace (i18n)

Astro má vestavěnou i18n podporu (od v4+):

- **Routing**: Path prefixes (`/en/`, `/cs/`, `/sk/`)
- **Default locale**: `en` (s `prefixDefaultLocale: true` — každý jazyk má explicitní prefix)
- **Překlady**: JSON soubory v `src/i18n/` (klíče → přeložené texty)
- **Content Collections**: blogposty v `src/content/blog/en/`, `src/content/blog/cs/`, `src/content/blog/sk/`
- **Language switcher**: Astro helper `getRelativeLocaleUrl()` generuje linky na stejnou stránku v jiném jazyce
- **Auto-detekce jazyka na root `/`**: Minimalistický JS redirect podle `navigator.language`;
  při vypnutém JS fallback na `/en/`.

### 3.4 Analytics: Umami Cloud

**Rozhodnutí**: **Umami** s backendem **Umami Cloud** (hosted).

| Vlastnost | Detail |
|-----------|--------|
| Skript | ~2 KB gzipped (vs. 45 KB+ u Google Analytics) |
| Cookies | **Žádné** (hash z IP + User-Agent) → **nepotřebujeme cookie banner** |
| GDPR | Plně compliant bez cookie consent |
| Načítání | `defer` — nestahuje se ani neparsuje, dokud není hotové HTML |
| Dopad na LCP | Nulový — neblokuje vykreslování |
| Licence | MIT |
| Backend | **Umami Cloud** (hosted, zero-maintenance). Později volitelná migrace na self-hosted. |

**Integrace v `Layout.astro`:**
URL skriptu a `data-website-id` získáme z Umami Cloud dashboardu (např. `https://eu.umami.is/script.js` nebo podle regionu):
```html
<script
  defer
  src="https://[region].umami.is/script.js"
  data-website-id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
></script>
```

Skript se vloží do `<head>` v Layout.astro. Atribut `defer` zajistí, že prohlížeč
skript stáhne paralelně, ale spustí ho až po zparsování celého HTML.

> **Pozn.**: Partytown (přesunutí do Web Workeru) není nutné — 2 KB `defer` skript
> nemá měřitelný dopad na výkon. Zbytečná komplexita.

### 3.5 SEO & Meta

Každá stránka bude mít:
- `<title>` a `<meta name="description">` — lokalizované
- Open Graph tagy: `og:title`, `og:description`, `og:image`, `og:locale`
- Twitter Card tagy: `twitter:card`, `twitter:title`, `twitter:image`
- Canonical URL (self-referencing)
- `hreflang` tagy pro všechny jazykové verze
- Structured data (JSON-LD): Organization, Product, BlogPosting
- `robots.txt` + `sitemap.xml` (Astro generuje automaticky)

### 3.6 Fonty

**Kombinace: Montserrat (nadpisy) + Inter (body)**

| Účel | Font | Proč |
|------|------|------|
| Nadpisy (h1–h6) | **Montserrat Variable** (Bold/ExtraBold) | Geometrický, široký — "dvojče" fontu v logu. Autoritativní v nadpisech. |
| Body text | **Inter Variable** | Zlatý standard pro UI a čitelnost na obrazovkách. Navržen pro počítačová rozhraní. |

**Implementace pro maximální rychlost:**

- Instalace přes **Fontsource** (`@fontsource-variable/montserrat`, `@fontsource-variable/inter`)
  — Variable verze = jeden soubor pro všechny tloušťky, šetří data
- Import v `Layout.astro` (bundluje se lokálně, žádný DNS lookup na Google Fonts)
- `font-display: swap` (text viditelný okamžitě, font se swapne po načtení)
- `<link rel="preload">` pro Inter (primární font) v `<head>`
- Definice v design tokenech: `--font-body` a `--font-heading` (viz sekce 3.2)

**Použití v Astro Scoped CSS:**
```astro
<h1>Ariadline: Untangle your workday.</h1>
<p>Plánování tras pro řemeslníky.</p>

<style>
  h1 {
    font-family: var(--font-heading);
    font-size: 3rem;
    font-weight: 800;
  }
  p {
    font-family: var(--font-body);
    font-size: 1.125rem;
  }
</style>
```

### 3.7 Obrázky

- Formáty: **WebP** / **AVIF** s PNG/JPEG fallback (`<picture>` + `srcset`)
- Astro `<Image>` komponenta s Sharp pro build-time optimalizaci
- Hero screenshot: preloaded (`<link rel="preload" as="image">`)
- Below-the-fold: `loading="lazy"`, `decoding="async"`
- Všechny obrázky mají explicitní `width`/`height` (prevence CLS)

---

## 4. Backend pro formuláře — Cloudflare Pages Functions

### 4.1 Proč Pages Functions

| Výhoda | Detail |
|--------|--------|
| **Doména** | Site API běží na stejné doméně (`ariadline.com/api/...`) — **žádné CORS**. Hlavní app API zůstává na `api.ariadline.com`. |
| **Jednoduchost** | Functions v `apps/site/functions/`, deploy společně s webem |
| **Izolace** | Oddělené od hlavní aplikace (`api.ariadline.com`). Minimální attack surface. |
| **Škálování** | Automatické na edge (0 → nekonečno). |
| **Náklady** | Free tier Pages pokryje realistický traffic. |
| **Tooling** | Lokální vývoj přes `wrangler pages dev`. |

### 4.2 API endpointy

Soubory v `apps/site/functions/api/`:

| Soubor | Endpoint | Popis |
|--------|----------|-------|
| `contact.ts` | `POST /api/contact` | Kontaktní formulář |
| `newsletter.ts` | `POST /api/newsletter` | Odběr novinek |

**Request/Response schemas (validace přes Zod):**

```
POST /api/contact
  Request:  {
    email: string,
    message: string,
    source?: string,
    locale?: string,
    website?: string   // Honeypot — skryté pole, musí zůstat prázdné
  }
  Response: { "success": true, "ticketId": "REQ-2026-000123" }

POST /api/newsletter
  Request:  {
    email: string,
    locale?: string,
    gdprConsent: boolean,
    website?: string   // Honeypot — skryté pole, musí zůstat prázdné
  }
  Response: { "success": true, "pendingConfirmation": true }
```

**Honeypot anti-spam:**
- Pole `website` — skryté CSS (`position: absolute; left: -9999px`), label např. "Nevyplňujte"
- Pokud je `website` vyplněno → request se ignoruje, vrátí `{ "success": true }` (fake success, aby bot nedostal zpětnou vazbu)
- Validace na serveru: `website` musí být prázdný string nebo undefined
- Cloudflare Turnstile (`cf-turnstile-response`) — server-side ověření tokenu ve Function
- Rate limiting na endpoint úrovni (Cloudflare)

**Databáze: Cloudflare D1 (managed SQLite)**
- Ukládání kontaktních zpráv (pro `ticketId` a historii)
- Ukládání e-mailů z newsletteru
- D1 je přístupná z Pages Functions přes `env.DB`
- **Source of truth** pro newsletter i kontakty je D1
- `ticketId` formát: čitelný `REQ-YYYY-NNNNNN`

**Newsletter: Double opt-in flow**
1. `POST /api/newsletter` uloží záznam do D1 se stavem `pending`
2. Odeslání potvrzovacího e-mailu přes Resend (unikátní confirm token / link)
3. `GET /api/newsletter/confirm?token=...` přepne stav na `confirmed`
4. Teprve `confirmed` kontakty se považují za aktivní odběratele

### 4.3 E-mail: Resend

**Rozhodnutí**: **Resend** jako e-mailová služba pro celý projekt (site i aplikace).

| Vlastnost | Detail |
|-----------|--------|
| API | REST + TypeScript SDK (`resend` npm balíček) |
| Šablony | **React Email** — e-maily jako React komponenty (žádné `<table>` peklo) |
| Free tier | 3 000 e-mailů/měsíc, 1 doména |
| Doručitelnost | Vysoká (dedikované IP na vyšších plánech) |
| Integrace | Pages Functions (site) + Rust worker (aplikace, přes REST API) |

**Architektura:**
```
[Prohlížeč]  →  [Pages Function]  →  [Resend API] + [D1]
                     (API klíč zůstává na serveru)
```

E-maily se **nikdy neodesílají z prohlížeče** — API klíč zůstává na backendu.

**E-mailové šablony (React Email):**
```
apps/site/src/emails/           # Šablony pro marketing web
  ContactConfirmation.tsx       # Potvrzení kontaktního formuláře
  NewsletterWelcome.tsx         # Přivítání do newsletteru

packages/emails/                # Sdílené šablony (site + aplikace)
  WelcomeEmail.tsx              # Vítejte v Ariadline
  PasswordReset.tsx             # Reset hesla
  RevisionReminder.tsx          # Připomínka revize (aplikace)
```

**Příklad integrace (Pages Function):**
```typescript
// apps/site/functions/api/contact.ts
import { Resend } from 'resend';

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const resend = new Resend(env.RESEND_API_KEY);
  // ... Zod validace, honeypot check, D1 insert ...
  await resend.emails.send({
    from: 'Ariadline <info@ariadline.com>',
    to: ['admin@ariadline.com'],
    subject: 'Nový dotaz z webu',
    text: message,
  });
}
```

**Integrace do Rust workeru (aplikace):**
Resend má REST API — volání přes `reqwest` HTTP klient, žádné SDK nutné:
```
POST https://api.resend.com/emails
Authorization: Bearer re_xxxxx
Content-Type: application/json
```

**DNS záznamy (nutné před spuštěním):**

| Typ | Název | Účel |
|-----|-------|------|
| TXT | `_dkim.ariadline.com` | DKIM — podpis autenticity e-mailu |
| TXT | `ariadline.com` | SPF — autorizace Resend IP adres pro odesílání |
| TXT | `_dmarc.ariadline.com` | DMARC — politika pro podvržené e-maily |

Všechny tři záznamy nastaví Resend dashboard automaticky (stačí kliknout "Verify domain").

---

## 5. Struktura projektu v monorepu

```
/ariadline (root)
├── apps/
│   ├── web/                    # Hlavní SPA aplikace (React/Vite) — beze změn
│   └── site/                   # Marketing web (Astro) — NOVÝ
│       ├── public/
│       │   ├── fonts/          # Fontsource handles this (Inter + Montserrat variable)
│       │   ├── images/         # Statické obrázky (logo, screenshoty)
│       │   ├── favicon.svg
│       │   └── robots.txt
│       ├── functions/
│       │   └── api/
│       │       ├── contact.ts     # POST /api/contact
│       │       └── newsletter.ts  # POST /api/newsletter
│       │       └── newsletter-confirm.ts  # GET /api/newsletter/confirm?token=...
│       ├── src/
│       │   ├── components/
│       │   │   ├── layout/     # Header, Footer, Navigation
│       │   │   ├── sections/   # Hero, Features, Pricing, FAQ (statické .astro)
│       │   │   └── react/      # Interaktivní ostrovy (ContactForm, Newsletter)
│       │   ├── content/
│       │   │   └── blog/
│       │   │       ├── en/     # Anglické blogposty (.md)
│       │   │       ├── cs/     # České blogposty (.md)
│       │   │       └── sk/     # Slovenské blogposty (.md)
│       │   ├── i18n/
│       │   │   ├── en.json     # Překlady UI textů
│       │   │   ├── cs.json
│       │   │   └── sk.json
│       │   ├── layouts/
│       │   │   └── Layout.astro
│       │   ├── pages/
│       │   │   ├── en/         # Anglické stránky
│       │   │   ├── cs/         # České stránky
│       │   │   ├── sk/         # Slovenské stránky
│       │   │   └── index.astro # Root redirect (Accept-Language)
│       │   └── styles/
│       │       └── global.css  # Reset, design token import, globální typografie
│       ├── astro.config.mjs
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── shared-types/           # Existující sdílené TypeScript typy
│   ├── design-tokens/          # NOVÝ — sdílené barvy, radii, shadows
│   │   ├── tokens.json         # Kanonická definice
│   │   └── variables.css       # CSS custom properties (generováno z tokens.json)
│   └── emails/                 # NOVÝ — sdílené React Email šablony
│       ├── WelcomeEmail.tsx
│       ├── PasswordReset.tsx
│       ├── RevisionReminder.tsx
│       └── package.json
├── worker/                     # Rust backend — beze změn
├── pnpm-workspace.yaml         # Přidat apps/site, packages/*
└── turbo.json                  # Přidat build pipeline pro site
```

---

## 6. Plán implementace

### Fáze 1: Základ (MVP)

**Cíl**: Funkční marketing web nasazený na Cloudflare Pages ve 3 jazycích.

| # | Úkol | Odhad |
|---|------|-------|
| 1.1 | Inicializace Astro projektu v `apps/site` | 1h |
| 1.2 | Konfigurace: React integration, i18n routing, global CSS | 2h |
| 1.3 | Design tokeny: extrakce do `packages/design-tokens` + barevná paleta dle loga | 3h |
| 1.4 | Layout.astro: SEO meta, OG tagy, fonty, analytics | 3h |
| 1.5 | Landing page: Hero + Problem/Solution + Features overview + CTA | 6h |
| 1.6 | Features page: detailní popis funkcí | 4h |
| 1.7 | Pricing page: tabulka plánů | 3h |
| 1.8 | Contact page: formulář (výrazný) + NewsletterForm (výrazný) + FAQ | 3h |
| 1.9 | Legal pages: Privacy, Terms, Cookies | 3h |
| 1.10 | Blog: Content Collections setup + 1 testovací článek | 3h |
| 1.11 | i18n: překlady všech UI textů (en, cs, sk) | 4h |
| 1.12 | Language switcher + minimalistický JS redirect (`navigator.language`, fallback `/en/`) | 2h |
| 1.13 | Header/Footer (navigace, logo, NewsletterForm méně výrazně, social links) | 3h |
| 1.14 | Responsive design (mobile-first) | 4h |
| **Subtotal Fáze 1** | | **~44h** |

### Fáze 2: Backend & Formuláře

| # | Úkol | Odhad |
|---|------|-------|
| 2.1 | **Spike:** Resend SDK v Pages Functions (fallback REST pokud selže) | 1h |
| 2.2 | Pages Functions + D1 setup (migrace, binding) | 2h |
| 2.3 | `POST /api/contact` endpoint (Zod, honeypot, Turnstile, D1, Resend, čitelný ticketId) | 3h |
| 2.4 | `POST /api/newsletter` endpoint (double opt-in: pending + email with token) | 2h |
| 2.5 | `GET /api/newsletter/confirm` endpoint (token validation, state=confirmed) | 2h |
| 2.6 | Napojení React formulářů na `/api/contact` a `/api/newsletter` | 2h |
| **Subtotal Fáze 2** | | **~12h** |

### Fáze 3: Deployment & Polish

| # | Úkol | Odhad |
|---|------|-------|
| 3.1 | Cloudflare Pages setup + custom doména | 2h |
| 3.2 | CI/CD: GitHub Actions pro automatický deploy | 2h |
| 3.3 | Analytics setup (Umami Cloud) | 2h |
| 3.4 | Lighthouse audit + optimalizace (target: 100/100) | 3h |
| 3.5 | Hero screenshoty aplikace (WebP/AVIF, responsive) | 3h |
| 3.6 | Favicon + apple-touch-icon + web manifest | 1h |
| 3.7 | 404 stránka (lokalizovaná) | 1h |
| **Subtotal Fáze 3** | | **~14h** |

### Fáze 4: Rozšíření (post-MVP)

| # | Úkol | Odhad |
|---|------|-------|
| 4.1 | ROI kalkulačka (React island, `client:visible`) | 6h |
| 4.2 | Další blogové články (SEO strategie) | ongoing |
| 4.3 | A/B testing CTA variant | 4h |
| 4.4 | Video / animované demo aplikace | 8h |
| 4.5 | Zákaznické reference / case studies | 4h |

---

## 7. Performance cíle

| Metrika | Cíl |
|---------|-----|
| Lighthouse Performance | 100 |
| Lighthouse Accessibility | 100 |
| Lighthouse Best Practices | 100 |
| Lighthouse SEO | 100 |
| First Contentful Paint (FCP) | < 0.8s |
| Largest Contentful Paint (LCP) | < 1.5s |
| Cumulative Layout Shift (CLS) | < 0.05 |
| Total Blocking Time (TBT) | < 50ms |
| JS bundle (landing page) | < 5 KB (pouze analytics script) |
| HTML size (landing page, gzipped) | < 30 KB |

---

## 8. Konvence

### Soubory a pojmenování
- Astro komponenty: `PascalCase.astro` (styly v `<style>` bloku — automaticky scoped)
- React islands: `PascalCase.tsx` + `PascalCase.module.css` v `src/components/react/`
- Stránky: `kebab-case.astro` v `src/pages/{locale}/`
- Blog content: `YYYY-MM-DD-slug.md` v `src/content/blog/{locale}/`
- Překlady: `{locale}.json` v `src/i18n/`
- CSS class names: `camelCase` v CSS Modules (konzistentní s `apps/web`)

### Git
- Feature branches: `site/feature-name`
- Commit prefix: `site:` pro změny v `apps/site`

### Kvalita
- TypeScript strict mode pro React islands
- Astro `--check` v CI
- Prettier + ESLint
- Lighthouse CI v GitHub Actions (fail pod 95)

---

## 9. Závislosti (package.json)

**`apps/site/package.json`** (Astro marketing web):
```json
{
  "name": "@ariadline/site",
  "dependencies": {
    "astro": "^5.x",
    "@astrojs/react": "^4.x",
    "@astrojs/sitemap": "^3.x",
    "@fontsource-variable/inter": "^5.x",
    "@fontsource-variable/montserrat": "^5.x",
    "resend": "^4.x",
    "@react-email/components": "^0.x",
    "zod": "^3.x",
    "react": "^19.x",
    "react-dom": "^19.x"
  },
  "devDependencies": {
    "sharp": "^0.33.x",
    "typescript": "^5.x"
  }
}
```

> Poznámka: Přesné verze se určí při inicializaci projektů. React Email
> šablony sdílené s aplikací budou v `packages/emails/`.

---

## 10. Rozhodnuto

- [x] Akcentní barva — **#D97706** (zlatá, amber-700). Logo, trasa na mapě ("Ariadnina nit"), non-blue akcenty. Barva trasy uživatelsky nastavitelná.
- [x] Font — **Montserrat Variable** (nadpisy) + **Inter Variable** (body). Via Fontsource.
- [x] Backend formulářů — **Cloudflare Pages Functions**. API na `ariadline.com/api/...`, žádné CORS.
- [x] Validace — **Zod**. Sdílené schéma pro runtime validaci na klientovi i serveru.
- [x] I18n v Reactu — **Props drilling**. Překlady se načtou v `.astro` a předají React komponentám jako props.
- [x] Analytics — **Umami Cloud** (hosted). Později volitelná migrace na self-hosted.
- [x] Email služba — **Resend**. Pro site (Pages Functions, TS SDK) i aplikaci (Rust worker, REST API).
- [x] Cookie consent banner — **nepotřebujeme**. Umami nepoužívá cookies.
- [x] Ukládání dat — **Cloudflare D1** (managed SQLite) pro kontakty a newsletter.
- [x] Jazyky na root `/` — Minimalistický JS redirect podle `navigator.language`; fallback bez JS je `/en/`.
- [x] NewsletterForm — **Výrazně** na Contact, **méně výrazně** v patičce.
- [x] Honeypot — Pole `website`, skryté CSS, prázdné = validní request.
- [x] Newsletter — **Double opt-in**.
- [x] Source of truth — **D1**.
- [x] Ticket ID — čitelný formát `REQ-YYYY-NNNNNN`.
- [x] Anti-spam — **Cloudflare Turnstile** + honeypot + rate limiting.
- [x] Resend SDK v Pages — řešit přes **spike** (Fáze 2.1).

## 11. Otevřené otázky

- [ ] **Design tokeny** — Jak generovat `variables.css` z `tokens.json`? Build skript v `packages/design-tokens`, nebo ruční údržba?
- [ ] **Astro Content Collections** — Přesná struktura blogu: jedna kolekce s `locale` v frontmatter, nebo oddělené složky `blog/en/`, `blog/cs/`, `blog/sk/`? Jak napojit na i18n routing?
- [ ] **Resend SDK v Pages Functions** — Výsledek spike (Fáze 2.1): potvrdit SDK nebo přepnout na čisté REST volání.
- [ ] **D1 retention policy** — Jak dlouho držet kontaktní záznamy, pending newsletter tokeny a auditní logy (GDPR)?

## 12. Definition of Done (DoD)

### 12.1 MVP DoD (site + forms)
- [ ] Root `/` používá minimalistický JS redirect podle `navigator.language` (`en/cs/sk`)
- [ ] Při vypnutém JS je výchozí jazyk `/en/`
- [ ] Stránky `/en`, `/cs`, `/sk` existují pro Landing, Features, Pricing, Contact, Legal, Blog
- [ ] `ContactForm` je funkční na `/contact`, ukládá data do D1 a vrací čitelný `ticketId` formátu `REQ-YYYY-NNNNNN`
- [ ] `NewsletterForm` je výrazně na Contact a méně výrazně v patičce všech stránek
- [ ] Newsletter flow je double opt-in (`pending` → `confirmed`) přes potvrzovací link
- [ ] Source of truth pro kontakty i newsletter je D1
- [ ] Anti-spam aktivní: honeypot `website` + Cloudflare Turnstile + rate limiting
- [ ] Umami Cloud je zapojen přes script URL z dashboardu (`defer`)
- [ ] Resend e-maily fungují pro contact notifikaci i newsletter confirmation
- [ ] Právní stránky (Privacy/Terms/Cookies) jsou publikované

### 12.2 Technical DoD
- [ ] `astro check`, TypeScript a lint prochází bez chyb
- [ ] Lighthouse skóre >= 95 ve všech kategoriích (prod build)
- [ ] D1 migrace jsou verzované a reproducibilní
- [ ] Secrets (`RESEND_API_KEY`, Turnstile secret, Umami site id) jsou jen v prostředí, nikde v client kódu
- [ ] Error monitoring/logging pro Functions zachytí chyby validace, D1 a Resend

### 12.3 Spike DoD — Resend SDK in Pages
- [ ] Implementován minimální spike endpoint v Pages Functions
- [ ] Ověřeno v preview/prod, že SDK korektně odešle e-mail
- [ ] Pokud spike neprojde, zdokumentován fallback na REST API a přepnuto v implementačním plánu
