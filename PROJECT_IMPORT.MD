# CSV Import – Specifikace (v2.0.0)

> **Verze:** 3.0.0  
> **Datum:** 2026-02-07

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
14. [Import pracovního deníku (work_log.csv)](#14-import-pracovního-deníku-work_logcsv)
15. [Pořadí importu a propojování záznamů](#15-pořadí-importu-a-propojování-záznamů)
16. [Upřesnění a FAQ](#16-upřesnění-a-faq)

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

**Definice "prázdné hodnoty"** (platí v celé specifikaci):

| Vstup | Po zpracování | Je prázdné? |
|-------|---------------|-------------|
| `null` | `null` | ✓ |
| `""` (prázdný string) | `null` | ✓ |
| `"   "` (pouze whitespace) | `null` | ✓ |
| `"-"`, `"N/A"`, `"NULL"` | `null` | ✓ |
| `"hodnota"` | `"hodnota"` | ✗ |

> **Důležité:** Tato definice se používá i při merge pravidlech ("nepřepisovat prázdnými") – prázdný string v CSV se chová jako `null` a nepřepíše existující hodnotu.

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

1. `trim()` – **pouze okraje** (počáteční/koncové mezery)
2. Převést na lowercase
3. Validace: pokud neobsahuje `@` → **varování** "Chybí @" (neblokuje)
4. Validace: pokud obsahuje whitespace uvnitř → **varování** "Email obsahuje mezery" (neblokuje)

> **Poznámka:** Whitespace uvnitř emailu se neodstraňuje – hodnota se uloží beze změny. Tato validace je lenient a neblokuje import. Cílem je upozornit na pravděpodobně neplatné emaily bez destruktivních úprav.

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
   - Pokud ne → FAIL (varování + phone=null + phoneRaw=původní)

4. Pokud nezačíná +
   - Použít country jako kontext
   - Pro CZ:
     a) Pokud začíná 0 → odstranit 0 (s varováním)
     b) Pokud je nyní přesně 9 číslic → +420 + číslo → OK
     c) Jinak → FAIL (varování + phone=null + phoneRaw=původní)
   - Pro ostatní země (country je známý ISO kód):
     - Doplnit předvolbu dle libphonenumber-js
     - Validovat výsledek
   - Pro neznámou zemi (country není rozpoznatelný ISO kód):
     → FAIL (varování + phone=null + phoneRaw=původní)
```

**Příklady CZ normalizace:**

| Vstup | Krok | Výsledek |
|-------|------|----------|
| `0602123456` | odstraň 0 → `602123456` (9 číslic) | `+420602123456` ✓ |
| `602123456` | 9 číslic | `+420602123456` ✓ |
| `06021234` | odstraň 0 → `6021234` (7 číslic) | FAIL, `phoneRaw="06021234"` |
| `12345` | 5 číslic | FAIL, `phoneRaw="12345"` |

### 5.4 Knihovna

Použití **libphonenumber-js** pro robustní parsing.

### 5.5 Uložení při selhání

| Pole | Hodnota |
|------|---------|
| `phone` | `null` |
| `phoneRaw` | Původní vstup z CSV |

> **Poznámka:** `phoneRaw` není importovaný sloupec z CSV. Je to interní pole v databázi, kam se ukládá původní hodnota telefonu, pokud normalizace na E.164 selže. Umožňuje pozdější ruční opravu.

**Report:** Při selhání normalizace telefonu se v `ImportIssue` **vždy vyplní** `originalValue` s původní hodnotou z CSV.

### 5.6 Více telefonů v jednom poli

Pokud `phone` obsahuje `,` nebo `/`:

**Pořadí zpracování:**
1. **Split** podle `,` nebo `/`
2. **Trim** každého tokenu
3. **Normalizace** prvního neprázdného tokenu → primární telefon
4. **Ostatní tokeny** přidat do `notes` s prefixem `[Import: další tel. ...]`
5. **Varování** "více telefonů v jednom poli, použit první"

```
Vstup: "602111222 , 603333444"
1. Split: ["602111222 ", " 603333444"]
2. Trim:  ["602111222", "603333444"]
3. Normalizace prvního: +420602111222
4. Do notes: "[Import: další tel. +420603333444]"
```

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

> **Důležité:** Varování "adresa neúplná pro geokódování" se generuje **již při importu zákazníků** (ne až v geocoding jobu). Uživatel tak vidí problém ihned v import reportu a může data opravit.

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

#### Kolize více zákazníků

Pokud CSV řádek matchuje **více různých zákazníků** (např. email patří zákazníkovi A, telefon zákazníkovi B):

1. Vybere se match podle **nejvyšší priority** (IČO > email > phone)
2. Generuje se **varování** "Možná kolize: nalezeni různí zákazníci pro různé identifikátory"
3. Nižší priority se ignorují

> **Toto je záměrně varování, ne chyba.** Import pokračuje s matchem nejvyšší priority.

### 7.2 Pravidla pro aktualizaci (lenient)

- **Nepřepisovat** existující neprázdné hodnoty prázdnými z CSV
- **Přepisovat** jen pokud CSV pole obsahuje hodnotu (viz definice "prázdné hodnoty" v 4.1)

#### Konfliktní identifikátory

Pokud CSV obsahuje jiný identifikátor než existující zákazník v DB:

```
DB:  { email: "info@abc.cz", ico: "12345678", name: "Firma A" }
CSV: { email: "info@abc.cz", ico: "87654321", name: "Firma B" }
```

**Chování:**
1. Match proběhne přes email (priorita 2)
2. `ico` se **NEaktualizuje** (konflikt) + **varování** "Konfliktní IČO: CSV obsahuje jiné IČO než existující zákazník"
3. `name` se aktualizuje na "Firma B" (není konfliktní identifikátor)

> **Pravidlo:** Identifikátory používané pro dedup (IČO, email, phone) se při konfliktu nepřepisují – pouze varování. Ostatní pole se aktualizují normálně.

---

## 8. Report importu

### 8.1 Struktura reportu

```typescript
interface ImportReport {
  // Identifikace
  jobId: string;          // UUID import jobu
  jobType: string;        // typ importu (import.customer, import.device, ...)

