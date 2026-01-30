# CSV Import – Specifikace (v2.0.0)

> **Verze:** 2.0.0  
> **Datum:** 2026-01-30

## Obsah

### Zákazníci (customers.csv)
1. [Přehled](#1-přehled)
2. [Formát souboru](#2-formát-souboru)
3. [Sloupce](#3-sloupce)
4. [Validace a normalizace](#4-validace-a-normalizace)
5. [Normalizace telefonů (E.164)](#5-normalizace-telefonů-e164)
6. [Zpracování adres a geokódování](#6-zpracování-adres-a-geokódování)
7. [Detekce duplicit](#7-detekce-duplicit)
8. [Report importu](#8-report-importu)
9. [Architektura](#9-architektura)
10. [Příklady](#10-příklady)

### Další entity
11. [Import zařízení (devices.csv)](#11-import-zařízení-devicescsv)
12. [Import revizí (revisions.csv)](#12-import-revizí-revisionscsv)
13. [Import komunikace (communications.csv)](#13-import-komunikace-communicationscsv)
14. [Import návštěv (visits.csv)](#14-import-návštěv-visitscsv)
15. [Pořadí importu a propojování záznamů](#15-pořadí-importu-a-propojování-záznamů)

---

## 1. Přehled

Import zákazníků z CSV souboru s těmito vlastnostmi:

- **Podpora osob i firem** – typ zákazníka, IČO, DIČ, kontaktní osoba
- **Tolerantní parsing** – přijímá neúplné záznamy, "lidský" formát
- **Lenient režim** – nekritické chyby generují varování, neblokují import
- **E.164 normalizace telefonů** – s automatickým doplněním `+420` pro CZ
- **Podpora zahraničních zákazníků** – country pole, zahraniční telefony
- **Oddělené geokódování** – adresa se uloží, geocoding běží jako následný job

### Kapacita

| Parametr | Hodnota |
|----------|---------|
| Max. počet řádků | 20 000 |
| Očekávaná velikost souboru | 3–4 MB |
| Doba zpracování (klient) | 30–60 sekund |

---

## 2. Formát souboru

### 2.1 Kódování a struktura

| Vlastnost | Hodnota |
|-----------|---------|
| Kódování | UTF-8 (doporučeno s BOM pro Excel) |
| Oddělovač | Středník `;` |
| Zakončení řádků | LF nebo CRLF (oboje OK) |
| Hlavička | **Povinná**, první řádek |

### 2.2 Uvozovky a escapování

- Hodnoty **mohou** být bez uvozovek
- Pokud hodnota obsahuje `;` nebo nový řádek → musí být v `"..."`
- Uvozovka uvnitř hodnoty se zdvojuje: `""`

```csv
"Poznámka ""důležitá"""
```

### 2.3 Prázdné hodnoty

- Prázdné pole mezi `;;` = `null`
- Hodnoty `""`, `-`, `N/A`, `NULL` (case-insensitive) → mapují se na `null`
- Hodnoty obsahující pouze whitespace (např. `"   "`) → po `trim()` = `null`

---

## 3. Sloupce

### 3.1 Doporučená hlavička

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
```

### 3.2 Definice sloupců

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `type` | string | ne | Typ zákazníka: `person` nebo `company` |
| `name` | string | ne | Jméno osoby NEBO název firmy |
| `contactPerson` | string | ne | Kontaktní osoba (pouze pro firmy) |
| `ico` | string | ne | IČO – 8 číslic (pouze pro firmy) |
| `dic` | string | ne | DIČ – formát CZ + 8-10 číslic (pouze pro firmy) |
| `street` | string | ne | Ulice a číslo popisné |
| `city` | string | ne | Město |
| `postalCode` | string | ne | PSČ (ukládá se jako string) |
| `country` | string | ne | Kód státu (ISO 3166-1 alpha-2), default `CZ` |
| `phone` | string | ne | Telefonní číslo |
| `email` | string | ne | Emailová adresa |
| `notes` | string | ne | Poznámky |

### 3.3 Tolerance formátu

- **Neznámé sloupce** se ignorují (např. `tag`, `category`)
- **Chybějící sloupce** se berou jako prázdné
- **Pořadí sloupců** – dle názvů v hlavičce (libovolné pořadí OK)

### 3.4 Minimální požadavek pro platný řádek

Řádek je **importovatelný**, pokud obsahuje alespoň jedno neprázdné pole z:

- `name`
- `email`
- `phone`
- `ico`
- `street` / `city` / `postalCode`
- `notes`

Úplně prázdné řádky se přeskakují bez chyby.

---

## 4. Validace a normalizace

### 4.1 Obecné čištění

Všechny textové hodnoty:

1. `trim()` – oříznutí mezer na začátku/konci
2. Mapování na `null`: `""`, `-`, `N/A`, `NULL`

### 4.2 Type (typ zákazníka)

| Vstup | Výstup | Poznámka |
|-------|--------|----------|
| `person`, `osoba`, `fyzická`, `fo` | `person` | Case-insensitive |
| `company`, `firma`, `právnická`, `po` | `company` | Case-insensitive |
| (prázdné) | odvodit | Viz pravidla odvození |

**Pravidla odvození typu:**
1. Pokud je vyplněno `ico` nebo `dic` → `company`
2. Pokud je vyplněno `contactPerson` → `company`
3. Jinak → `person`

**Heuristické varování (nemění typ, pouze upozorní):**
- Pokud `type=person` a `name` obsahuje `s.r.o.`, `a.s.`, `SE`, `GmbH`, `spol.`, `v.o.s.`, `k.s.` → **varování** "Název vypadá jako firma, ale typ je person"

### 4.3 IČO (Identifikační číslo osoby)

**Formát:** 8 číslic

**Čištění:**
1. Odstranit mezery
2. Doplnit leading zeros na 8 číslic: `123456` → `00123456`

**Validace:**
- Pokud není 8 číslic po čištění → **varování**
- Pokud `type=person` a `ico` vyplněno → **varování** "IČO u fyzické osoby"

### 4.4 DIČ (Daňové identifikační číslo)

**Formát pro CZ:** `CZ` + 8-10 číslic (např. `CZ12345678`)

**Čištění:**
1. Odstranit mezery
2. Převést na uppercase

**Validace dle country:**

| Country | Pravidlo |
|---------|----------|
| `CZ` | Pokud nezačíná `CZ` → doplnit prefix. Regex: `^CZ\d{8,10}$`. Pokud nesplňuje → **varování** |
| ostatní | Pouze `trim()` + `uppercase`, formát se nevaliduje (zahraniční DIČ mají různé formáty) |

**Obecně:**
- Pokud `type=person` a `dic` vyplněno → **varování** "DIČ u fyzické osoby"

### 4.5 ContactPerson (kontaktní osoba)

- Pouze pro `type=company`
- Pokud `type=person` a `contactPerson` vyplněno → ignorovat + **varování**

### 4.6 Country

| Vstup | Výstup | Poznámka |
|-------|--------|----------|
| (prázdné) | `CZ` | Default hodnota |
| `CZ`, `SK`, `DE`... | beze změny | ISO 3166-1 alpha-2 |
| `Czech Republic`, `Česko` | `CZ` | Volitelná normalizace |
| neznámá hodnota | uložit + varování | Lenient režim |

### 4.7 PostalCode (PSČ)

**Pravidla čištění:**
1. Odstranit mezery a tabulátory: `"110 00"` → `"11000"`
2. Ostatní znaky ponechat (kvůli zahraničí)

**Validace pro CZ:**
- Pokud `country=CZ` a po čištění není `^\d{5}$` → **varování** (neblokuje)

### 4.8 Email

1. `trim()`
2. Převést na lowercase
3. Validace: pokud neobsahuje `@` → **varování** (neblokuje)

---

## 5. Normalizace telefonů (E.164)

### 5.1 Cílový formát

```
+<countryCallingCode><nationalNumber>
```

Příklady:
- `+420602123456` (CZ)
- `+4915123456789` (DE)
- `+421905123456` (SK)

### 5.2 Přijímané vstupní formáty

| Vstup | Výstup |
|-------|--------|
| `+420 602 123 456` | `+420602123456` |
| `00420 602123456` | `+420602123456` |
| `602 123 456` | `+420602123456` (pokud `country=CZ`) |
| `(602) 123-456` | `+420602123456` (pokud `country=CZ`) |
| `0602123456` | `+420602123456` (CZ, s varováním) |
| `+49 1512 3456789` | `+4915123456789` |

### 5.3 Algoritmus normalizace

```
1. Vyčistit znaky
   - Odstranit: mezery, pomlčky, závorky, tečky
   - Ponechat: + na začátku, číslice

2. Rozpoznat mezinárodní prefix
   - 00xxx → +xxx

3. Pokud začíná +
   - Validovat délku (7–15 číslic po +)
   - Pokud OK → E.164
   - Pokud ne → varování, phone=null, phoneRaw=původní

4. Pokud nezačíná +
   - Použít country jako kontext
   - Pro CZ:
     - Odstranit leading 0 (s varováním)
     - Pokud 9 číslic → +420 + číslo
     - Jinak → varování, uložit raw
   - Pro ostatní země:
     - Doplnit předvolbu dle mapy country→calling code
     - Pokud nemáme mapu → varování, uložit raw
```

### 5.4 Knihovna

Použití **libphonenumber-js** pro robustní parsing.

### 5.5 Uložení při selhání

| Pole | Hodnota |
|------|---------|
| `phone` | `null` |
| `phoneRaw` | Původní vstup z CSV |

> **Poznámka:** `phoneRaw` není importovaný sloupec z CSV. Je to interní pole v databázi, kam se ukládá původní hodnota telefonu, pokud normalizace na E.164 selže. Umožňuje pozdější ruční opravu.

### 5.6 Více telefonů v jednom poli

Pokud `phone` obsahuje `,` nebo `/`:
- Vzít **první** číslo jako primární
- Ostatní přidat do `notes` s prefixem `[Import: další tel. ...]`
- Vygenerovat varování

---

## 6. Zpracování adres a geokódování

### 6.1 Uložení adresy

Adresa se ukládá **ihned** při importu:
- `street`, `city`, `postalCode`, `country`
- Bez `lat`/`lng` (geokódování následně)

### 6.2 Geokódování

**Spouští se jako separátní job na serveru** po dokončení importu.

Podmínky pro geokódování:
- Minimálně `city` + (`street` NEBO `postalCode`)
- Pokud není splněno → přeskočit + varování "adresa neúplná pro geokódování"

### 6.3 Rate limiting

- MockGeocoder pro testy/dev
- RateLimitedNominatim pro produkci (1.5s interval)
- CircuitBreaker po 3 selháních

---

## 7. Detekce duplicit

### 7.1 Pravidla (v pořadí priority)

1. **IČO match** (pro firmy) → aktualizovat existujícího
2. **Email match** (case-insensitive) → aktualizovat existujícího
3. **Phone match** (normalizované E.164) → aktualizovat existujícího
4. **Žádná shoda** → vytvořit nového zákazníka

> **Poznámka:** Detekce duplicit se provádí na **normalizovaných hodnotách**:
> - `ico` – doplněné na 8 číslic (např. `123456` → `00123456`)
> - `email` – lowercase
> - `phone` – E.164 formát (např. `+420602123456`)

### 7.2 Pravidla pro aktualizaci (lenient)

- **Nepřepisovat** existující neprázdné hodnoty prázdnými z CSV
- **Přepisovat** jen pokud CSV pole obsahuje hodnotu

---

## 8. Report importu

### 8.1 Struktura reportu

```typescript
interface ImportReport {
  // Metadata
  filename: string;
  importedAt: string;
  durationMs: number;
  
  // Souhrnné statistiky
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  
  // Detaily problémů
  issues: ImportIssue[];
}

interface ImportIssue {
  rowNumber: number;
  level: 'warning' | 'error';  // pouze tyto dva typy, info zprávy nejsou v issues
  field: string;
  message: string;
  originalValue?: string;
}
```

### 8.2 Formát textového reportu

```
═══════════════════════════════════════════════════════════════
                    IMPORT ZÁKAZNÍKŮ - REPORT
═══════════════════════════════════════════════════════════════

Soubor:     zakaznici_2026-01.csv
Datum:      27.01.2026 14:35:22
Doba:       45 sekund

───────────────────────────────────────────────────────────────
                         SOUHRN
───────────────────────────────────────────────────────────────

Celkem řádků:        20 000
Importováno:         19 850  ✓
Aktualizováno:          120  ↻
Přeskočeno:              30  ○

───────────────────────────────────────────────────────────────
                       VAROVÁNÍ (47)
───────────────────────────────────────────────────────────────

Řádek 15: [phone] Číslo nelze normalizovat: "abc123"
Řádek 42: [postalCode] CZ PSČ není 5 číslic: "1100"
Řádek 156: [email] Chybí @: "jan.novak"
Řádek 203: [phone] Odstraněna úvodní 0: "0602123456" → "+420602123456"
Řádek 512: [ico] IČO u fyzické osoby: "12345678"
Řádek 891: [type] Odvozeno z IČO: company
...

───────────────────────────────────────────────────────────────
                        CHYBY (0)
───────────────────────────────────────────────────────────────

(žádné)

═══════════════════════════════════════════════════════════════
```

### 8.3 Zobrazení a export

- **Modal okno** s textovým reportem
- **Tlačítko "Kopírovat"** → zkopíruje do clipboardu
- **Tlačítko "Uložit"** → stáhne jako `.txt` soubor

---

## 9. Architektura

### 9.1 Komponenty

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│   │ ImportModal  │───▶│ Web Worker   │───▶│ ImportReport │  │
│   │ (file input) │    │ (parsing)    │    │ (modal)      │  │
│   └──────────────┘    └──────────────┘    └──────────────┘  │
│                              │                               │
│                              ▼                               │
│                       ┌──────────────┐                       │
│                       │ NATS Client  │                       │
│                       └──────────────┘                       │
│                              │                               │
└──────────────────────────────│───────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      WORKER (Rust)                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│   │ customer.    │    │ PostgreSQL   │    │ Geocoding    │  │
│   │ import.batch │───▶│ (upsert)     │    │ Job (async)  │  │
│   └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 Zpracování na klientovi

1. **Soubor načten** → validace typu (CSV)
2. **Parsing** v Web Workeru (papaparse)
3. **Normalizace** každého řádku (libphonenumber-js)
4. **Batch odeslání** na server (po 100–500 záznamech)
5. **Agregace reportu** z odpovědí serveru
6. **Zobrazení reportu** v modalu

### 9.3 NATS Subject

```
sazinka.customer.import.batch   # Batch import zákazníků
```

### 9.4 Závislosti (frontend)

```json
{
  "dependencies": {
    "papaparse": "^5.4.0",
    "libphonenumber-js": "^1.10.0"
  }
}
```

---

## 10. Příklady

### 10.1 Fyzická osoba (CZ)

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
person;Jan Novák;;;;Hlavní 123;Praha;110 00;CZ;602 123 456;jan@example.com;Klíče u sousedů
```

**Výsledek:**
- `type` → `person`
- `postalCode` → `11000`
- `phone` → `+420602123456`

### 10.2 Firma s kontaktní osobou

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
company;ABC Trading s.r.o.;Petr Účetní;12345678;CZ12345678;Průmyslová 1;Brno;602 00;CZ;541 234 567;info@abc.cz;
```

**Výsledek:**
- `type` → `company`
- `ico` → `12345678`
- `dic` → `CZ12345678`
- `phone` → `+420541234567`

### 10.3 Název vypadá jako firma, ale chybí IČO

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
;Malá firma s.r.o.;;;;Vedlejší 5;Plzeň;301 00;CZ;377123456;;
```

**Výsledek:**
- `type` → `person` (odvozeno – žádné IČO/DIČ/contactPerson)
- **varování** "Název vypadá jako firma, ale typ je person"

### 10.4 Zahraniční zákazník (DE)

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
company;Müller GmbH;Anna Müller;;DE123456789;Musterstr. 1;Berlin;10115;DE;+49 1512 3456789;info@mueller.de;
```

**Výsledek:**
- `type` → `company`
- `dic` → `DE123456789` (německé DIČ)
- `phone` → `+4915123456789`

### 10.5 Neúplný záznam (pouze email)

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
;;;;;;;;;;info@firma.cz;Pouze email
```

**Výsledek:**
- Import proběhne (má email)
- `type` → `person` (default)
- Ostatní pole → `null`

### 10.6 Problematická data

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
person;Test;;;CZ99999999;Ulice;Město;ABC-123;CZ;abc-telefon;spatnyemail;
```

**Výsledek:**
- Import proběhne (má name, street, city)
- `dic` → `CZ99999999` + **varování** "DIČ u fyzické osoby"
- `postalCode` → `ABC-123` + **varování** "CZ PSČ není 5 číslic"
- `phone` → `null`, `phoneRaw` → `abc-telefon` + **varování**
- `email` → `spatnyemail` + **varování** "chybí @"

### 10.7 Telefon bez předvolby (CZ default)

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
person;Petr;;;;Na Hřebenkách 5;Praha;150 00;;777888999;;
```

**Výsledek:**
- `country` → `CZ` (default)
- `phone` → `+420777888999`

### 10.8 Více telefonů

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
company;Firma s.r.o.;;12345678;;Průmyslová 1;Brno;602 00;CZ;602111222, 603333444;;
```

**Výsledek:**
- `phone` → `+420602111222`
- `notes` → `[Import: další tel. +420603333444]`
- **varování** "více telefonů, použit první"

### 10.9 Odvození typu z IČO

```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
;Neznámá entita;;87654321;;Ulice 1;Praha;110 00;CZ;;;
```

**Výsledek:**
- `type` → `company` (odvozeno z IČO)
- **varování** "Typ odvozen z IČO: company"

---

## 11. Import zařízení (devices.csv)

### 11.1 Přehled

Import zařízení zákazníků (kotle, komíny, krby, sporáky apod.) s vazbou na existující zákazníky.

**Prerekvizity:**
- Zákazníci musí být již importováni (viz sekce 15)
- Propojení přes `customer_ref` (IČO, email nebo telefon zákazníka)

### 11.2 Hlavička

```csv
customer_ref;device_type;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
```

### 11.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `customer_ref` | string | **ano** | Reference na zákazníka: IČO, email, nebo telefon (E.164) |
| `device_type` | string | **ano** | Typ zařízení (viz tabulka níže) |
| `manufacturer` | string | ne | Výrobce |
| `model` | string | ne | Model |
| `serial_number` | string | ne | Sériové číslo |
| `installation_date` | string | ne | Datum instalace (YYYY-MM-DD) |
| `revision_interval_months` | number | **ano** | Interval revizí v měsících |
| `notes` | string | ne | Poznámky |

### 11.4 Typy zařízení

| Hodnota | Popis |
|---------|-------|
| `gas_boiler` | Plynový kotel |
| `gas_water_heater` | Plynový ohřívač vody |
| `chimney` | Komín |
| `fireplace` | Krb |
| `gas_stove` | Plynový sporák |
| `other` | Jiné |

**Aliasy (case-insensitive):**
- `kotel`, `plynový kotel` → `gas_boiler`
- `ohřívač`, `bojler` → `gas_water_heater`
- `komín`, `kouřovod` → `chimney`
- `krb`, `krbová vložka` → `fireplace`
- `sporák`, `plynový sporák` → `gas_stove`
- `jiné`, `ostatní` → `other`

### 11.5 Validace

**customer_ref:**
1. Nejprve zkusit match jako IČO (8 číslic)
2. Pokud neúspěch → zkusit jako email (case-insensitive)
3. Pokud neúspěch → zkusit jako telefon (E.164)
4. Pokud zákazník nenalezen → **chyba** "Zákazník nenalezen"

**revision_interval_months:**
- Musí být kladné celé číslo
- Typické hodnoty: 12, 24, 36
- Pokud chybí nebo nevalidní → **chyba**

**installation_date:**
- Formát YYYY-MM-DD
- Pokud nevalidní → **varování**, hodnota se neuloží

### 11.6 Detekce duplicit

Zařízení je **duplicitní**, pokud pro daného zákazníka existuje zařízení se stejným:
1. `serial_number` (pokud vyplněno)
2. NEBO kombinace `device_type` + `manufacturer` + `model` (pokud všechny vyplněny)

Při duplicitě → **aktualizovat** existující záznam.

### 11.7 Příklady

```csv
customer_ref;device_type;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
12345678;gas_boiler;Vaillant;ecoTEC plus;VL123456;2023-05-15;12;Hlavní kotel
info@abc.cz;chimney;;;CH-2020;2020-01-01;24;Nerezový komín
+420602123456;gas_water_heater;Junkers;Cerapur;JK789012;2024-01-10;12;
12345678;fireplace;Romotop;Heat 2g 59.50.01;;;36;Krbová vložka v obýváku
```

---

## 12. Import revizí (revisions.csv)

### 12.1 Přehled

Import historie revizí pro existující zařízení. Umožňuje importovat jak budoucí termíny, tak historické záznamy dokončených revizí.

**Prerekvizity:**
- Zařízení musí být již importována
- Propojení přes `device_ref` (sériové číslo nebo kombinace customer_ref + device_type)

### 12.2 Hlavička

```csv
device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings
```

### 12.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `device_ref` | string | **ano** | Sériové číslo zařízení |
| `customer_ref` | string | **ano** | Reference na zákazníka (pro jednoznačnou identifikaci) |
| `due_date` | string | **ano** | Termín revize (YYYY-MM-DD) |
| `status` | string | ne | Stav revize (viz tabulka) |
| `scheduled_date` | string | ne | Naplánované datum (YYYY-MM-DD) |
| `scheduled_time_start` | string | ne | Čas od (HH:MM) |
| `scheduled_time_end` | string | ne | Čas do (HH:MM) |
| `completed_at` | string | ne | Datum a čas dokončení (ISO 8601) |
| `duration_minutes` | number | ne | Délka trvání v minutách |
| `result` | string | ne | Výsledek revize (viz tabulka) |
| `findings` | string | ne | Poznámky/nálezy |

### 12.4 Stavy revize

| Hodnota | Popis |
|---------|-------|
| `upcoming` | Nadcházející (výchozí) |
| `scheduled` | Naplánováno |
| `confirmed` | Potvrzeno |
| `completed` | Dokončeno |
| `cancelled` | Zrušeno |

**Aliasy:**
- `nadcházející`, `budoucí` → `upcoming`
- `naplánováno`, `plánováno` → `scheduled`
- `potvrzeno` → `confirmed`
- `dokončeno`, `hotovo`, `provedeno` → `completed`
- `zrušeno`, `storno` → `cancelled`

### 12.5 Výsledky revize

| Hodnota | Popis |
|---------|-------|
| `passed` | V pořádku |
| `conditional` | S výhradami |
| `failed` | Nevyhovělo |

**Aliasy:**
- `ok`, `v pořádku`, `bez závad` → `passed`
- `s výhradami`, `podmíněně` → `conditional`
- `nevyhovělo`, `závada`, `nok` → `failed`

### 12.6 Validace

**Identifikace zařízení:**
1. Najít zákazníka podle `customer_ref`
2. Najít zařízení podle `device_ref` (sériové číslo) u daného zákazníka
3. Pokud nenalezeno → **chyba**

**Logická validace:**
- Pokud `status=completed` a chybí `result` → **varování** "Dokončená revize bez výsledku"
- Pokud `result` vyplněn a `status≠completed` → automaticky nastavit `status=completed`
- Pokud `completed_at` vyplněno a `status≠completed` → automaticky nastavit `status=completed`

### 12.7 Detekce duplicit

Revize je **duplicitní**, pokud pro dané zařízení existuje revize se stejným `due_date`.

Při duplicitě → **aktualizovat** existující záznam.

### 12.8 Příklady

```csv
device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings
VL123456;12345678;2025-05-15;completed;2025-05-10;09:00;10:30;2025-05-10T10:15:00;75;passed;Bez závad, kotel v dobrém stavu
VL123456;12345678;2026-05-15;upcoming;;;;;;;Plánovaná pravidelná revize
CH-2020;info@abc.cz;2024-12-01;completed;2024-12-01;14:00;;2024-12-01T15:00:00;60;conditional;Nutné vyčištění do 3 měsíců
JK789012;+420602123456;2025-01-10;scheduled;2025-01-15;08:00;09:00;;;;
```

---

## 13. Import komunikace (communications.csv)

### 13.1 Přehled

Import historie komunikace se zákazníky – hovory, e-maily, poznámky, SMS.

**Prerekvizity:**
- Zákazníci musí být již importováni

### 13.2 Hlavička

```csv
customer_ref;date;comm_type;direction;subject;content;contact_name;contact_phone;duration_minutes
```

### 13.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `customer_ref` | string | **ano** | Reference na zákazníka (IČO, email, telefon) |
| `date` | string | **ano** | Datum komunikace (YYYY-MM-DD) |
| `comm_type` | string | **ano** | Typ komunikace (viz tabulka) |
| `direction` | string | **ano** | Směr: `outbound` nebo `inbound` |
| `subject` | string | ne | Předmět |
| `content` | string | **ano** | Obsah/popis komunikace |
| `contact_name` | string | ne | Jméno kontaktní osoby |
| `contact_phone` | string | ne | Telefon kontaktu |
| `duration_minutes` | number | ne | Délka hovoru (pouze pro `call`) |

### 13.4 Typy komunikace

| Hodnota | Popis |
|---------|-------|
| `call` | Telefonát |
| `email_sent` | Odeslaný e-mail |
| `email_received` | Přijatý e-mail |
| `note` | Poznámka |
| `sms` | SMS zpráva |

**Aliasy:**
- `hovor`, `telefon`, `telefonát` → `call`
- `email`, `mail`, `odeslaný email` → `email_sent`
- `přijatý email`, `příchozí email` → `email_received`
- `poznámka`, `záznam` → `note`

### 13.5 Směr komunikace

| Hodnota | Popis |
|---------|-------|
| `outbound` | Odchozí (my → zákazník) |
| `inbound` | Příchozí (zákazník → my) |

**Aliasy:**
- `odchozí`, `ven`, `out` → `outbound`
- `příchozí`, `dovnitř`, `in` → `inbound`

### 13.6 Validace

- Pro `comm_type=call` je doporučeno vyplnit `duration_minutes`
- Pro `comm_type=email_*` je doporučeno vyplnit `subject`
- `contact_phone` se normalizuje na E.164 (s varováním při neúspěchu)

### 13.7 Příklady

```csv
customer_ref;date;comm_type;direction;subject;content;contact_name;contact_phone;duration_minutes
12345678;2025-01-15;call;outbound;Domluvení termínu;Volal jsem ohledně revize kotle, zákazník souhlasí s termínem 20.1.;Jan Novák;+420602123456;5
12345678;2025-01-16;email_sent;outbound;Potvrzení termínu revize;Dobrý den, potvrzuji termín revize na 20.1.2025 v 9:00.;;;
info@abc.cz;2025-01-18;email_received;inbound;Dotaz na cenu;Jaká je cena revize komínu?;;;
+420602123456;2025-01-20;note;outbound;;Zákaznice preferuje odpolední hodiny, má malé děti;;;
12345678;2025-01-22;sms;outbound;;Připomínka: zítra revize v 9:00;;;
```

---

## 14. Import návštěv (visits.csv)

### 14.1 Přehled

Import plánovaných a uskutečněných návštěv u zákazníků.

**Prerekvizity:**
- Zákazníci musí být již importováni
- Zařízení (volitelně) pro návštěvy typu revize

### 14.2 Hlavička

```csv
customer_ref;device_ref;scheduled_date;scheduled_time_start;scheduled_time_end;visit_type;status;result;result_notes;requires_follow_up;follow_up_reason
```

### 14.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `customer_ref` | string | **ano** | Reference na zákazníka |
| `device_ref` | string | ne | Sériové číslo zařízení (pokud návštěva souvisí se zařízením) |
| `scheduled_date` | string | **ano** | Naplánované datum (YYYY-MM-DD) |
| `scheduled_time_start` | string | ne | Čas od (HH:MM) |
| `scheduled_time_end` | string | ne | Čas do (HH:MM) |
| `visit_type` | string | **ano** | Typ návštěvy (viz tabulka) |
| `status` | string | ne | Stav návštěvy (viz tabulka) |
| `result` | string | ne | Výsledek návštěvy (viz tabulka) |
| `result_notes` | string | ne | Poznámky k výsledku |
| `requires_follow_up` | boolean | ne | Vyžaduje následnou návštěvu (`true`/`false`) |
| `follow_up_reason` | string | ne | Důvod následné návštěvy |

### 14.4 Typy návštěv

| Hodnota | Popis |
|---------|-------|
| `revision` | Revize |
| `installation` | Instalace |
| `repair` | Oprava |
| `consultation` | Konzultace |
| `follow_up` | Následná návštěva |

**Aliasy:**
- `revize`, `kontrola` → `revision`
- `instalace`, `montáž` → `installation`
- `oprava`, `servis` → `repair`
- `konzultace`, `poradenství` → `consultation`
- `následná`, `follow-up` → `follow_up`

### 14.5 Stavy návštěv

| Hodnota | Popis |
|---------|-------|
| `planned` | Naplánováno (výchozí) |
| `in_progress` | Probíhá |
| `completed` | Dokončeno |
| `cancelled` | Zrušeno |
| `rescheduled` | Přeplánováno |

### 14.6 Výsledky návštěv

| Hodnota | Popis |
|---------|-------|
| `successful` | Úspěšná |
| `partial` | Částečná |
| `failed` | Neúspěšná |
| `customer_absent` | Zákazník nepřítomen |
| `rescheduled` | Přeplánováno |

**Aliasy:**
- `úspěšná`, `ok` → `successful`
- `částečná`, `částečně` → `partial`
- `neúspěšná`, `nok` → `failed`
- `nepřítomen`, `nikdo doma` → `customer_absent`
- `přeplánováno`, `odloženo` → `rescheduled`

### 14.7 Validace

- Pokud `visit_type=revision` a `device_ref` je prázdné → **varování** "Revize bez zařízení"
- Pokud `status=completed` a `result` je prázdné → **varování** "Dokončená návštěva bez výsledku"
- `requires_follow_up` přijímá: `true`, `false`, `ano`, `ne`, `1`, `0`

### 14.8 Detekce duplicit

Návštěva je **duplicitní**, pokud pro daného zákazníka existuje návštěva se stejným:
- `scheduled_date` + `visit_type` + `device_ref` (pokud vyplněno)

Při duplicitě → **aktualizovat** existující záznam.

### 14.9 Příklady

```csv
customer_ref;device_ref;scheduled_date;scheduled_time_start;scheduled_time_end;visit_type;status;result;result_notes;requires_follow_up;follow_up_reason
12345678;VL123456;2025-01-20;09:00;11:00;revision;completed;successful;Revize proběhla bez problémů;false;
info@abc.cz;;2025-01-22;14:00;;consultation;planned;;;;;
+420602123456;JK789012;2025-01-25;10:00;12:00;repair;completed;partial;Opraveno, ale doporučuji výměnu ventilu;true;Objednat nový díl a vyměnit
12345678;;2025-02-01;08:00;09:00;follow_up;planned;;;;false;
```

---

## 15. Pořadí importu a propojování záznamů

### 15.1 Povinné pořadí importu

Import musí probíhat v tomto pořadí (kvůli závislostem mezi entitami):

```
1. customers.csv     → vytvoří zákazníky
       ↓
2. devices.csv       → vytvoří zařízení (vyžaduje zákazníky)
       ↓
3. revisions.csv     → vytvoří revize (vyžaduje zařízení)
       ↓
4. communications.csv → vytvoří komunikace (vyžaduje zákazníky)
       ↓
5. visits.csv        → vytvoří návštěvy (vyžaduje zákazníky, volitelně zařízení)
```

### 15.2 Mechanismus propojování (customer_ref)

Všechny soubory kromě `customers.csv` používají sloupec `customer_ref` pro identifikaci zákazníka.

**Pořadí vyhledávání:**

1. **IČO** – pokud hodnota odpovídá formátu 8 číslic
2. **Email** – pokud hodnota obsahuje `@`
3. **Telefon** – pokud hodnota začíná `+` nebo je to číslo

```
customer_ref="12345678"     → hledání dle IČO
customer_ref="info@abc.cz"  → hledání dle emailu
customer_ref="+420602123456" → hledání dle telefonu
```

### 15.3 Mechanismus propojování (device_ref)

Soubory `revisions.csv` a `visits.csv` mohou obsahovat `device_ref` pro identifikaci zařízení.

**Hodnota `device_ref`:**
- **Sériové číslo** zařízení (`serial_number`)

Vyhledávání probíhá v kontextu zákazníka určeného `customer_ref`.

### 15.4 Chybějící reference

| Situace | Chování |
|---------|---------|
| `customer_ref` nenalezen | **chyba** – řádek se přeskočí |
| `device_ref` nenalezen (povinný) | **chyba** – řádek se přeskočí |
| `device_ref` nenalezen (volitelný) | **varování** – řádek se importuje bez vazby |

### 15.5 Doporučení pro přípravu dat

1. **Zajistěte unikátní identifikátory** – každý zákazník by měl mít alespoň IČO, email nebo telefon
2. **Používejte sériová čísla** – pro zařízení, která budou mít revize
3. **Konzistentní formát telefonů** – ideálně E.164 (`+420...`)
4. **Datumy v ISO formátu** – YYYY-MM-DD

### 15.6 Hromadný import (ZIP archiv)

Pro import všech souborů najednou lze použít ZIP archiv s touto strukturou:

```
import_2026-01.zip
├── customers.csv
├── devices.csv
├── revisions.csv
├── communications.csv
└── visits.csv
```

Systém automaticky:
1. Rozbalí archiv
2. Importuje soubory ve správném pořadí
3. Vygeneruje souhrnný report

### 15.7 Příklad kompletního importu

**customers.csv:**
```csv
type;name;contactPerson;ico;dic;street;city;postalCode;country;phone;email;notes
company;ABC Trading s.r.o.;Jan Novák;12345678;CZ12345678;Průmyslová 1;Brno;60200;CZ;+420541234567;info@abc.cz;
person;Marie Svobodová;;;;;Lipová 15;Praha;15000;CZ;+420602123456;marie@email.cz;
```

**devices.csv:**
```csv
customer_ref;device_type;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
12345678;gas_boiler;Vaillant;ecoTEC plus;VL-2023-001;2023-05-15;12;Hlavní kotel
12345678;chimney;;;CH-2020-001;2020-01-01;24;Nerezový komín
+420602123456;gas_water_heater;Junkers;Cerapur;JK-2024-001;2024-01-10;12;
```

**revisions.csv:**
```csv
device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings
VL-2023-001;12345678;2024-05-15;completed;2024-05-10;09:00;;2024-05-10T10:30:00;90;passed;Bez závad
VL-2023-001;12345678;2025-05-15;upcoming;;;;;;;;;
CH-2020-001;12345678;2024-12-01;completed;;;2024-12-01T15:00:00;60;conditional;Doporučeno vyčistit
JK-2024-001;+420602123456;2025-01-10;scheduled;2025-01-15;08:00;09:00;;;;;
```

**communications.csv:**
```csv
customer_ref;date;comm_type;direction;subject;content;contact_name;contact_phone;duration_minutes
12345678;2025-01-15;call;outbound;;Domluven termín revize kotle na 20.1.;Jan Novák;+420602111222;5
+420602123456;2025-01-18;note;outbound;;Zákaznice preferuje odpolední hodiny;;;
```

**visits.csv:**
```csv
customer_ref;device_ref;scheduled_date;scheduled_time_start;scheduled_time_end;visit_type;status;result;result_notes;requires_follow_up;follow_up_reason
12345678;VL-2023-001;2025-01-20;09:00;11:00;revision;planned;;;;;
+420602123456;;2025-01-22;14:00;;consultation;planned;;;;;
