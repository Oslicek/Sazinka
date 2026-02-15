# PRJ_DATA — Data Excise (GDPR Complete Data Deletion)

## Stav: IMPLEMENTOVÁNO

Tento dokument popisuje implementaci funkce **Data Excise** — trvalého a nevratného smazání veškerých dat uživatelského účtu. Funkce je vyžadována evropským nařízením GDPR (Článek 17 — Právo na výmaz) a dalšími předpisy o ochraně osobních údajů.

---

## 1. Motivace

Vlastník účtu (role `customer`) musí mít možnost trvale odstranit veškerá svá data ze systému. Jedná se o tzv. **data excise** (česky **vyříznutí dat**) — kompletní a nevratné odstranění všech záznamů bez možnosti obnovení, a to ani ze strany technické podpory Ariadline.

### Právní rámec

- **GDPR čl. 17** — Právo na výmaz ("právo být zapomenut")
- **GDPR čl. 20** — Právo na přenositelnost údajů (export před smazáním)
- Uživatel musí být před smazáním informován o nevratnosti operace
- Systém nesmí uchovávat kopie smazaných dat (žádný soft delete, žádný koš)

---

## 2. Umístění v UI

### Settings → Import/export → Danger Zone (spodní část)

Na konci záložky Import/export se zobrazí výrazně oddělená sekce:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  DANGER ZONE — NEBEZPEČNÁ ZÓNA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🗑️ Data Excise — Vyříznutí dat

Trvale a nevratně smaže váš účet a veškerá související data.
Tuto akci nelze vrátit zpět. Ani podpora Ariadline nemůže
obnovit data odstraněná tímto způsobem.

        ┌──────────────────────────────┐
        │  🗑️ Smazat všechna moje data │  ← velké červené tlačítko
        └──────────────────────────────┘
```

**Viditelnost:** Pouze pro vlastníka účtu (`role === 'customer'`, `owner_id === null`). Pracovníci (workers) tuto sekci nevidí.

---

## 3. UX Flow — Tři kroky

### Krok 1: Kliknutí na červené tlačítko

Otevře se první dialog.

### Krok 2: Dialog 1 — Export a varování

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  DATA EXCISE — Vyříznutí dat                        │
│                                                         │
│  Tato operace TRVALE A NEVRATNĚ smaže:                  │
│                                                         │
│    • Všechny zákazníky a jejich kontaktní údaje          │
│    • Všechna zařízení a historii revizí                  │
│    • Všechny trasy, návštěvy a pracovní záznamy          │
│    • Všechny záznamy komunikace                          │
│    • Všechna nastavení, posádky, depa, e-mailové šablony │
│    • Váš uživatelský účet a všechny účty pracovníků      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ⛔ Tato akce je NEVRATNÁ.                       │    │
│  │ Data budou definitivně vyříznuta ze systému.     │    │
│  │ Ani podpora Ariadline nemůže obnovit data        │    │
│  │ odstraněná tímto způsobem.                       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Doporučujeme si před smazáním stáhnout kompletní       │
│  zálohu vašich dat:                                     │
│                                                         │
│  [ 📥 Stáhnout kompletní export dat ]                   │
│                                                         │
│  [ Zrušit ]              [ Pokračovat ke smazání → ]    │
└─────────────────────────────────────────────────────────┘
```

Tlačítko "Stáhnout" spustí full export (existující mechanismus ExportPlus, scope `all_workers_combined`, formát ZIP).

### Krok 3: Dialog 2 — Potvrzení PINem

```
┌─────────────────────────────────────────────────────────┐
│  ⛔  ZÁVĚREČNÉ POTVRZENÍ                                │
│                                                         │
│  Pro potvrzení vyříznutí dat zadejte tento kód:          │
│                                                         │
│              ┌───────────────────┐                       │
│              │     7  3  9  2    │  ← náhodný 4-ciferný  │
│              └───────────────────┘       PIN              │
│                                                         │
│  Zadejte kód: [ __________ ]                            │
│                                                         │
│  [ Zrušit ]          [ 🗑️ Definitivně smazat vše ]      │
│                      ↑ neaktivní dokud PIN nesouhlasí    │
└─────────────────────────────────────────────────────────┘
```

PIN je generován na klientu (4 náhodné cifry). Neslouží jako bezpečnostní mechanismus (autorizace je přes JWT), ale jako UX bariéra proti nechtěnému kliknutí.

---

## 4. Backend

### 4.1 NATS subject

```
sazinka.account.delete
```