  // Metadata
  filename: string;       // název importovaného souboru
  importedAt: string;     // ISO 8601 timestamp
  durationMs: number;     // doba zpracování v ms

  // Souhrnné statistiky
  totalRows: number;      // celkový počet řádků v CSV
  importedCount: number;  // úspěšně nově vytvořené záznamy
  updatedCount: number;   // aktualizované existující záznamy (upsert)
  skippedCount: number;   // přeskočené záznamy

  // Detaily problémů
  issues: ImportIssue[];
}

interface ImportIssue {
  rowNumber: number;                // číslo řádku v CSV včetně hlavičky
  level: 'info' | 'warning' | 'error';  // závažnost problému
  code: ImportIssueCode;           // strojově čitelný kód chyby
  field: string;                   // název pole, kde k problému došlo
  message: string;                 // lidsky čitelná zpráva
  originalValue?: string;          // původní hodnota z CSV (při selhání normalizace)
}
```

### 8.2 Kódy chyb (ImportIssueCode)

Každý problém má přiřazený strojově čitelný kód, který umožňuje filtrování a agregaci v UI:

| Kód | Popis | Typická úroveň |
|-----|-------|-----------------|
| `CUSTOMER_NOT_FOUND` | Zákazník s daným `customer_ref` nenalezen v databázi | error |
| `DEVICE_NOT_FOUND` | Zařízení s daným identifikátorem nenalezeno | error |
| `DUPLICATE_RECORD` | Záznam již existuje (revize se stejným zařízením a datem) | warning |
| `MISSING_FIELD` | Povinné pole chybí nebo je prázdné | error |
| `INVALID_DATE` | Datum nelze parsovat nebo je neplatné | error |
| `INVALID_VALUE` | Hodnota nesplňuje validační pravidla (telefon, e-mail, PSČ) | warning/error |
| `INVALID_STATUS` | Neplatná hodnota stavu (status) | error |
| `INVALID_RESULT` | Neplatná hodnota výsledku (result) | error |
| `DB_ERROR` | Chyba databáze při ukládání | error |
| `PARSE_ERROR` | CSV řádek nelze rozparsovat | error |
| `UNKNOWN` | Neklasifikovaná chyba | error |

### 8.3 Agregace a souhrn (ImportIssueSummary)

```typescript
interface ImportIssueSummary {
  code: ImportIssueCode;                // kód chyby
  level: 'info' | 'warning' | 'error'; // závažnost
  count: number;                        // počet výskytů
  exampleMessage: string;              // ukázková zpráva prvního výskytu
}
```

V UI se problémy agregují dle `code + level` a zobrazují jako klikatelné filtrovací tlačítka.

### 8.4 Číslování řádků

| Řádek v CSV | rowNumber | Popis |
|-------------|-----------|-------|
| Hlavička | 1 | `type;name;contactPerson;...` |
| První datový záznam | 2 | první zákazník/zařízení/... |
| Druhý datový záznam | 3 | druhý zákazník/zařízení/... |

> **Důležité:** `rowNumber` je index řádku v **původním CSV souboru včetně hlavičky**. Při hlášení "Řádek 15" jde o 15. řádek souboru = 14. datový záznam. Toto odpovídá tomu, co uživatel vidí v textovém editoru nebo Excelu.

### 8.5 Persistování reportu

Reporty se ukládají na server do souborového systému pro pozdější přístup:

- **Cesta:** `logs/import-reports/{jobId}.json`
- **Formát:** JSON (serializovaný `ImportReport`)
- **Automaticky:** Každý dokončený import (úspěšný i částečně neúspěšný) generuje report
- **ZIP import:** Každý soubor v ZIP archivu generuje samostatný report

```
logs/import-reports/
├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.json   # customers.csv
├── b2c3d4e5-f6a7-8901-bcde-f12345678901.json   # devices.csv
└── c3d4e5f6-a7b8-9012-cdef-123456789012.json   # revisions.csv
```

### 8.6 Zobrazení v UI

Report se zobrazuje v dialogovém okně `ImportReportDialog` (stránka Úlohy):

1. **Stavová lišta** – barevný indikátor (zelená = OK, žlutá = varování, červená = chyby)
2. **Souhrnné karty** – celkem řádků, importováno, aktualizováno, přeskočeno, chyby, varování
3. **Metadata** – datum importu, doba trvání
4. **Přehled problémů** – agregované kódy chyb jako klikatelné tagy (filtrování)
5. **Detail chyb** – rozbalovací tabulka s detaily:
   - Číslo řádku, úroveň (chyba/varování/info), kód, pole, zpráva, původní hodnota
   - Maximálně 200 záznamů zobrazeno najednou
   - Filtrování kliknutím na kód v přehledu

**Přístup k reportu:**
- Na stránce **Úlohy na pozadí** (Jobs)
- Tlačítko **"Zobrazit report"** u dokončených importních úloh
- Report je dostupný po dobu, co je úloha v historii (paměť) nebo z persistovaného souboru

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
customer_ref;device_type;device_name;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
```

