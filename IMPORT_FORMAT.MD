# CSV Import zákazníků – Specifikace (v1.0.1)

> **Verze:** 1.0.1  
> **Datum:** 2026-01-27

## Obsah

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