### 4.2 Request/Response

**Request payload:**
```json
{
  "confirmation": true,
  "level": 1
}
```

- `level: 1` — smazat firemní data, zachovat uživatelský účet (start fresh)
- `level: 2` — smazat vše včetně uživatelského účtu (plný data excise)

**Success response:**
```json
{
  "deleted": true,
  "message": "settings:delete_data_success",
  "level": 1
}
```

### 4.3 Handler logika

1. Ověřit JWT — musí být `role = "customer"` a `owner_id IS NULL` (vlastník účtu)
2. Ověřit `level` (1 nebo 2) a `confirmation = true`
3. **Audit log** — zapsat do server logu: level, user ID, email, timestamp (před smazáním)
4. **Level 1** (`delete_company_data`):
   ```sql
   DELETE FROM users WHERE owner_id = $1;       -- worker účty
   DELETE FROM roles WHERE owner_id = $1;        -- role + oprávnění
   DELETE FROM routes WHERE user_id = $1;        -- trasy + zastávky
   DELETE FROM customers WHERE user_id = $1;     -- zákazníci + CASCADE
   DELETE FROM depots WHERE user_id = $1;        -- depa
   DELETE FROM crews WHERE user_id = $1;         -- posádky
   UPDATE users SET default_crew_id = NULL, default_depot_id = NULL, ... WHERE id = $1;
   ```
5. **Level 2** (`delete_user_account`):
   - Nejprve provede Level 1
   - Poté: `DELETE FROM users WHERE id = $1;`
6. Vrátit úspěch
7. Frontend:
   - Level 1: `window.location.reload()` (uživatel zůstane přihlášen)
   - Level 2: `logout()` → redirect na `/login`

### 4.4 CASCADE řetězce (existující FK)

Díky `ON DELETE CASCADE` definovanému ve schématu stačí smazat řádek z `users`:

```
users (DELETE)
  ├── customers (CASCADE)
  │     ├── devices (CASCADE)
  │     │     └── revisions (CASCADE)
  │     │           └── visit_work_items (via revision_id, SET NULL)
  │     ├── revisions (via customer_id, CASCADE)
  │     ├── visits (via customer_id, CASCADE)
  │     │     └── visit_work_items (CASCADE)
  │     ├── communications (CASCADE)
  │     └── route_stops (CASCADE)
  ├── devices (via user_id, CASCADE)
  ├── revisions (via user_id, CASCADE)
  ├── visits (via user_id, CASCADE)
  ├── communications (via user_id, CASCADE)
  ├── routes (CASCADE)
  │     └── route_stops (CASCADE)
  ├── depots (CASCADE)
  ├── crews (CASCADE)
  ├── roles (via owner_id, CASCADE)
  │     ├── role_permissions (CASCADE)
  │     └── user_roles (CASCADE)
  └── users (workers via owner_id, CASCADE)
```

### 4.5 Bezpečnost

- **Pouze vlastník:** Handler odmítne request od workerů a adminů
- **Audit trail:** `warn!()` log s emailem a timestampem před DELETE
- **Rate limiting:** Max 1 pokus za 60 sekund
- **Hard delete:** Žádný soft delete, žádný koš, žádné tombstony — plný soulad s GDPR čl. 17
- **JetStream cleanup:** Po smazání uživatele by měly být vyčištěny i případné pending joby v NATS JetStream (import, export, geocoding)

---

## 5. Soubory k vytvoření / úpravě

### Nové soubory

| Soubor | Popis |
|--------|-------|
| `apps/web/src/components/settings/DeleteAccountDialog.tsx` | Dvou-krokový modální dialog |
| `apps/web/src/components/settings/DeleteAccountDialog.module.css` | Danger-zone styling (červená, výstražná) |

### Úpravy existujících souborů

| Soubor | Změna |
|--------|-------|
| `apps/web/src/pages/Settings.tsx` | Přidat Danger Zone sekci na konec `import-export` záložky |
| `apps/web/src/pages/Settings.module.css` | Přidat styly pro danger zone |
| `apps/web/src/services/settingsService.ts` | Přidat `deleteAccount()` funkci |
| `apps/web/public/locales/en/settings.json` | Přidat ~20 nových klíčů |
| `apps/web/public/locales/cs/settings.json` | Přidat ~20 nových klíčů |
| `apps/web/public/locales/sk/settings.json` | Přidat ~20 nových klíčů |
| `worker/src/handlers/settings.rs` | Přidat `handle_delete_account` handler |
| `worker/src/db/queries/settings.rs` | Přidat `delete_user_account` query |
| `worker/src/main.rs` | Registrovat nový NATS subscription |