### 11.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `customer_ref` | string | **ano** | Reference na zákazníka: IČO, email, nebo telefon (E.164) |
| `device_type` | string | **ano** | Typ zařízení (viz tabulka níže) |
| `device_name` | string | ne* | Lidský název zařízení (např. "Komín u garáže") |
| `manufacturer` | string | ne | Výrobce |
| `model` | string | ne | Model |
| `serial_number` | string | ne | Sériové číslo |
| `installation_date` | string | ne | Datum instalace (YYYY-MM-DD) |
| `revision_interval_months` | number | **ano** | Interval revizí v měsících |
| `notes` | string | ne | Poznámky |

> **\*** `device_name` je povinný pouze pokud zákazník má více zařízení stejného typu a žádné nemá `serial_number`. Viz sekce 11.6.

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

**Priorita identifikace zařízení:**

```
1. serial_number (pokud vyplněno) → jednoznačný match
2. device_name (pokud vyplněno) → match dle customer + device_type + device_name
3. device_type (pokud zákazník má POUZE JEDNO zařízení tohoto typu) → auto-match
4. Žádná shoda → vytvořit nové zařízení
```

**Pravidla:**

| Situace | Chování |
|---------|---------|
| Zákazník má 1 komín v DB, CSV obsahuje 1 komín | Auto-match (bez ohledu na `device_name`) |
| Zákazník má 2 komíny v DB, CSV obsahuje komín bez `device_name` | Nové zařízení + **varování** (viz níže) |
| Zákazník má 2 komíny v DB, CSV obsahuje komín s `device_name` | Match dle `device_name` |
| `serial_number` vyplněno | Vždy match dle serial (má přednost) |

Při duplicitě → **aktualizovat** existující záznam.

**Unikátnost názvu zařízení (bez serial):**

Pokud `serial_number` není vyplněno, považuje se kombinace `customer + device_type + device_name` za identifikátor zařízení.

- Pokud import přinese stejné `device_name` pro stejný `device_type` u stejného zákazníka → vyhodnotí se jako duplicitní zařízení a dojde k **aktualizaci** existujícího záznamu (merge)
- Porovnání `device_name` je case-insensitive po `trim()`

**Varování při chybějícím `device_name`:**

Když zákazník má více zařízení stejného typu a `device_name` chybí:
- Vytvoří se **nové zařízení**
- **Varování:** "Chybí device_name pro rozlišení zařízení stejného typu (zákazník má X zařízení typu Y)"

> **Poznámka:** Pro jednoduché případy (zákazník má jen jeden kotel, jeden komín) není `device_name` potřeba. Je nutný pouze při rozlišení více zařízení stejného typu.

### 11.7 Příklady

```csv
customer_ref;device_type;device_name;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
12345678;gas_boiler;Hlavní kotel;Vaillant;ecoTEC plus;VL123456;2023-05-15;12;
info@abc.cz;chimney;Komín u kotelny;;;;2020-01-01;24;Nerezový
info@abc.cz;chimney;Komín garáž;;;;;24;Cihlový komín
+420602123456;gas_water_heater;;Junkers;Cerapur;JK789012;2024-01-10;12;
12345678;fireplace;Krb v obýváku;Romotop;Heat 2g 59.50.01;;;36;
```

**Vysvětlení příkladů:**
- Řádek 1: Kotel s `serial_number` – `device_name` je volitelný (match přes serial)
- Řádek 2-3: Dva komíny bez serial – `device_name` je **povinný** pro rozlišení
- Řádek 4: Jediný ohřívač zákazníka – `device_name` není potřeba
- Řádek 5: Jediný krb zákazníka – `device_name` je volitelný (ale pěkný pro UX)

---

## 12. Import revizí (revisions.csv)

### 12.1 Přehled

Import historie revizí pro existující zařízení. Umožňuje importovat jak budoucí termíny, tak historické záznamy dokončených revizí.

**Prerekvizity:**
- Zařízení musí být již importována
- Propojení přes `device_ref` (sériové číslo, device_name, nebo typ zařízení)

### 12.2 Hlavička

```csv
device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings
```

### 12.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `device_ref` | string | **ano** | Reference na zařízení: `serial_number`, `device_name`, nebo `device_type` (viz 15.3) |
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
| `upcoming` | Plánovaná (výchozí) - dříve "Nadcházející" |
| `scheduled` | Naplánováno |
| `confirmed` | Potvrzeno |
| `completed` | Dokončeno - **pouze dokončené revize zakládají výpočet "po termínu"** |
| `cancelled` | Zrušeno |

**Aliasy:**
- `plánovaná`, `nadcházející`, `budoucí` → `upcoming`
- `naplánováno`, `naplánovaná` → `scheduled`
- `potvrzeno`, `potvrzená` → `confirmed`
- `dokončeno`, `dokončená`, `hotovo`, `provedeno` → `completed`
- `zrušeno`, `zrušená`, `storno` → `cancelled`

> **Změna v2.3.0:** Stav "Nadcházející" přejmenován na "Plánovaná". 
> Pouze dokončené revize (`completed`) se používají pro výpočet zpoždění ("po termínu").
> Zpoždění = (datum poslední dokončené revize + interval zařízení) < dnes.

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

