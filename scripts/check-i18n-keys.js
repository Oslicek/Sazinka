#!/usr/bin/env node

/**
 * i18n Key Parity Check
 *
 * Compares translation key sets across all locale folders.
 * Exits with code 0 if all locales have identical keys, 1 otherwise.
 *
 * Usage: node scripts/check-i18n-keys.js
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../apps/web/public/locales');

// i18next plural suffixes that vary by language
// English: _one, _other
// Czech: _one, _few, _other
// These are language-specific and should not cause parity failures.
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

/**
 * Strip plural suffix from a key to get the base key.
 * e.g. "duration.minutes_few" → "duration.minutes"
 */
function stripPluralSuffix(key) {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) {
      return key.slice(0, -suffix.length);
    }
  }
  return key;
}

/**
 * Recursively extract all keys from a nested JSON object.
 * Returns a sorted array of dot-separated key paths.
 */
function extractKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...extractKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

/**
 * Extract base keys (with plural suffixes stripped) for parity comparison.
 * Returns a sorted, deduplicated array.
 */
function extractBaseKeys(obj, prefix = '') {
  const keys = extractKeys(obj, prefix);
  const baseKeys = [...new Set(keys.map(stripPluralSuffix))];
  return baseKeys.sort();
}

function main() {
  // Discover locale directories
  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`❌ Locales directory not found: ${LOCALES_DIR}`);
    process.exit(1);
  }

  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (locales.length < 2) {
    console.error(`❌ Need at least 2 locale directories, found: ${locales.join(', ')}`);
    process.exit(1);
  }

  console.log(`Checking locales: ${locales.join(', ')}`);

  // Discover namespace files from the first locale
  const referenceLocale = locales[0];
  const referenceDir = path.join(LOCALES_DIR, referenceLocale);
  const namespaceFiles = fs
    .readdirSync(referenceDir)
    .filter((f) => f.endsWith('.json'));

  if (namespaceFiles.length === 0) {
    console.error(`❌ No JSON files found in ${referenceDir}`);
    process.exit(1);
  }

  let hasErrors = false;

  for (const nsFile of namespaceFiles) {
    const ns = nsFile.replace('.json', '');
    console.log(`\n📦 Namespace: ${ns}`);

    // Load reference keys (base keys for parity, raw keys for reporting)
    const refPath = path.join(LOCALES_DIR, referenceLocale, nsFile);
    const refData = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
    const refBaseKeys = extractBaseKeys(refData);
    const refRawKeys = extractKeys(refData);

    for (const locale of locales) {
      if (locale === referenceLocale) continue;

      const localePath = path.join(LOCALES_DIR, locale, nsFile);

      // Check file exists
      if (!fs.existsSync(localePath)) {
        console.error(`  ❌ ${locale}/${nsFile} — file missing`);
        hasErrors = true;
        continue;
      }

      const localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
      const localeBaseKeys = extractBaseKeys(localeData);
      const localeRawKeys = extractKeys(localeData);

      // Compare base keys (plural-suffix-agnostic)
      const missingInLocale = refBaseKeys.filter((k) => !localeBaseKeys.includes(k));
      const extraInLocale = localeBaseKeys.filter((k) => !refBaseKeys.includes(k));

      if (missingInLocale.length === 0 && extraInLocale.length === 0) {
        console.log(`  ✅ ${locale}/${nsFile} — ${localeRawKeys.length} keys (${localeBaseKeys.length} base keys match)`);
      } else {
        hasErrors = true;
        if (missingInLocale.length > 0) {
          console.error(`  ❌ ${locale}/${nsFile} — missing ${missingInLocale.length} base keys:`);
          missingInLocale.forEach((k) => console.error(`     - ${k}`));
        }
        if (extraInLocale.length > 0) {
          console.error(`  ⚠️  ${locale}/${nsFile} — extra ${extraInLocale.length} base keys:`);
          extraInLocale.forEach((k) => console.error(`     + ${k}`));
        }
      }
    }
  }

  // Also check if other locales have files not in reference
  for (const locale of locales) {
    if (locale === referenceLocale) continue;
    const localeDir = path.join(LOCALES_DIR, locale);
    const localeFiles = fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'));
    const extraFiles = localeFiles.filter((f) => !namespaceFiles.includes(f));
    if (extraFiles.length > 0) {
      console.error(`\n  ⚠️  ${locale}/ has extra files not in ${referenceLocale}/: ${extraFiles.join(', ')}`);
      hasErrors = true;
    }
  }

  console.log('');
  if (hasErrors) {
    console.error('❌ Key parity check FAILED');
    process.exit(1);
  } else {
    console.log('✅ Key parity check PASSED');
    process.exit(0);
  }
}

main();