---

## 6. Překladové klíče

### Namespace: `settings`

| Klíč | EN | CS | SK |
|------|----|----|-----|
| `danger_zone` | Danger Zone | Nebezpečná zóna | Nebezpečná zóna |
| **Level 1 — Data only** | | | |
| `delete_data_title` | Delete Company Data | Smazat firemní data | Vymazať firemné dáta |
| `delete_data_desc` | Delete all customers, devices, ... Your user account will be preserved. | Smaže všechny zákazníky, ... Váš účet zůstane zachován. | Vymaže všetkých zákazníkov, ... Váš účet zostane zachovaný. |
| `delete_data_button` | Delete all data | Smazat všechna data | Vymazať všetky dáta |
| `delete_data_dialog_title` | Delete Company Data | Smazání firemních dat | Vymazanie firemných dát |
| `delete_data_dialog_warning` | This operation will PERMANENTLY delete all your company data: | Tato operace TRVALE smaže veškerá vaše firemní data: | Táto operácia TRVALO vymaže všetky vaše firemné dáta: |
| `delete_data_dialog_irreversible` | ... Your user account and login credentials will be preserved. | ... Váš účet a přihlašovací údaje zůstanou zachovány. | ... Váš účet a prihlasovacie údaje zostanú zachované. |
| `delete_data_confirm_button` | Permanently delete all data | Definitivně smazat všechna data | Definitívne vymazať všetky dáta |
| `delete_data_success` | All company data has been permanently deleted. Your account is preserved. | Veškerá firemní data byla trvale smazána. Váš účet je zachován. | Všetky firemné dáta boli trvalo vymazané. Váš účet je zachovaný. |
| **Level 2 — Data + Account** | | | |
| `delete_all_title` | Data Excise — Delete Account | Vyříznutí dat — Smazání účtu | Vyrezanie dát — Vymazanie účtu |
| `delete_all_desc` | Permanently and irreversibly delete your account and all associated data. | Trvale a nevratně smaže váš účet a veškerá související data. | Trvalo a nenávratne vymaže váš účet a všetky súvisiace dáta. |
| `delete_all_button` | Delete account and all data | Smazat účet a všechna data | Vymazať účet a všetky dáta |
| `delete_dialog_title` | Data Excise — Delete Account | Vyříznutí dat — Smazání účtu | Vyrezanie dát — Vymazanie účtu |
| `delete_dialog_warning` | This operation will PERMANENTLY AND IRREVERSIBLY delete: | Tato operace TRVALE A NEVRATNĚ smaže: | Táto operácia TRVALO A NENÁVRATNE vymaže: |
| `delete_dialog_item_customers` | All customers and their contact information | Všechny zákazníky a jejich kontaktní údaje | Všetkých zákazníkov a ich kontaktné údaje |
| `delete_dialog_item_devices` | All devices and revision history | Všechna zařízení a historii revizí | Všetky zariadenia a históriu revízií |
| `delete_dialog_item_routes` | All routes, visits, and work logs | Všechny trasy, návštěvy a pracovní záznamy | Všetky trasy, návštevy a pracovné záznamy |
| `delete_dialog_item_comms` | All communication records | Všechny záznamy komunikace | Všetky záznamy komunikácie |
| `delete_dialog_item_settings` | All settings, crews, depots, and email templates | Všechna nastavení, posádky, depa a e-mailové šablony | Všetky nastavenia, posádky, depá a e-mailové šablóny |
| `delete_dialog_item_accounts` | Your user account and all worker accounts | Váš uživatelský účet a všechny účty pracovníků | Váš používateľský účet a všetky účty pracovníkov |
| `delete_dialog_irreversible` | This action is IRREVERSIBLE. Data will be definitively excised from the system. Even Ariadline support cannot recover data removed this way. | Tato akce je NEVRATNÁ. Data budou definitivně vyříznuta ze systému. Ani podpora Ariadline nemůže obnovit data odstraněná tímto způsobem. | Táto akcia je NENÁVRATNÁ. Dáta budú definitívne vyrezané zo systému. Ani podpora Ariadline nemôže obnoviť dáta odstránené týmto spôsobom. |
| `delete_dialog_download_hint` | We recommend downloading a complete backup of your data before deletion: | Doporučujeme si před smazáním stáhnout kompletní zálohu vašich dat: | Odporúčame si pred vymazaním stiahnuť kompletnú zálohu vašich dát: |
| `delete_dialog_download_btn` | Download full data export | Stáhnout kompletní export dat | Stiahnuť kompletný export dát |
| `delete_dialog_continue` | Continue to deletion | Pokračovat ke smazání | Pokračovať k vymazaniu |
| `delete_confirm_title` | Final Confirmation | Závěrečné potvrzení | Záverečné potvrdenie |
| `delete_confirm_instruction` | To confirm the data excise, type this code: | Pro potvrzení vyříznutí dat zadejte tento kód: | Pre potvrdenie vyrezania dát zadajte tento kód: |
| `delete_confirm_input_label` | Enter code | Zadejte kód | Zadajte kód |
| `delete_confirm_button` | Permanently delete everything | Definitivně smazat vše | Definitívne vymazať všetko |
| `delete_success` | Your data has been permanently deleted. | Vaše data byla trvale smazána. | Vaše dáta boli trvalo vymazané. |
| `delete_error` | Failed to delete data. Please try again or contact support. | Nepodařilo se smazat data. Zkuste to znovu nebo kontaktujte podporu. | Nepodarilo sa vymazať dáta. Skúste to znova alebo kontaktujte podporu. |