**Identifikace zařízení** (viz podrobně sekce 15.3):
1. Najít zákazníka podle `customer_ref`
2. Najít zařízení podle `device_ref`:
   - Jako `serial_number`
   - Jako `device_name`
   - Jako `device_type` (pokud zákazník má jen jedno zařízení tohoto typu)
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
Komín u kotelny;info@abc.cz;2024-12-01;completed;2024-12-01;14:00;;2024-12-01T15:00:00;60;conditional;Nutné vyčištění do 3 měsíců
Komín garáž;info@abc.cz;2024-12-15;completed;;;;;passed;OK
gas_water_heater;+420602123456;2025-01-10;scheduled;2025-01-15;08:00;09:00;;;;
```

**Vysvětlení `device_ref`:**
- Řádek 1: `VL123456` = sériové číslo
- Řádek 2-3: `Komín u kotelny`, `Komín garáž` = device_name (zákazník má 2 komíny)
- Řádek 4: `gas_water_heater` = device_type (zákazník má jediný ohřívač)

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

## 14. Import pracovního deníku (work_log.csv)

### 14.1 Přehled

Import pracovního deníku – záznamy provedených i plánovaných prací u zákazníků. Každý řádek v CSV odpovídá jedné **pracovní položce** (VisitWorkItem). Řádky se stejným `customer_ref` + `scheduled_date` se automaticky seskupí do jedné **návštěvy** (Visit).

> **Změna oproti v2.x:** Soubor `visits.csv` s polem `visit_type` byl nahrazen souborem `work_log.csv` s polem `work_type`. Návštěva (Visit) je nyní kontejner pro pracovní položky – nemá vlastní typ, typ je na úrovni práce.

**Prerekvizity:**
- Zákazníci musí být již importováni
- Zařízení (volitelně) pro práce typu revize

### 14.2 Hlavička

```csv
customer_ref;scheduled_date;scheduled_time_start;scheduled_time_end;device_ref;work_type;status;result;duration_minutes;result_notes;findings;requires_follow_up;follow_up_reason
```

### 14.3 Sloupce

| Sloupec | Typ | Povinný | Popis |
|---------|-----|---------|-------|
| `customer_ref` | string | **ano** | Reference na zákazníka (IČO, email, telefon) |
| `scheduled_date` | string | **ano** | Naplánované datum návštěvy (YYYY-MM-DD) |
| `scheduled_time_start` | string | ne | Čas od (HH:MM) – na úrovni návštěvy |
| `scheduled_time_end` | string | ne | Čas do (HH:MM) – na úrovni návštěvy |
| `device_ref` | string | ne | Reference na zařízení: `serial_number`, `device_name`, nebo `device_type` (viz 15.3) |
| `work_type` | string | **ano** | Typ práce (viz tabulka) |
| `status` | string | ne | Stav návštěvy (viz tabulka), výchozí `planned` |
| `result` | string | ne | Výsledek práce (viz tabulka) |
| `duration_minutes` | number | ne | Délka trvání práce v minutách |
| `result_notes` | string | ne | Poznámky k výsledku práce |
| `findings` | string | ne | Nálezy/zjištění (např. stav zařízení) |
| `requires_follow_up` | boolean | ne | Vyžaduje následnou návštěvu (`true`/`false`) |
| `follow_up_reason` | string | ne | Důvod následné návštěvy |

### 14.4 Typy práce (work_type)

| Hodnota | Popis |
|---------|-------|
| `revision` | Revize |
| `installation` | Instalace |
| `repair` | Oprava |
| `consultation` | Konzultace |
| `follow_up` | Následná práce |

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

**Aliasy:**
- `naplánováno`, `plánováno` → `planned`
- `probíhá` → `in_progress`
- `dokončeno`, `hotovo` → `completed`
- `zrušeno` → `cancelled`
- `přeplánováno` → `rescheduled`

### 14.6 Výsledky práce (work_result)

| Hodnota | Popis |
|---------|-------|
| `successful` | Úspěšná |
| `partial` | Částečná |
| `failed` | Neúspěšná |
| `customer_absent` | Zákazník nepřítomen |
| `rescheduled` | Přeplánováno |

**Aliasy:**
- `úspěšná`, `ok` → `successful`
- `částečná` → `partial`
- `neúspěšná`, `nok` → `failed`
- `nepřítomen` → `customer_absent`
- `přeplánováno` → `rescheduled`

### 14.7 Seskupení do návštěv

Řádky se **automaticky seskupí** do návštěv podle:

```
customer_ref + scheduled_date → jedna Visit
```

Každý řádek ve skupině vytvoří jednu **pracovní položku** (VisitWorkItem) pod touto návštěvou.

**Příklad:** 3 řádky se stejným `customer_ref=12345678` a `scheduled_date=2025-01-20`:
- → Vytvoří se 1 Visit + 3 VisitWorkItem

Pole `scheduled_time_start`/`scheduled_time_end` a `status` se přebírají z **prvního řádku** skupiny (na úrovni návštěvy). Pole `work_type`, `device_ref`, `result`, `duration_minutes`, `result_notes`, `findings` jsou na úrovni jednotlivých pracovních položek.

### 14.8 Validace

- Pokud `work_type=revision` a `device_ref` je prázdné → **varování** "Revize bez zařízení"
- Pokud `status=completed` a `result` je prázdné → **varování** "Dokončená práce bez výsledku"
- `requires_follow_up` přijímá: `true`, `false`, `ano`, `ne`, `1`, `0`
- `duration_minutes` musí být kladné celé číslo (pokud vyplněno)

### 14.9 Detekce duplicit

**Duplicitní klíč pracovní položky:**

```
customer_ref + scheduled_date + work_type [+ device_ref pokud vyplněno]
```

| Situace | Klíč |
|---------|------|
| `device_ref` vyplněno | `customer + date + work_type + device` |
| `device_ref` prázdné | `customer + date + work_type` |

Při duplicitě → **aktualizovat** existující pracovní položku.

> **Omezení:** Pokud `device_ref` není vyplněno, více prací **stejného typu** v **jeden den** u **stejného zákazníka** bude považováno za duplicitní a sloučeno. Pro rozlišení použijte `device_ref`.

### 14.10 Příklady

```csv
customer_ref;scheduled_date;scheduled_time_start;scheduled_time_end;device_ref;work_type;status;result;duration_minutes;result_notes;findings;requires_follow_up;follow_up_reason
12345678;2025-01-20;09:00;12:00;VL123456;revision;completed;successful;45;Revize proběhla bez problémů;Kotel v dobrém stavu;false;
12345678;2025-01-20;09:00;12:00;Komín u kotelny;revision;completed;successful;30;OK;Čistý;false;
12345678;2025-01-20;09:00;12:00;;consultation;completed;successful;15;Poradenství k novému kotli;;false;
info@abc.cz;2025-01-22;14:00;;gas_water_heater;repair;completed;partial;60;Opraveno, ale doporučuji výměnu ventilu;Ventil opotřebený;true;Objednat nový díl a vyměnit
+420602123456;2025-01-25;10:00;11:00;JK789012;revision;planned;;;;;;;
```

**Vysvětlení:**
- Řádky 1–3: Tři práce u zákazníka `12345678` ve stejný den → **jedna návštěva** se **třemi pracovními položkami** (2× revize různých zařízení + 1× konzultace)
- Řádek 4: Oprava se zařízením identifikovaným přes `device_type` (zákazník má jediný `gas_water_heater`)
- Řádek 5: Plánovaná revize s konkrétním sériovým číslem

---

## 15. Pořadí importu a propojování záznamů

### 15.1 Povinné pořadí importu

Import musí probíhat v tomto pořadí (kvůli závislostem mezi entitami):

```
1. customers.csv     → vytvoří zákazníky
       ↓
