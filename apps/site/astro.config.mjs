import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ariadline.com',
  output: 'static',
  integrations: [
    react(),
    sitemap(),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'cs', 'sk'],
    routing: {
      prefixDefaultLocale: true,
    },
  },
});