---

## 7. Implementační kroky

### Fáze 1: Backend
1. Přidat `delete_user_account` SQL query do `worker/src/db/queries/settings.rs`
2. Přidat `handle_delete_account` handler do `worker/src/handlers/settings.rs`
3. Registrovat `sazinka.account.delete` subscription v `worker/src/main.rs`
4. `cargo check` — ověřit kompilaci

### Fáze 2: Frontend service
5. Přidat `deleteAccount()` do `apps/web/src/services/settingsService.ts`

### Fáze 3: UI komponenty
6. Vytvořit `DeleteAccountDialog.tsx` + `DeleteAccountDialog.module.css`
7. Přidat Danger Zone sekci do `Settings.tsx` (záložka import-export)
8. Přidat styly do `Settings.module.css`

### Fáze 4: Překlady
9. Přidat všechny klíče do `en/settings.json`, `cs/settings.json`, `sk/settings.json`

### Fáze 5: Ověření
10. Manuální test celého flow
11. Ověřit, že po smazání je uživatel odhlášen a nemůže se přihlásit

---

## 8. Implementační log

| Datum | Fáze | Popis |
|-------|------|-------|
| 2026-02-15 | Návrh | Vytvořen PRJ_DATA.MD s kompletním návrhem |
| 2026-02-15 | Backend | Typy `DeleteAccountRequest`/`DeleteAccountResponse` v `types/settings.rs` |
| 2026-02-15 | Backend | SQL query `delete_user_account` v `db/queries/settings.rs` |
| 2026-02-15 | Backend | Handler `handle_delete_account` v `handlers/settings.rs` |
| 2026-02-15 | Backend | NATS subscription `sazinka.account.delete` v `handlers/mod.rs` |
| 2026-02-15 | Backend | `cargo check` — kompilace OK |
| 2026-02-15 | Frontend | `deleteAccount()` v `services/settingsService.ts` |
| 2026-02-15 | Frontend | `DeleteAccountDialog.tsx` + `DeleteAccountDialog.module.css` |
| 2026-02-15 | Frontend | `DangerZoneSection` integrována do Settings.tsx (import-export tab) |
| 2026-02-15 | Překlady | Všechny klíče přidány do `en/settings.json`, `cs/settings.json`, `sk/settings.json` |
| 2026-02-15 | Redesign | Dvě úrovně: Level 1 (data only) + Level 2 (data + account) |
| 2026-02-15 | Backend | `delete_company_data` query (Level 1) — maže data, zachovává účet |
| 2026-02-15 | Backend | `delete_user_account` volá Level 1 + smaže user row (Level 2) |
| 2026-02-15 | Backend | Handler rozlišuje `level: 1` vs `level: 2` v requestu |
| 2026-02-15 | Frontend | `deleteCompanyData()` (Level 1) + `deleteAccount()` (Level 2) v settingsService |
| 2026-02-15 | Frontend | DangerZoneSection: dva tlačítka (oranžové L1, červené L2) |
| 2026-02-15 | Frontend | DeleteAccountDialog: adaptivní UI podle levelu (barvy, texty, chování po smazání) |
| 2026-02-15 | Překlady | Přidáno 8 nových klíčů pro Level 1 ve všech 3 jazycích |

---

*Poslední aktualizace: 2026-02-15*