2. devices.csv       → vytvoří zařízení (vyžaduje zákazníky)
       ↓
3. revisions.csv     → vytvoří revize / povinnosti (vyžaduje zařízení)
       ↓
4. communications.csv → vytvoří komunikace (vyžaduje zákazníky)
       ↓
5. work_log.csv      → vytvoří návštěvy + pracovní položky (vyžaduje zákazníky, volitelně zařízení)
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

Soubory `revisions.csv` a `work_log.csv` používají `device_ref` pro identifikaci zařízení.

**Pořadí vyhledávání** (v kontextu zákazníka z `customer_ref`):

```
1. serial_number  → přesná shoda se sériovým číslem
2. device_name    → shoda s názvem zařízení (viz normalizace níže)
3. device_type    → pokud zákazník má POUZE JEDNO zařízení tohoto typu
```

**Normalizace a porovnání `device_name`:**

- `device_ref` i uložené `device_name` se před porovnáním `trim()` (ořez okrajů)
- Porovnání je **case-insensitive** (např. `Komín u garáže` = `komín u garáže`)
- Neprovádí se žádné fuzzy hledání (žádné podobnosti, obsahuje, diakritika apod.) – musí jít o shodu po výše uvedené normalizaci

**Příklady:**

| `device_ref` | Interpretace |
|--------------|--------------|
| `VL123456` | Sériové číslo |
| `Komín u kotelny` | device_name |
| `chimney` | device_type (jen pokud zákazník má 1 komín) |
| `gas_boiler` | device_type (jen pokud zákazník má 1 kotel) |

**Chybové stavy:**

| Situace | Chování |
|---------|---------|
| Zákazník má 2 komíny a `device_ref=chimney` | **chyba** – nelze jednoznačně určit |
| Zákazník nemá žádný komín a `device_ref=chimney` | **chyba** – zařízení nenalezeno |
| `device_ref` neodpovídá ničemu | **chyba** – zařízení nenalezeno |

### 15.4 Chybějící reference

| Situace | Chování |
|---------|---------|
| `customer_ref` nenalezen | **chyba** – řádek se přeskočí |
| `device_ref` nenalezen (povinný) | **chyba** – řádek se přeskočí |
| `device_ref` nenalezen (volitelný) | **varování** – řádek se importuje bez vazby |

### 15.5 Doporučení pro přípravu dat

