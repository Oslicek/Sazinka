import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

// Custom language detector that reads from Zustand authStore
const zustandDetector = {
  name: 'zustand',
  lookup() {
    // Import dynamically to avoid circular dependencies
    try {
      const { useAuthStore } = require('../stores/authStore');
      const user = useAuthStore.getState().user;
      return user?.locale;
    } catch {
      return undefined;
    }
  },
  cacheUserLanguage() {
    // No-op: locale is persisted in DB via authStore
  },
};

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'en-GB', 'en-US', 'cs'],
    nonExplicitSupportedLngs: true,
    // Do not set lng - let detector chain determine it
    
    detection: {
      order: ['zustand', 'navigator'],
      caches: [], // Don't cache in localStorage/cookie - use DB
    },

    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    ns: ['common'],
    defaultNS: 'common',

    interpolation: {
      escapeValue: false, // React already escapes
    },

    react: {
      useSuspense: true,
    },
  });

// Register custom detector
const languageDetector = i18n.services.languageDetector as LanguageDetector;
if (languageDetector) {
  languageDetector.addDetector(zustandDetector);
}

// Update document.documentElement.lang when language changes
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;