1. **Zajistěte unikátní identifikátory** – každý zákazník by měl mít alespoň IČO, email nebo telefon
2. **Pojmenujte zařízení** – používejte `device_name` pro zařízení bez sériového čísla (zejména komíny)
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
└── work_log.csv
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
customer_ref;device_type;device_name;manufacturer;model;serial_number;installation_date;revision_interval_months;notes
12345678;gas_boiler;Hlavní kotel;Vaillant;ecoTEC plus;VL-2023-001;2023-05-15;12;
12345678;chimney;Komín u kotelny;;;;2020-01-01;24;Nerezový
12345678;chimney;Komín garáž;;;;;24;Cihlový
+420602123456;gas_water_heater;;Junkers;Cerapur;;2024-01-10;12;
```

**revisions.csv:**
```csv
device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings
VL-2023-001;12345678;2024-05-15;completed;2024-05-10;09:00;;2024-05-10T10:30:00;90;passed;Bez závad
Komín u kotelny;12345678;2024-12-01;completed;;;2024-12-01T15:00:00;60;conditional;Doporučeno vyčistit
Komín garáž;12345678;2024-12-15;completed;;;;;passed;OK
gas_water_heater;+420602123456;2025-01-10;scheduled;2025-01-15;08:00;09:00;;;;;
```

**communications.csv:**
```csv
customer_ref;date;comm_type;direction;subject;content;contact_name;contact_phone;duration_minutes
12345678;2025-01-15;call;outbound;;Domluven termín revize kotle na 20.1.;Jan Novák;+420602111222;5
+420602123456;2025-01-18;note;outbound;;Zákaznice preferuje odpolední hodiny;;;
```

**work_log.csv:**
```csv
customer_ref;scheduled_date;scheduled_time_start;scheduled_time_end;device_ref;work_type;status;result;duration_minutes;result_notes;findings;requires_follow_up;follow_up_reason
12345678;2025-01-20;09:00;12:00;Hlavní kotel;revision;planned;;;;;;
12345678;2025-01-20;09:00;12:00;Komín u kotelny;revision;planned;;;;;;
+420602123456;2025-01-22;14:00;;gas_water_heater;revision;planned;;;;;;
```

---

## 16. Upřesnění a FAQ

### 16.1 customers.csv – mapování a ukládání

#### Heuristické varování vs. změna typu

Pokud `type` je prázdný a podle pravidel vyjde `person`, ale název obsahuje firemní suffix (`s.r.o.` apod.), **pouze se varuje** – typ se **nezmění**. Automatická změna by byla příliš agresivní; uživatel může typ opravit ručně.

```
name="Malá firma s.r.o.", type=(prázdné)
→ type=person + varování "Název vypadá jako firma, ale typ je person"
```

#### Prázdné name

Pokud `name` chybí, ukládá se `name=null`. **Negeneruje se placeholder** jako "(bez názvu)". Řádek je validní, pokud má alespoň email, phone, ico nebo adresu.

#### Notes a automatické doplňky (více telefonů)

Při více telefonech se další čísla přidávají do `notes` takto:

- Pokud `notes` je prázdné → text začíná přímo `[Import: další tel. ...]`
- Pokud `notes` obsahuje text → přidá se na **nový řádek** (`\n`)

```
Původní notes: "Klíče u souseda"
Po importu:    "Klíče u souseda\n[Import: další tel. +420603333444]"
```

#### phoneRaw – kdy se ukládá

`phoneRaw` se ukládá **pouze při selhání normalizace**. Při úspěchu se neukládá (pro audit existují jiné mechanismy). Slouží jako recovery field pro pozdější ruční opravu.

#### Email validace – whitespace

Provádí se pouze `trim()` **okrajů**. Whitespace uvnitř emailu se neodstraňuje – je to záměr.

- Pokud email obsahuje whitespace uvnitř (např. `jan @example.com`) → **varování** "Email obsahuje mezery" a hodnota se uloží beze změny
- Nezávisle na tom platí základní kontrola: pokud email neobsahuje `@` → **varování** "Chybí @"

> **Poznámka:** Tato validace je lenient a neblokuje import. Cílem je upozornit na pravděpodobně neplatné emaily bez destruktivních úprav.

### 16.2 Normalizace telefonů (E.164)

#### originalValue v reportu

Při selhání normalizace (neplatná délka, neznámý formát) se **vždy** uvádí `originalValue` v reportu.

#### CZ čísla s úvodní 0

Pravidlo odstranění `0` se aplikuje **pouze pokud** po odebrání vznikne přesně 9 číslic:

```
0602123456 → 602123456 (9 číslic) → +420602123456 ✓ (+ varování)
06021234   → 6021234 (7 číslic) → phone=null, phoneRaw="06021234" (+ varování)
```

#### Mapa country → calling code

Používáme knihovnu **libphonenumber-js**, která obsahuje kompletní mapu všech zemí. Pokud:

- `country` je známý ISO kód → doplní se předvolba
- `country` je neznámý → `phone=null`, `phoneRaw` s varováním

#### Více telefonů – pořadí zpracování

1. **Split** podle `,` nebo `/`
2. **Trim** každého tokenu
3. **Normalizace** prvního neprázdného tokenu
4. Ostatní do notes

```
phone="602111222 , 603333444"
→ tokeny: ["602111222", "603333444"]
→ první po trim: "602111222" → normalizace
```

### 16.3 Adresy a geokódování

#### Varování "adresa neúplná pro geokódování"

Varování se generuje **při importu** zákazníků (ne až v geocoding jobu). Uživatel tak vidí problém ihned v reportu.

#### CZ PSČ – tolerované formáty

| Vstup | Po čištění | Validace |
|-------|-----------|----------|
| `110 00` | `11000` | ✓ |
| `11000` | `11000` | ✓ |
| `1100` | `1100` | varování (není 5 číslic) |
| `11000-1234` | `110001234` | varování (není 5 číslic) |

### 16.4 Detekce duplicit a aktualizace

#### Co znamená "aktualizovat existujícího"

**Merge vybraných polí** s těmito pravidly:

1. Prázdná hodnota z CSV **nepřepisuje** existující hodnotu v DB
2. Hodnota z CSV **přepíše** existující, pokud je vyplněna
3. **Konfliktní identifikátory** (např. jiné IČO než v DB při match přes email) se **neupdatují**, pouze varování

```
DB:  { email: "info@abc.cz", ico: "12345678", name: "Firma A" }
CSV: { email: "info@abc.cz", ico: "87654321", name: "Firma B" }
→ Match přes email
→ ico se NEaktualizuje (konflikt) + varování
→ name se aktualizuje na "Firma B"
```

#### Priorita dedup – kolize více zákazníků

Pokud CSV řádek matchuje **více různých zákazníků** (např. email patří zákazníkovi A, telefon zákazníkovi B):

1. Vybere se match podle **nejvyšší priority** (IČO > email > phone)
2. Generuje se **varování** o možné kolizi
3. Nižší priority se ignorují

#### Definice "prázdné" hodnoty

V celé logice je "prázdné" sjednoceno na `null`:

- `null` → prázdné
- `""` (prázdný string) → prázdné (konvertuje se na null)
- `"   "` (whitespace) → prázdné (po trim)

### 16.5 Report importu

#### level='error' vs 'warning'

| Typ problému | Level |
|-------------|-------|
| Rozbitá CSV struktura | `error` |
| Chybějící header | `error` |
| Nevalidní telefon | `warning` |
| Nevalidní email | `warning` |
| Nevalidní PSČ | `warning` |
| Zákazník nenalezen (devices/revisions) | `error` |
| Zařízení nenalezeno (revisions) | `error` |

Pro `customers.csv` jsou prakticky všechny datové problémy **varování** (lenient režim). Chyby jsou pouze technické.

#### Row numbering

`rowNumber` je číslo řádku **včetně hlavičky**:

- Hlavička = řádek 1
- První datový záznam = řádek 2
- Druhý datový záznam = řádek 3

```
Řádek 15: [phone] Číslo nelze normalizovat
→ 15. řádek v souboru = 14. datový záznam
```

### 16.6 Další entity – propojování

#### customer_ref – telefon bez +

Pokud `customer_ref` **není** IČO (8 číslic) a **neobsahuje** `@`, pokusí se normalizace jako telefon:

```
customer_ref="602123456" → normalizace jako CZ → +420602123456 → vyhledání
customer_ref="12345678"  → IČO (8 číslic)
customer_ref="info@x.cz" → email (obsahuje @)
```

#### devices.csv – identifikace zařízení

Priorita identifikace:
1. `serial_number` (pokud vyplněno) → jednoznačný match
2. `device_name` (pokud vyplněno) → match dle `customer + device_type + device_name`
3. `device_type` (pokud zákazník má jen 1 zařízení tohoto typu) → auto-match
4. Žádná shoda → nové zařízení + varování

> **Tip:** Pro zařízení bez sériového čísla (komíny, krby) používejte `device_name` jako lidský identifikátor: "Komín u garáže", "Krb v obýváku".

#### revisions.csv – status auto-set

Pokud `result` je vyplněn → `status` se automaticky nastaví na `completed`. Pole `completed_at` se **nevyžaduje ani neodvozuje** – je volitelné.

```
result="passed", status=(prázdné) → status=completed, completed_at=null
```

#### work_log.csv – seskupení a duplicity

**Seskupení do návštěv:** Řádky se stejným `customer_ref + scheduled_date` se automaticky seskupí do jedné návštěvy (Visit). Každý řádek = jedna pracovní položka (VisitWorkItem).

**Duplicitní klíč pracovní položky:**

```
customer_ref + scheduled_date + work_type [+ device_ref pokud vyplněno]
```

- Pokud `device_ref` je vyplněno → rozlišuje práce pro různá zařízení
- Pokud `device_ref` není vyplněno → více prací stejného typu ve stejný den u stejného zákazníka se považuje za duplicitní a sloučí se

> **Doporučení:** Pokud potřebujete více samostatných prací stejného typu v jeden den, vyplňte `device_ref`.

---

## 17. Import Report System

Po dokončení každého importu (zákazníci, zařízení, revize, komunikace, pracovní deník, ZIP) systém automaticky generuje strukturovaný **Import Report**. Report obsahuje kompletní informace o průběhu importu, včetně všech chyb a varování.

### 17.1 Struktura reportu

```typescript
interface ImportReport {
  jobId: string;           // UUID importní úlohy
  jobType: string;         // Typ importu (import.customer, import.device, ...)
  filename: string;        // Název importovaného souboru
  importedAt: string;      // ISO 8601 timestamp dokončení
  durationMs: number;      // Doba trvání importu v ms
  totalRows: number;       // Celkový počet řádků v CSV
  importedCount: number;   // Počet úspěšně importovaných záznamů
  updatedCount: number;    // Počet aktualizovaných existujících záznamů
  skippedCount: number;    // Počet přeskočených záznamů
  issues: ImportIssue[];   // Seznam všech problémů
}
```

### 17.2 Struktura problému (ImportIssue)

Každý problém má strojově čitelný kód a lidsky srozumitelnou zprávu:

```typescript
interface ImportIssue {
  rowNumber: number;          // Číslo řádku v CSV (1-based, včetně hlavičky)
  level: 'error' | 'warning' | 'info';
  code: ImportIssueCode;     // Strojově čitelný kód chyby
  field: string;             // Název pole, ve kterém k chybě došlo
  message: string;           // Lidsky čitelná zpráva (česky)
  originalValue?: string;    // Původní hodnota z CSV (pokud relevantní)
}
```

### 17.3 Kódy chyb (ImportIssueCode)

| Kód | Popis | Úroveň | Příklad |
|-----|-------|--------|---------|
| `CUSTOMER_NOT_FOUND` | Reference zákazníka neodpovídá žádnému záznamu | error | `customer_ref="99999999"` nenalezen |
| `DEVICE_NOT_FOUND` | Reference zařízení neodpovídá žádnému záznamu zákazníka | error | `device_ref="SN-XXX"` nenalezen |
| `DUPLICATE_RECORD` | Záznam již existuje (stejný device_id + due_date apod.) | warning | Revize pro dané zařízení a termín již existuje |
| `MISSING_FIELD` | Povinné pole je prázdné | error | Chybí `customer_ref` nebo `due_date` |
| `INVALID_DATE` | Datum nelze rozparsovat | error | `due_date="32.13.2024"` |
| `INVALID_VALUE` | Hodnota neodpovídá očekávanému formátu/enumu | error | `device_type="neznamy_typ"` |
| `INVALID_STATUS` | Status nebyl rozpoznán (použit fallback) | warning | `status="xyz"` → fallback na default |
| `INVALID_RESULT` | Výsledek nebyl rozpoznán | warning | `result="abc"` |
| `DB_ERROR` | Neočekávaná chyba databáze | error | Constraint violation apod. |
| `PARSE_ERROR` | Řádek CSV nelze přečíst | error | Špatný počet sloupců |
| `UNKNOWN` | Neznámá chyba | error | Catch-all pro nezařaditelné chyby |

### 17.4 Persistece reportů

Reporty se ukládají jako JSON soubory do adresáře:

```
logs/import-reports/{jobId}.json
```

Každý soubor obsahuje kompletní `ImportReport` ve formátu JSON. Reporty jsou přístupné:

1. **V reálném čase** — po dokončení importu je report odeslán přes NATS jako součást `Completed` statusu
2. **Na stránce Úlohy** — tlačítko "Zobrazit report" u dokončených import úloh
3. **Jako JSON soubor** — v adresáři `logs/import-reports/` pro archivaci a audit

### 17.5 Zobrazení reportu v UI

Import Report Dialog zobrazuje:

- **Status bar** — zelený (úspěch), žlutý (varování), červený (chyby)
- **Souhrn** — celkem řádků, importováno, aktualizováno, přeskočeno, chyby, varování
- **Přehled problémů** — agregované počty podle kódu chyby (kliknutím filtruje detail)
- **Detail chyb** — rozbalovací tabulka s řádkem, typem, kódem, polem a zprávou (max 200 řádků)

### 17.6 Zpracování duplicit

Import revizí kontroluje existující záznamy pomocí klíče `(device_id, due_date)`:

- Pokud revize pro dané zařízení a termín **již existuje**, řádek se přeskočí a zapíše se **warning** s kódem `DUPLICATE_RECORD`
- Tím se eliminují chyby z opakovaného importu stejných dat
- Zákazník vidí přesný počet skutečně nových záznamů vs. přeskočených duplicit

### 17.7 ZIP import

Při importu ze ZIP archivu se generuje report pro **každý soubor** zvlášť. Na stránce Úlohy se zobrazuje sloučený report ze všech souborů v archivu.

### 17.8 Datový tok

```
CSV soubor → Parsování → Řádek po řádku zpracování
                              ↓
                    Úspěch → importedCount++
                    Chyba  → failed++, issues.push(ImportIssue)
                    Duplicita → skippedCount++, issues.push(warning)
                              ↓
                    build_import_report() → ImportReport
                              ↓
                    ┌─ persist_report() → logs/import-reports/{id}.json
                    ├─ NATS publish → Completed { report: ImportReport }
                    └─ JOB_HISTORY.record_completed()
                              ↓
                    Frontend activeJobsStore → report field
                              ↓
                    ImportReportDialog (Jobs page)
```

---

## 18. Export+ (asynchronní ZIP export přes worker)

Export je zpracováván asynchronně na workeru přes JetStream, nikoliv synchronně v UI vlákně:

- Submit: `sazinka.export.submit`
- Download: `sazinka.export.download`
- Queue stream: `SAZINKA_EXPORT_JOBS`
- Status topic: `sazinka.job.export.status.{jobId}`

### 18.1 Podporované exportní soubory

- `customers.csv`
- `devices.csv`
- `revisions.csv`
- `communications.csv`
- `work_log.csv`
- `routes.csv` (export-only)
- (interně i `route_stops.csv` v ZIP podle scope)

### 18.2 Scope režimy exportu

- `customer_only`
- `all_workers_combined` (sjednocené soubory, `worker_uuid` ve všech řádcích)
- `all_workers_split` (oddělené soubory prefixované `worker_uuid`)
- `single_worker`

### 18.3 UX v aplikaci

- Export se zakládá v Settings/Admin přes `ExportPlusPanel`.
- Stav exportu je viditelný na stránce `Úlohy` (`/jobs`).
- Po dokončení:
  - uživatel může stahovat výsledek přímo tlačítkem `Stáhnout export` v historii úloh,
  - a zároveň může dostat browser notifikaci při doběhnutí úlohy.
- Název výsledného ZIP: `export-YYYYMMDD-HHMMSS-XX.zip` (čas je generován podle timezone uživatele, který export spustil).
