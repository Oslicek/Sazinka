# Sazinka - Workflow & UI Koncept

> **Status:** MVP kompletní + Phase 7 plánována  
> **Verze:** 0.5  
> **Datum:** 2026-02-05
> 
> **Implementováno:**
> - ✅ Fronta k obvolání (`/queue`) - filtry, statistiky, akce
> - ✅ Dialog pro plánování návštěvy (datum, časové okno, délka)
> - ✅ Dialog pro odložení (snooze)
> - ✅ Kalendář - přepínač Termíny/Naplánované
> - ✅ **Plán dne** (`/planner`) - sloučená stránka Plánování + Můj den:
>   - Mapa s trasou + statistiky
>   - Seznam zastávek s akcemi (navigovat, volat, hotovo)
>   - Google Maps export (single + segmented)
>   - Tisk/PDF
>   - Náhled fronty k obvolání
> - ✅ Smart Slots - inteligentní návrhy časových slotů podle existující trasy
> - ✅ Detail revize (`/revisions/:id`) - workflow hub
> - ✅ Dashboard - clickable stats, CTA fronta k obvolání
> 
> **Změny v navigaci:**
> - `/planner` → "Plán dne" (sloučeno Plánování + Můj den)
> - `/today` → přesměrování na `/planner`
> - Navigační položka "Můj den" odstraněna

## Přehled

Tento dokument popisuje workflow a UI koncept pro klíčovou část aplikace Sazinka - plánování pravidelných revizí a návštěv u zákazníků.

### Cílová skupina
- Drobní řemeslníci (kominíci, plynaři, revizní technici)
- Pravidelné revize v intervalech 11-12 měsíců
- Jedna nebo více posádek, jedno nebo více dep
- Dispečerka + technici NEBO řemeslník sám

---

## Základní architektura

Aplikace má **3+1 vrstvy práce**:

```
┌─────────────────────────────────────────────────────────────────┐
│  1. CO SE BLÍŽÍ                                                  │
│     Automaticky spočítané "due window" (11-12 měsíců od revize) │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. DOMLUVIT                                                     │
│     Call workflow → vybrat termín + časové okno + službu        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. NAPLÁNOVAT DEN                                               │
│     Route planner → optimalizace pořadí + časová okna + depa    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. DEN VÝJEZDU (operativa)                                      │
│     Rychlé úpravy, přesuny, export trasy                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Workflow krok za krokem

### 1. Po dokončení revize → automatická další revize

Když technik označí revizi jako "Hotovo":

1. Uložit `lastServiceAt` (datum dokončení)
2. Spočítat `nextDueFrom = lastServiceAt + 11 měsíců`
3. Spočítat `nextDueTo = lastServiceAt + 12 měsíců`
4. Vytvořit novou revizi se stavem "čeká na kontakt"

**UI - Detail zákazníka:**

```
┌─────────────────────────────────────────────────┐
│ 🏠 Jan Novák                                    │
│ Revize plynového kotle                          │
├─────────────────────────────────────────────────┤
│ Poslední revize: 15.01.2026 (kotel)            │
│ Další revize:    10.12.2026 – 15.01.2027       │
│ Stav:            ⏳ Čeká na kontakt             │
├─────────────────────────────────────────────────┤
│ [📞 Zavolat]  [📅 Domluvit]                    │
└─────────────────────────────────────────────────┘
```

---

### 2. Fronta k obvolání

Hlavní pracovní obrazovka pro dispečerku i řemeslníka-sólistu.

**Zobrazení:**
- Zákazníci v okně 11-12 měsíců od poslední revize
- Zákazníci po termínu (prioritně nahoře)

**Filtry:**
- Oblast (město/PSČ/region)
- Typ služby (kotel, komín, plyn...)
- Depo/posádka
- Priorita
- "Nevolat dopoledne" a podobné preference

**Informace u každého zákazníka:**
1. Kde je zákazník (adresa + mini mapa / region)
2. Jak dlouho trvá úkon (servisní čas)
3. Stav kontaktu (naposledy voláno, poznámka)

**UI - Fronta k obvolání:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📋 Fronta k obvolání                    [Filtr ▾] [Oblast ▾]       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ 🔴 PO TERMÍNU (3)                                                   │
│ ├── Karel Svoboda    │ Brno-střed  │ Kotel 45min │ ☎️ 3x neúspěšně │
│ ├── Marie Dvořáková  │ Brno-sever  │ Komín 30min │ ☎️ Nezvedá      │
│ └── Petr Černý       │ Blansko     │ Kotel 45min │ ☎️ Nevoláno     │
│                                                                     │
│ 🟡 TENTO TÝDEN (8)                                                  │
│ ├── Jana Nováková    │ Vyškov      │ Kotel 45min │ ☎️ Nevoláno     │
│ ├── ...                                                             │
│                                                                     │
│ 🟢 PŘÍŠTÍ TÝDEN (12)                                                │
│ └── ...                                                             │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Celkem: 23 zákazníků k obvolání                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 3. Domluva návštěvy (klíčová obrazovka)

**Zásadní princip:** Při domluvě nesmíš vybírat sloty naslepo. Nabídka termínů musí odrážet realitu trasy.

**UI - Dialog "Domluvit návštěvu":**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📅 Domluvit návštěvu                                         [✕]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ZÁKAZNÍK                                                            │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Jan Novák                                                       │ │
│ │ Lesní 123, Brno 61500                                          │ │
│ │ 📞 +420 777 123 456                                             │ │
│ │ ⚠️ Poznámka: Parkovat za domem, zvonek nefunguje               │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ TYP ÚKONU                           DÉLKA                          │
│ [Revize kotle      ▾]               [45 min ▾]                     │
│                                                                     │
│ KDO POJEDE                          DEPO                           │
│ [Technik 1 - Petr  ▾]               [Brno-střed ▾]                 │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ VÝBĚR DNE                                                          │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │  Po    Út    St    Čt    Pá    So    Ne                        │ │
│ │  27    28    29    30    31     1     2                        │ │
│ │  [3]   [5]   [2]  [🔵4]  [6]   [-]   [-]                       │ │
│ │                    ↑ vybraný den                                │ │
│ │  (čísla = počet volných slotů)                                 │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ DOPORUČENÉ SLOTY PRO 30.01.2026                                    │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ⭐ 10:15 - 11:00  │ Nejlepší pro trasu │ +0 min      │ [Vybrat]│ │
│ │    08:30 - 09:15  │ Ranní slot         │ +8 min      │ [Vybrat]│ │
│ │    13:45 - 14:30  │ Po obědě           │ +12 min     │ [Vybrat]│ │
│ │    15:30 - 16:15  │ Odpolední          │ +18 min     │ [Vybrat]│ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ NEBO VLASTNÍ ČAS                                                   │
│ [Časové okno: ___:___ - ___:___]  ⚠️ +25 min navíc k trase        │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Zrušit]  [✓ Domluvit návštěvu]       │
└─────────────────────────────────────────────────────────────────────┘
```

**Algoritmus nabídky slotů:**

Aplikace v pozadí:
1. Vezme již domluvené zakázky v ten den pro vybraný vůz
2. Vypočte odhad příjezdu a dopad na trasu
3. Nabídne 3-5 nejlepších slotů:
   - "Nejbližší k trase" (minimální objížďka)
   - "Nejkratší celková cesta"
   - "Bez rizika zpoždění"

Každý slot ukazuje:
- Předpokládaný čas příjezdu (např. 10:20)
- Servis do (např. 11:05)
- Dopad na trasu ("+12 min" nebo "−5 min")

---

### 4. Plánování dne (dispečerský pohled)

Zde se skládá denní plán a řeší multi-car a depa.

**UI - Plánovač dne:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📅 Plán dne: 30.01.2026              [◀ Předchozí] [Další ▶]               │
├─────────────────────────────────────────────────────────────────────────────┤
│ [Technik 1 - Petr]  [Technik 2 - Jan]  [+ Přidat posádku]                  │
├────────────────────────┬────────────────────────────────────────────────────┤
│ ZASTÁVKY (9)           │                    MAPA                            │
│ ┌────────────────────┐ │  ┌────────────────────────────────────────────┐   │
│ │ 🏠 Depo Brno       │ │  │                                            │   │
│ │    Start 08:00     │ │  │         🏠                                 │   │
│ ├────────────────────┤ │  │          ╲                                 │   │
│ │ 1. Jan Novák       │ │  │           ╲  ①                            │   │
│ │    08:27 - 09:12   │ │  │            ╲──●                            │   │
│ │    ⏱️ 45min │ 🔒    │ │  │               ╲                           │   │
│ ├────────────────────┤ │  │                ╲  ②                       │   │
│ │ 2. Marie Svobodová │ │  │                 ●──╲                       │   │
│ │    09:35 - 10:05   │ │  │                      ╲  ③                  │   │
│ │    ⏱️ 30min        │ │  │                       ●                    │   │
│ ├────────────────────┤ │  │                      ╱                     │   │
│ │ 3. Petr Černý      │ │  │                    ╱                       │   │
│ │    10:28 - 11:13   │ │  │                  🏠                        │   │
│ │    ⏱️ 45min │ ⚠️    │ │  │                                            │   │
│ │    Riziko zpoždění │ │  │                                            │   │
│ ├────────────────────┤ │  └────────────────────────────────────────────┘   │
│ │ ...                │ │                                                    │
│ ├────────────────────┤ │  STATISTIKY                                       │
│ │ 🏠 Depo Brno       │ │  ┌────────────────────────────────────────────┐   │
│ │    Návrat ~16:30   │ │  │ Celková vzdálenost:  87 km                 │   │
│ └────────────────────┘ │  │ Celkový čas:         6h 45min              │   │
│                        │  │ Servisní čas:        5h 15min              │   │
│ [↻ Re-optimalizovat]   │  │ Čas na cestě:        1h 30min              │   │
│ [+ Přidat zastávku]    │  │ Konflikty:           1 ⚠️                   │   │
│                        │  └────────────────────────────────────────────┘   │
└────────────────────────┴────────────────────────────────────────────────────┘
```

**Interakce:**
- Drag & drop pro změnu pořadí zastávek
- "Re-optimalizovat" tlačítko (zachová domluvená okna)
- "Zamknout pořadí" 🔒 pro citlivé zakázky
- Přetáhnout zakázku mezi auty (multi-car režim)

**Varování (musí být velmi viditelná):**
- 🔴 Časové okno nestíhá vyjít
- 🟡 Riziko zpoždění (trasa natěsno)
- 🟠 Přejezd příliš dlouhý
- ⚫ Překročení pracovní doby

---

### 5. Den výjezdu (operativa + export)

Bez mobilní aplikace potřebuje technik jednoduché webové rozhraní.

**UI - Můj dnešní plán:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📱 Můj plán na 30.01.2026                        [🔄] [📤 Export]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ① Jan Novák                                    08:27 - 09:12   │ │
│ │    Lesní 123, Brno                                              │ │
│ │    📞 +420 777 123 456                                          │ │
│ │    Revize kotle │ 45 min                                        │ │
│ │    ⚠️ Parkovat za domem                                         │ │
│ │    ──────────────────────────────────────────────────────────── │ │
│ │    [🗺️ Navigovat]  [📞 Volat]  [✓ Hotovo]  [✕ Nezastižen]      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ② Marie Svobodová                              09:35 - 10:05   │ │
│ │    Hlavní 45, Brno-sever                                        │ │
│ │    📞 +420 608 234 567                                          │ │
│ │    Vymetání komínu │ 30 min                                     │ │
│ │    ──────────────────────────────────────────────────────────── │ │
│ │    [🗺️ Navigovat]  [📞 Volat]  [✓ Hotovo]  [✕ Nezastižen]      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ... další zastávky ...                                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Hotovo: 0/9  │  Zbývá: ~6h 45min  │  Další: Jan Novák za 15 min   │
└─────────────────────────────────────────────────────────────────────┘
```

**Exporty:**
- "Otevřít trasu v Google Maps" (waypoints, při limitu rozdělit)
- PDF "denní plán" (adresa, okno, poznámky, telefon)
- CSV export (pro vlastní navigaci / archiv)

---

## Role a režimy použití

### Režim A: Dispečerka + 1-N aut

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dispečerka    │     │   Technik 1     │     │   Technik 2     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ • Fronta        │     │ • Můj plán      │     │ • Můj plán      │
│ • Domluva       │────▶│ • Status update │     │ • Status update │
│ • Plánování     │     │ • Export        │     │ • Export        │
│ • Přehledy      │     └─────────────────┘     └─────────────────┘
└─────────────────┘
```

### Režim B: Řemeslník sám

```
┌─────────────────────────────────────┐
│         Řemeslník (vše sám)         │
├─────────────────────────────────────┤
│ • Fronta + mini plánování v jednom  │
│ • "Můj plán" jako výchozí homepage  │
│ • Domluva s automatickými sloty     │
└─────────────────────────────────────┘
```

---

## Klíčové datové entity

| Entita | Popis | Klíčové atributy |
|--------|-------|------------------|
| Customer | Zákazník | adresa, GPS, kontakt, poznámky |
| Device | Zařízení k revizi | typ, revision_interval_months |
| Revision | Plánovaná/provedená revize | due_date, scheduled_date, time_window, status |
| Crew | Posádka/technik | depot_id, kapacita, pracovní doba |
| Depot | Výchozí místo | adresa, GPS |
| Route | Denní plán | datum, crew_id, zastávky[], statistiky |

---

## Stavy revize (lifecycle)

```
                    ┌──────────────┐
                    │   VYTVOŘENO  │
                    │ (automaticky)│
                    └──────┬───────┘
                           │
                           ▼
┌──────────────┐    ┌──────────────┐
│   ODLOŽENO   │◄───│   ČEKÁ NA    │
│              │    │   KONTAKT    │
└──────────────┘    └──────┬───────┘
       │                   │ zákazník kontaktován
       │                   ▼
       │           ┌──────────────┐
       └──────────▶│  DOMLUVENO   │
                   │ (má termín)  │
                   └──────┬───────┘
                          │ přiřazeno do trasy
                          ▼
                   ┌──────────────┐
                   │ NAPLÁNOVÁNO  │
                   │ (v trase)    │
                   └──────┬───────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ HOTOVO   │  │NEZASTIŽEN│  │ ZRUŠENO  │
     │          │  │          │  │          │
     └────┬─────┘  └──────────┘  └──────────┘
          │
          │ automaticky
          ▼
     ┌──────────┐
     │  DALŠÍ   │
     │ REVIZE   │
     └──────────┘
```

---

## Dvě UX věci, které udělají největší rozdíl

### 1. Nabídka slotů při domluvě
Ne "vyberte si datum a čas naslepo", ale inteligentní návrhy na základě aktuální trasy.

### 2. Jedno kliknutí: z domluvy do plánu
A hned vidět dopad na trasu (vzdálenost, čas, konflikty).

---

## Plán integrace UI podle workflow

Cíl: Uživatel nesmí "přeskakovat" mezi izolovanými stránkami. Každá obrazovka musí nabídnout jasný další krok a kontext.

### Globální pravidla navigace
- Vždy viditelné CTA pro další krok workflow (napravo nahoře / v detail panelu).
- Každá revize/zákazník má dostupné akce: `Detail`, `Domluvit`, `Naplánovat`, `Označit hotovo` podle stavu.
- Zobrazení kontextu: u každé revize vždy zobrazit zákazníka, adresu, termín a stav.

### Stránky a jejich propojení (MVP plán)
1. Dashboard
   - CTA: "Fronta k obvolání" (primární), "Plánování dne" (sekundární), "Můj den".
   - Widgety "Po termínu" a "Tento týden" musí být klikatelné → filtr na frontu nebo kalendář.

2. Fronta k obvolání (`/queue`)
   - Akce "Naplánovat" po uložení přesměruje do Plánovače na vybraný den.
   - Přidat proklik na `Detail zákazníka` a `Detail revize`.
   - V kartě ukázat poslední komunikaci a poznámku (z timeline).

3. Kalendář (`/calendar`)
   - Klik na revizi vede na `Detail revize` (ne pouze seznam).
   - V detail panelu CTA: "Otevřít v plánovači" + "Domluvit" (pokud nemá termín).
   - Přepínač Termíny/Naplánované zachovat, ale doplnit legendu pro stav workflow.

4. Plánovač (`/planner`)
   - V seznamu "Naplánované" zobrazit jméno zákazníka + adresu + časové okno.
   - Klik na položku → detail revize (nebo side panel).
   - Tlačítko "Přidat z fronty" (kontextový filtr na datum).

5. Detail revize (nový cílový kontext)
   - Centrální hub: status, termín, poznámky, akce podle stavu.
   - Odkazy: zákazník, komunikace, návštěvy, plán dne.

#### Detail revize - struktura stránky (workflow hub)

**Cíl:** Jeden pohled pro všechny kroky workflow. Uživatel vidí kontext + další akci bez hledání.

**1) Sticky header**
- Název: `Revize - [typ zařízení]`
- Status badge: `Čeká na kontakt / Domluveno / Naplánováno / Hotovo / Zrušeno`
- Klíčové info: `Termín`, `Časové okno`, `Délka`, `Technik/posádka`
- Primární CTA (context-aware):
  - Čeká na kontakt → `Domluvit termín`
  - Domluveno → `Otevřít v plánovači (den)`
  - Naplánováno → `Otevřít v plánovači (den)`
  - Hotovo → `Zobrazit výsledek`
- Sekundární akce (menu): `Přeplánovat`, `Odložit`, `Zrušit`

**2) Kontekt zákazníka (card)**
- Jméno, adresa, poznámka
- Kontakty: `📞 Zavolat`, `✉️ Email`
- CTA: `Otevřít zákazníka`
- Mini mapa (pokud existuje)

**3) Detail revize (card)**
- Zařízení: typ, název, interval, poslední revize
- Termín: datum + časové okno + délka
- Přiřazení: technik/posádka/depo (pokud existuje)
- CTA: `Otevřít zařízení`

**4) Workflow panel (pravý sloupec / side panel)**
- Kontextové akce dle stavu:
  - Čeká na kontakt: `Domluvit`, `Odložit`, `Zavolat`
  - Domluveno: `Přeplánovat`, `Otevřít v plánovači`, `Zrušit`
  - Naplánováno: `Otevřít v plánovači`, `Přesun v trase` (pokud existuje)
  - Hotovo: `Zobrazit výsledek`, `Vytvořit další revizi` (pokud se dělá ručně)
- Text "Další krok": např. `Další krok: naplánovat den`

**5) Historie a komunikace (timeline)**
- Komunikace (hovory, emaily, poznámky)
- Návštěvy (visit log)
- Rychlé přidání komunikace

**6) Operativa (volitelné)**
- `Tisk / PDF / Export`
- `Navigovat` (single-stop, pro technika)

#### Detail revize - wireframe (ASCII)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Revize - Plynovy kotel          [STATUS: DOMLUVENO]   [Domluvit termín]    │
│ Termín: 30.01.2026  |  Okno: 10:00-11:00  |  Délka: 45 min  |  Technik: A  │
│ [Přeplánovat] [Odložit] [Zrušit]                                             │
└────────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────┐  ┌─────────────────────────────┐
│ ZAKAZNIK                                  │  │ WORKFLOW                     │
│ Jan Novak                                 │  │ Další krok: naplánovat den   │
│ Lesni 123, Brno                           │  │                             │
│ Pozn.: Parkovat za domem                  │  │ [Otevřít v plánovači (den)]  │
│ [📞 Zavolat] [✉️ Email] [Detail zákazníka]│  │ [Přeplánovat] [Zrušit]        │
│ [Mini mapa]                               │  │                             │
└───────────────────────────────────────────┘  └─────────────────────────────┘

┌───────────────────────────────────────────┐  ┌─────────────────────────────┐
│ REVIZE                                    │  │ HISTORIE / KOMUNIKACE        │
│ Zařízení: Kotel ABC-123                   │  │ - 20.01: Voláno, nezastižen  │
│ Interval: 12 měsíců                       │  │ - 25.01: Email o termínu     │
│ Poslední revize: 15.01.2026               │  │ [Přidat záznam]               │
│ [Detail zařízení]                         │  │                             │
└───────────────────────────────────────────┘  └─────────────────────────────┘
```

6. ~~Můj den (`/today`)~~ → **SLOUČENO DO PLÁN DNE (`/planner`)**
   - `/today` nyní přesměrovává na `/planner`
   - Všechny funkce (navigace, volání, hotovo) jsou v Plán dne

### Minimální integrační checklist ✅ COMPLETE
- [x] Zavést `Detail revize` jako primární uzel workflow ✅
- [x] Přidat prokliky mezi Fronta → Detail → Plán dne ✅
- [x] Všechny seznamy revizí zobrazují zákazníka a akci ✅
- [x] Dashboard a Kalendář mají přímý vstup do fronty/planování ✅
- [x] Po naplánování automatický návrat do kontextu (plán dne) ✅
- [x] Sloučit Plánování + Můj den do jedné stránky "Plán dne" ✅

---

## Rozhodnutí a mapování na existující model

### 1. Entity mapping (ROZHODNUTO)

| Navržená entita | Existující entita | Poznámka |
|-----------------|-------------------|----------|
| Asset | `Device` | ✅ Přímé mapování |
| ServiceCycle | Logika v `Device` + `Revision` | Není potřeba nová tabulka |
| Job | `Revision` | ✅ Revision = co je potřeba udělat |
| Appointment | `Revision` | ✅ Revision = kdy se to má udělat |
| Visit | `Visit` | ✅ Historický záznam provedení |

**Klíčové rozhodnutí:** Nezavádět nové entity Job/Appointment. `Revision` pokrývá obojí:
- `scheduled_date IS NULL` → backlog / čeká na kontakt
- `scheduled_date IS NOT NULL` → appointment / domluveno

### 2. Stavy revize (ROZHODNUTO)

**Zachovat existující enum, přidat odvozené stavy logikou:**

| UX stav | Mapování | Implementace |
|---------|----------|--------------|
| Plánovaná (dříve Nadcházející) | `upcoming` | `status='upcoming' AND scheduled_date IS NULL` |
| Domluveno | `scheduled` | `status='scheduled'` (má termín, nepotvrzeno) |
| Potvrzeno | `confirmed` | `status='confirmed'` |
| Naplánováno v trase | `confirmed` | + `route_order IS NOT NULL` |
| Dokončeno | `completed` | `status='completed'` - **pouze dokončené revize zakládají výpočet "po termínu"** |
| Odloženo | `upcoming` | + nové pole `snooze_until` |
| Zrušeno | `cancelled` | `status='cancelled'` |

> **Změna v0.16.0:** Stav "Nadcházející" přejmenován na "Plánovaná" (lépe vystihuje význam).
> Pouze dokončené revize (`status='completed'`) se používají pro výpočet zpoždění.
> Zpoždění = (last_completed_at + interval_months) < today.
> Pro zařízení bez provedené revize se použije installation_date jako základ.

**Nová pole pro Revision (schema change):**
```sql
ALTER TABLE revisions ADD COLUMN snooze_until DATE;
ALTER TABLE revisions ADD COLUMN snooze_reason VARCHAR(255);
ALTER TABLE revisions ADD COLUMN assigned_crew_id UUID REFERENCES crews(id);
ALTER TABLE revisions ADD COLUMN route_order INTEGER;
```

### 3. Algoritmus nabídky slotů (ROZHODNUTO)

**Insertion Heuristic s Valhalla cache:**

```
1. Pro zvolený den + posádku načti existující trasu:
   Depot → A → B → C → Depot

2. Pro nového zákazníka X zkus vložit mezi každou dvojici:
   - mezi Depot/A, A/B, B/C, C/Depot

3. Spočítej delta travel time:
   Δ = t(A,X) + t(X,B) - t(A,B)

4. Simuluj forward pass pro feasibility:
   - arrival/departure times
   - ověř časová okna (hard constraint)

5. Skóre kandidáta:
   - 60% Δ travel time (nižší = lepší)
   - 25% slack (více = lepší)
   - 15% area coherence (volitelné)

6. Vyber top 3-5 slotů, diverzifikuj časy
```

**Výkon s Valhalla:**
- Cache travel times mezi existujícími body dne
- Pro nový bod X dopočítat pouze: `t(X, všichni)` a `t(všichni, X)`

### 4. Multi-crew a multi-depot (ROZHODNUTO)

**MVP:**
- `Crew.home_depot_id` = default start/end
- `Crew.preferred_area` = seznam PSČ prefixů / okresů
- Ruční přiřazení + jednoduché regiony
- UI: zobrazit "Day load" per posádka

**V2:**
- Clustering zakázek do N clusterů (N = počet posádek)
- Auto-balance load mezi posádkami
- `RoutePlan.start_depot_id`, `RoutePlan.end_depot_id` pro přepsání

### 5. Export Google Maps (ROZHODNUTO)

**Segmentace trasy:**
- Rozdělit na segmenty po 8-10 zastávkách
- Generovat 2-5 odkazů: "Trasa 1/4", "Trasa 2/4"...
- Každý odkaz otevře Google Maps s částí dne

**Fallback:**
- PDF / tisk (seznam adres + tel + okna)
- KML/GPX export pro jiné navigace
- "Navigovat" tlačítko per zastávka (jednobodově, bez limitů)

---

## MVP Implementační plán

### Fáze 1: Základní infrastruktura (1-2 týdny)

**DB změny:**
```sql
-- Rozšíření revisions
ALTER TABLE revisions ADD COLUMN snooze_until DATE;
ALTER TABLE revisions ADD COLUMN snooze_reason VARCHAR(255);
ALTER TABLE revisions ADD COLUMN assigned_crew_id UUID;
ALTER TABLE revisions ADD COLUMN route_order INTEGER;

-- Nová tabulka crews (pokud neexistuje)
CREATE TABLE crews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  home_depot_id UUID REFERENCES depots(id),
  preferred_areas TEXT[], -- PSČ prefixy
  working_hours_start TIME DEFAULT '08:00',
  working_hours_end TIME DEFAULT '17:00',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Backend:**
- [ ] Migration pro nová pole
- [ ] CRUD pro Crew entity
- [ ] Endpoint: `revision.queue` - fronta k obvolání

### Fáze 2: Fronta k obvolání (1 týden)

**Endpoint:** `GET /api/revisions/queue`
```typescript
interface QueueFilters {
  status: 'overdue' | 'due_soon' | 'upcoming';
  area?: string;      // PSČ prefix
  deviceType?: string;
  crewId?: string;
}

interface QueueItem {
  revision: Revision;
  customer: Customer;
  device: Device;
  daysUntilDue: number;
  lastContactAt?: Date;
  contactAttempts: number;
}
```

**UI komponenty:**
- [ ] `CallQueue` - seznam s filtry
- [ ] `QueueItem` - karta zákazníka
- [ ] Quick actions: Zavolat, Odložit, Domluvit

### Fáze 3: Domluva revize (1-2 týdny)

**Endpoint:** `POST /api/revisions/{id}/schedule`
```typescript
interface ScheduleRequest {
  scheduledDate: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  serviceDuration: number;
  crewId?: string;
  notes?: string;
}
```

**UI komponenty:**
- [ ] `ScheduleRevisionDialog` - modal pro domluvu
- [ ] Kalendář s počtem volných slotů per den
- [ ] Seznam časových oken (zatím bez smart slotů)

### Fáze 4: Plán dne - základní (1-2 týdny)

**Endpoint:** `GET /api/routes/{date}/{crewId}`
```typescript
interface DayPlan {
  date: string;
  crew: Crew;
  stops: PlannedStop[];
  totalDistance: number;
  totalDuration: number;
  warnings: RouteWarning[];
}
```

**UI komponenty:**
- [ ] `DayPlanner` - dispečerský pohled
- [ ] Drag & drop pořadí zastávek
- [ ] Mapa s trasou (existující)
- [ ] Základní varování konfliktů

### Fáze 5: Můj dnešní plán (1 týden)

**UI komponenty:**
- [ ] `TechnicianDayView` - mobilní-friendly seznam
- [ ] Per-stop akce: Navigovat, Volat, Hotovo, Nezastižen
- [ ] Export: segmentované Google Maps linky
- [ ] PDF export

### Fáze 6 (V2): Smart sloty (2-3 týdny)

**Backend:**
- [ ] Insertion heuristic algoritmus
- [ ] Valhalla matrix cache per den/posádka
- [ ] Endpoint: `GET /api/slots/suggest`

**UI:**
- [ ] Zobrazení doporučených slotů v `ScheduleRevisionDialog`
- [ ] Vizualizace dopadu na trasu (+X min)

---

## API Endpointy (přehled)

| Endpoint | Metoda | Popis |
|----------|--------|-------|
| `/api/revisions/queue` | GET | Fronta k obvolání |
| `/api/revisions/{id}/schedule` | POST | Domluvit termín |
| `/api/revisions/{id}/snooze` | POST | Odložit revizi |
| `/api/crews` | CRUD | Správa posádek |
| `/api/routes/{date}` | GET | Plán dne (všechny posádky) |
| `/api/routes/{date}/{crewId}` | GET | Plán dne (konkrétní posádka) |
| `/api/routes/{date}/{crewId}/reorder` | POST | Změna pořadí |
| `/api/routes/{date}/{crewId}/optimize` | POST | Re-optimalizace |
| `/api/slots/suggest` | POST | Doporučené sloty (V2) |
| `/api/export/googlemaps/{date}/{crewId}` | GET | Google Maps linky |
| `/api/export/pdf/{date}/{crewId}` | GET | PDF export |

---

## Shrnutí klíčových rozhodnutí

| Oblast | Rozhodnutí |
|--------|------------|
| Entity | Nezavádět Job/Appointment, `Revision` je obojí |
| Stavy | Zachovat enum, „čeká na kontakt" = derived, „odloženo" = snooze_until |
| Sloty | Insertion heuristic + Valhalla cache (V2) |
| Multi-crew | MVP = ruční + PSČ regiony, V2 = clustering |
| Export | Segmentované Google Maps (8-10 bodů) + PDF |
| MVP pořadí | Queue → Schedule → DayPlan → TechView |

---

## Další kroky

1. [x] ~~Získat odpovědi na otevřené otázky~~
2. [x] ~~Namapovat na existující datový model~~
3. [ ] Schválit implementační plán
4. [ ] DB migrace pro nová pole
5. [ ] Implementace Fáze 1-5 (MVP)
6. [ ] Testování s reálnými daty
7. [ ] Implementace Fáze 6 (Smart sloty)

---

## Jobs Dashboard (Phase 7D)

> **Status:** Planned (Phase 7)
> **Umístění:** `/admin/jobs` (součást Admin sekce)

### Účel

Centralizovaný monitoring všech asynchronních úloh zpracovávaných přes JetStream:
- Geocoding (Nominatim)
- Routing (Valhalla)
- Importy/Exporty
- Email/SMS (budoucí)

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SAZINKA              Zákazníci  Plán dne  Kalendář  Fronta  Admin         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─ Jobs Dashboard ───────────────────────────────────────────────────────┐ │
│  │                                                                         │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │ │
│  │  │ Ve frontě   │ │ Zpracování  │ │ Dokončeno   │ │ Selhalo     │      │ │
│  │  │     12      │ │      3      │ │    1,247    │ │      5      │      │ │
│  │  │   ○ ○ ○     │ │   ● ● ●     │ │   ✓ ✓ ✓     │ │   ✗ ✗       │      │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │ │
│  │                                                                         │ │
│  │  ┌─ Aktivní úlohy ────────────────────────────────────────────────────┐│ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ 🔄 Valhalla Matrix                                    3s ago │  ││ │
│  │  │  │ ID: job-abc123                                               │  ││ │
│  │  │  │ ████████████░░░░░░░░ 60%  Calculating distances...          │  ││ │
│  │  │  │                                              [Zrušit]        │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ 📍 Geocoding Batch                                   15s ago │  ││ │
│  │  │  │ ID: job-def456                                               │  ││ │
│  │  │  │ ██████████████████░░ 85%  Geocoding customer 42/50...       │  ││ │
│  │  │  │                                              [Zrušit]        │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ 📥 Import CSV                                        1m ago  │  ││ │
│  │  │  │ ID: job-ghi789                                               │  ││ │
│  │  │  │ ████████░░░░░░░░░░░░ 40%  Processing row 200/500...         │  ││ │
│  │  │  │                                              [Zrušit]        │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌─ Nedávno dokončené ─────────────────────────────────────────────────┐│ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ ✓ Geocoding Batch                              2m ago  2.3s │  ││ │
│  │  │  │   25 customers geocoded, 2 failed                           │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ ✓ Valhalla Geometry                            5m ago  1.1s │  ││ │
│  │  │  │   Route for 12 stops calculated                             │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌─ Selhané úlohy ─────────────────────────────────────────────────────┐│ │
│  │  │                                                                     ││ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐  ││ │
│  │  │  │ ✗ Valhalla Matrix                             10m ago        │  ││ │
│  │  │  │   Error: Connection timeout after 30s                        │  ││ │
│  │  │  │   Retries: 3/3                                               │  ││ │
│  │  │  │                                    [Opakovat]  [Zahodit]     │  ││ │
│  │  │  └─────────────────────────────────────────────────────────────┘  ││ │
│  │  │                                                                     ││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  │                                                                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Datové typy

```typescript
interface JobSummary {
  id: string;
  type: 'geocode' | 'geocode_address' | 'geocode_reverse' | 
        'valhalla_matrix' | 'valhalla_geometry' |
        'import' | 'export' | 'email' | 'sms';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;        // 0-100
  message?: string;         // Current status message
  submittedAt: string;      // ISO timestamp
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

interface JobsDashboardStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}
```

### NATS Subjects

| Subject | Popis |
|---------|-------|
| `sazinka.admin.jobs.list` | Seznam aktivních úloh |
| `sazinka.admin.jobs.stats` | Statistiky front |
| `sazinka.admin.jobs.cancel` | Zrušení úlohy |
| `sazinka.admin.jobs.retry` | Opakování selhané úlohy |

### UI komponenty

- [ ] `JobsDashboard` - hlavní stránka
- [ ] `JobStatsCards` - 4 karty se statistikami
- [ ] `ActiveJobsList` - seznam aktivních úloh
- [ ] `CompletedJobsList` - nedávno dokončené
- [ ] `FailedJobsList` - selhané úlohy s akcemi
- [ ] `JobProgressBar` - progress bar s procentem
- [ ] `JobTypeIcon` - ikona podle typu úlohy

### Integrace s existujícím Admin UI

Jobs Dashboard bude nová záložka v Admin sekci:

```
Admin
├── Přehled (stávající)
├── Export dat (stávající)
├── Jobs Dashboard (nové) ← Phase 7D
└── Nastavení (stávající)
```

---

---

## Phase 8: GA Redesign - Route-Aware Planning

> **Status:** Planning phase  
> **Verze:** 1.0  
> **Datum:** 2026-02-02

### Klíčový koncept

**Hlavní změna:** "Domluvit návštěvu" již není oddělené od plánování trasy - je to **jedna činnost**: vložit zakázku do denní trasy s minimem Δkm/Δmin a s ohledem na časová okna.

---

### 1. Persony

#### 1.1 Dispečerka (primárně desktop)

**Kontext:** PC, telefon, často přepíná mezi hovorem, mapou, seznamem a plánem dne.

**Cíl:** Domluvit termíny a průběžně skládat denní trasy pro 1–N posádek tak, aby byl minimální čas/kilometry a přitom byla splněna okna a kapacita dne.

**Klíčové potřeby:**
- Rychle vidět kdo je na řadě a proč (due, priorita)
- Při domluvě hned vidět dopad na trasu: Δkm / Δmin a konflikty
- Vidět kapacitu dne (vytížení, rezerva/slack) a varování "den je plný"
- Řešit výjimky v místě (nelze geokódovat, chybí tel, zákazník chce zavolat později)
- Minimum scrollu, maximum informační hustoty, klávesové zkratky

**Typické chování:**
- Vybere den + posádku + depo → vybírá zákazníky z inboxu tak, aby "seděli" do trasy
- V hovoru nabídne 3 nejlepší sloty, ne celý kalendář
- Když něco "nesedí", odloží nebo přehodí na jiný den/posádku

#### 1.2 Řemeslník (primárně mobil)

**Kontext:** Mobilní web, často venku; potřebuje rychle navigovat, volat, vidět poznámky a uzavřít zakázku.

**Cíl:** Provést návštěvy, minimalizovat zmatky, mít všechny informace dostupné (kontakt, adresa, poznámky, zařízení, historie), rychle zaznamenat výsledek.

**Klíčové potřeby:**
- Dnešní plán: pořadí, okna, čas dojezdu, navigace
- Jedno kliknutí: Navigovat, Volat, Na místě, Hotovo
- Poznámky typu "parkování / klíče / přístup" zvýrazněné
- I bez mobilní aplikace: export (odkaz/Google Maps) a offline-ish "tisk/PDF"

---

### 2. Názvosloví (sjednocení)

| UI termín | Popis | Mapování na DB |
|-----------|-------|----------------|
| **Zákazník** | Osoba nebo firma | `Customer` |
| **Zařízení** | Kotel, komín, plynový spotřebič | `Device` |
| **Zakázka** | Co se má udělat (revize/servis/čištění) | `Revision` |
| **Návštěva** | Domluvené datum + časové okno + délka + posádka | `Visit` |
| **Plán dne** | Konkrétní trasa pro den a posádku (sekvence návštěv + metriky) | `PlannedRoute` |
| **Plánovací inbox** | Seznam zakázek k domluvení/vložení do trasy | Query over `Revision` |

---

### 3. Stavové signály (konzistentní napříč aplikací)

#### 3.1 Stav adresy

| Stav | Ikona | Popis |
|------|-------|-------|
| Ověřeno | ✅ | Má geo a prošla validací |
| Čeká na ověření | ⏳ | Geokódování pending |
| Nelze lokalizovat | ⚠ | Geokód selhal |
| Bez adresy | ⛔ | Nelze optimalizovat |

#### 3.2 Stav vložení slotu do trasy

| Stav | Ikona | Podmínky |
|------|-------|----------|
| OK | ✅ | Bez konfliktu, vytížení ≤90%, slack ≥20 min |
| Těsné | ⚠ | Vytížení 90–100% nebo slack 10–20 min |
| Konflikt | ❌ | Porušení okna nebo vytížení >100% |

#### 3.3 Kapacita dne

| Stav | Ikona | Podmínky |
|------|-------|----------|
| V pohodě | ✅ | load <80%, slack >30 min |
| Těsný | ⚠ | load 80–95% nebo slack 15–30 min |
| Přetížený | ❌ | load >95% nebo slack <15 min |

---

### 4. Design principy pro GA

#### 4.1 Tři zásadní UX pravidla

1. **Route-aware všude tam, kde se domlouvá termín**
   - "Domluvit" vždy ukazuje dopad na trasu

2. **Výjimky řešitelné přímo v místě**
   - Nelze geokódovat → okamžitě "Opravit adresu" a pokračovat

3. **Desktop je hustý a rychlý; mobil je rovnocenný, jen jinak poskládaný**
   - Ne "desktop jako zvětšený mobil"

#### 4.2 Explicitní "Route-aware" režim

V Inboxu i v Domluvě termínu bude přepínač:

```
Optimalizovat podle trasy: [Zapnuto]
```

Když je **OFF**:
- Sloty nemají Δkm/Δmin, jen "časový konflikt"
- UI ukáže InlineAlert: "Bez ověřené adresy nelze optimalizovat. Opravit adresu."

---

### 5. Komponentový katalog

#### 5.1 Základní layoutové komponenty

| Komponenta | Popis |
|------------|-------|
| `AppShell` | Top nav, breadcrumb slot, content container, dense mód |
| `SplitView` | Desktop: 2–3 panely (Inbox / Map / Detail) |
| `RightDrawer` / `BottomSheet` | Jednotná logika otevření/zavření, focus trap, ESC |

#### 5.2 Route-aware plánování

| Komponenta | Popis |
|------------|-------|
| `RouteContextHeader` | Sticky nahoře: Den, Posádka, Depo + souhrn metrik |
| `CandidateRow` | Řádek v inboxu: jméno, město, due, Δkm, Δmin, slot chips |
| `RouteMap` | Mapa s číslovanými piny + polyline + insertion preview |
| `SlotSuggestions` | Nabídka 3–5 slotů s metrikami a stavy |
| `InsertionPreview` | Mini panel "vloží se mezi: 3 (Jana) → 4 (Michaela)" |

#### 5.3 Stavové komponenty

| Komponenta | Popis |
|------------|-------|
| `StatusChip` | Badge pro adresu/zakázku/kapacitu se stavem |
| `InlineAlert` | Krátké vysvětlení problému + CTA |
| `MetricBadge` | Pro Δkm/Δmin a denní metriky |

#### 5.4 Data grid

| Komponenta | Popis |
|------------|-------|
| `CustomerTable` | TanStack Table s bohatými buňkami |
| `CustomerPreviewPanel` | Shrnutí + CTA v side panelu |
| `CustomerEditDrawer` | Editace + ověření adresy |

---

### 6. Klávesové zkratky (dispečerka / desktop)

#### 6.1 Globální

| Zkratka | Akce |
|---------|------|
| `/` | Focus do search |
| `g i` | Go to Inbox |
| `g c` | Go to Customers |
| `g d` | Go to Day plan |

#### 6.2 Inbox

| Zkratka | Akce |
|---------|------|
| `↑` / `↓` | Výběr kandidáta |
| `Enter` | Otevřít detail |
| `1`..`5` | Vybrat doporučený slot |
| `D` | Otevřít "Domluvit" |
| `S` | Uložit/"Domluvit" (commit) |
| `O` | Otevřít "Odložit" |
| `E` | "Opravit adresu" |
| `Esc` | Zavřít drawer/modal |

#### 6.3 Plán dne

| Zkratka | Akce |
|---------|------|
| `Ctrl+S` | Uložit plán |
| `R` | Re-optimalizovat |
| `P` | Tisk |
| `M` | Export do Google Maps |

---

### 7. Metriky kapacity a jak je ukazovat

#### 7.1 Metriky v RouteContextHeader

```
51 km • jízda 1h16 • servis 5h30 • vytížení 92% ⚠ • rezerva 18 min ⚠
```

| Metrika | Popis |
|---------|-------|
| Vzdálenost (km) | Součet všech úseků trasy |
| Čas jízdy (travel time) | Z Valhalla matrix |
| Servisní čas | Součet service duration všech zastávek |
| Vytížení dne (load %) | (jízda + servis + pauzy) / pracovní doba |
| Rezerva (slack) | Nejmenší časová rezerva mezi návštěvami |

#### 7.2 Tooltip vysvětlení

- **Vytížení:** "Vytížení = (jízda + servis + pauzy) / pracovní doba dne"
- **Rezerva:** "Nejmenší časová rezerva mezi návštěvami vzhledem k časovým oknům; nízká rezerva = riziko skluzu"

---

### 8. Stránky - detailní popis a wireframes

#### 8.1 Plánovací inbox (route-aware)

**Účel:** Domluvit/vložit zakázky do konkrétní denní trasy s minimálním dopadem na km/čas.

**Desktop layout (3 panely):**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Plánovací inbox  Den[St 5.3] Posádka[1] Depo[Brno]  Route-aware[ON] [Filtry]│
│ 51 km • jízda 1h16 • servis 5h30 • vytížení 92%⚠ • rezerva 18m⚠          │
│ [Po termínu(12)] [Týden(18)] [30 dní(43)] [Vše] [Odložené] [Problémy]   │
├───────────────┬───────────────────────────────────────────┬─────────────┤
│ INBOX         │ MAPA + TRASA DNE                           │ DETAIL      │
│ Jana Novotná  │ piny 1..N + highlight kandidát             │ Jana Novotná│
│ +3.2km +6min ✅│ návrh vložení mezi 3→4                     │ Sloty:      │
│ 10–12✅ 12–14⚠ │                                           │ 10–12 ✅ +6m │
│               │                                           │ 12–14 ⚠ +14m│
│ Michaela…     │                                           │ 8–10 ❌      │
│ +7.8km +14m⚠  │                                           │ [DOMLUVIT]  │
│               │                                           │ [ODLOŽIT]   │
└───────────────┴───────────────────────────────────────────┴─────────────┘
```

**Mobile layout:**

```
┌──────────────────────────────┐
│ Inbox  Den [..] Posádka [1]     │
│ Kapacita 92% ⚠               │
│ [Seznam] [Mapa]              │
├──────────────────────────────┤
│ (karty s Δkm/Δmin)            │
│ Jana Novotná  +6m +3.2km ✅   │
│ [Domluvit] [Odložit]          │
└──────────────────────────────┘
```

**Segmenty:**
- Po termínu / Tento týden / Do 30 dní / Vše / Odložené / Problémy

**UI stavy:**
1. `context=missing` - Vyžaduje výběr dne+posádky
2. `context=ready, route=loading` - Skeleton metrik a mapy
3. `route=ready, inbox=ready` - Kandidáti seřazení dle "nejlepší vložení"
4. `candidate=selected, suggestions=loading` - Dotekají sloty
5. `routeAware=forcedOff` - Chybí geo, banner s vysvětlením
6. `capacity=warn|danger` - Varování v headeru

---

#### 8.2 Plán dne (route editor / export)

**Účel:** Vidět a upravit denní trasu, reorder, export, kapacita.

**Desktop layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Plán dne  Den[..] Posádka[1] Depo[..]  51km • 92%⚠ • slack 18m⚠    │
│ [Přidat z inboxu] [Export ▾] [Tisk] [Uložit]                     │
├───────────────┬──────────────────────────────────────────────────┤
│ Stops (DND)   │ MAPA + TRASA                                      │
│ 1 Jana 10–12  │ polyline + piny                                   │
│ 2 ...         │                                                   │
└───────────────┴──────────────────────────────────────────────────┘
```

**Funkce:**
- Drag & drop reorder zastávek
- Draft mode s "Neuložené změny" bannerem
- "Přidat z inboxu" otevře drawer s kandidáty
- Export: Google Maps (segmentovaný), Tisk/PDF

---

#### 8.3 Seznam zákazníků

**Účel:** Katalog pro dohledání a údržbu dat.

**Desktop (tabulka):**

```
┌───────────────────────────────────────────────────────────────┐
│ Zákazníci  [🔎 hledat…____________________] [Saved ▾] [Filtry] │
│ [Řadit ▾] [Tabulka|Karty]                               [+Nový]│
├───────────────────────────────────────────────────────────────┤
│ ZÁKAZNÍK             | MĚSTO | ZAŘ. | NEJBL. ZAK. | ADRESA | ⋯ │
│ Alena Hájek          | Hodonín| 2    | 3.1.2027    | ✅     | ⋯ │
│ +420… • email… • U Pošty 220…                               … │
├───────────────────────────────┬───────────────────────────────┤
│ (klik řádku)                   │ Náhled zákazníka (panel)      │
│                                │ kontakt, adresa, CTA          │
└───────────────────────────────┴───────────────────────────────┘
```

**Mobile (karty):**

```
┌──────────────────────────────┐
│ Zákazníci                    │
│ [🔎 hledat…_______________]   │
│ [Bez adresy] [Nelze loc] [Po]│
├──────────────────────────────┤
│ Alena Hájek (Osoba)          │
│ Hodonín • U Pošty 220…       │
│ ✅ Ověřeno • Zařízení 2      │
│ Nejbližší: 3.1.2027          │
└──────────────────────────────┘
```

---

#### 8.4 Detail zákazníka (workspace + edit drawer)

**Účel:** Rychlý přehled + zařízení + historie + komunikace; editace v draweru.

**Desktop (2 sloupce + taby):**

```
┌────────────────────────────────────────────────────────────────┐
│ ← Zpět  Alena Hájek [OSOBA]  [📞] [🧭] [➕ do plánu] [✎ Upravit] │
├───────────────────────┬────────────────────────────────────────┤
│ Kontakt               │ [Zařízení] [Zakázky&Návštěvy] [Komunik.]│
│ +420… (kopírovat)     │ ─ Zařízení (kompaktní řádky)            │
│ email…                │ Kotel…  Interval 12  Další: …  [Domluvit]│
│ Adresa ✅ Ověřeno      │ Komín…  Interval 24  Další: …  [Domluvit]│
│ U Pošty 220… [Opravit] │                                          │
│ Mini mapa [Otevřít]   │                                          │
│ Poznámky…             │                                          │
└───────────────────────┴────────────────────────────────────────┘
```

**Editace:** Pravý drawer se sekcemi "Základ", "Kontakt", "Adresa + ověření", "Poznámky"

---

#### 8.5 Domluvit termín (vložit do trasy) - dialog/panel

**Účel:** Jedním rozhodnutím vybrat slot a vložit do trasy.

**Desktop (inline panel):**

```
Domluvit termín
Doporučené: [Út 10–12 ✅ +6m/+3.2km] [St 8–10 ✅ +0m] [Čt 12–14 ❌]
Datum [..]  Okno [10:00]–[12:00]  Doba [30m]  (Posádka/Depo dle kontextu)
Stav: ✅ OK (rezerva 18 min)
[Zrušit]                         [Domluvit]
```

**Mobile (full-screen sheet):**

```
┌──────────────────────────────┐
│ Domluvit termín              │
│ Doporučené:                  │
│ [St 8–10 ✅] [Út 10–12 ✅]     │
│ Datum [..] Okno [..]–[..]     │
│ Doba [30m]                    │
│ Stav: OK (+6m / +3.2km)       │
│ [Zrušit]         [Domluvit]   │
└──────────────────────────────┘
```

---

#### 8.6 Odložit akci - dialog

**Účel:** Odložit další krok zakázky do data s důvodem.

```
Odložit akci
Odložit do: [dd.mm.rrrr]  Rychle: [+7] [+14] [+30]
Důvod: [Nezvedá ▾]
Poznámka: [__________]
[Zrušit]            [Odložit]
```

**Důvody:** Nezvedá, Dovolená, Chce zavolat později, Jiný

---

#### 8.7 Detail zakázky (workflow hub)

**Účel:** Centrální detail toho, co se má udělat.

**Desktop:**

```
┌──────────────────────────────────────────────────────────────┐
│ ← Zpět  Zakázka: Revize plynového kotle  [NADCHÁZEJÍCÍ]       │
│ Due: 26.2.2026   [Domluvit termín] [Odložit] [Zrušit ⋯]       │
├─────────────────────────┬────────────────────────────────────┤
│ Zákazník + Zařízení      │ Návštěva                           │
│ Hustopeče… ✅ adresa      │ St 5.3. 10–12  Doba 30m  Posádka 1     │
│ Kontakt…                 │ [Změnit] [Otevřít plán dne]         │
├──────────────────────────────────────────────────────────────┤
│ [Průběh/Výsledek] [Komunikace] [Historie]                     │
└──────────────────────────────────────────────────────────────┘
```

**Kontextové akce dle stavu:**
- `upcoming` → "Domluvit termín"
- `scheduled` → "Změnit termín", "Přesunout"
- `in_progress` → "Na místě", "Hotovo"
- `completed` → "Zobrazit výsledek"

---

### 9. UI stavové modely

#### 9.1 Plánovací inbox - stavy

| Stav | UI | Akce | Fallback |
|------|-----|------|----------|
| `context=missing` | Vyžaduje výběr dne+posádky | Vybrat | - |
| `route=loading` | Skeleton metrik | Čekat | - |
| `route=ready` | Kandidáti seřazení | Vybrat kandidáta | - |
| `suggestions=loading` | Skeleton slotů | Čekat | - |
| `routeAware=forcedOff` | Banner "bez optimalizace" | Opravit adresu | Domluvit bez Δ |
| `capacity=warn` | Chip v headeru | Přepnout posádku/den | - |

#### 9.2 Optimistic UI

**Ano (optimistic):**
- Vložit do dne / domluvit
- Odložit
- Uložení poznámky

**Ne (neoptimistic):**
- Editace adresy + ověření
- Reorder celé trasy (draft mód)

---

### 10. Empty states a edge cases

#### 10.1 Inbox je prázdný

```
Inbox je prázdný – na tento den nejsou žádné položky k domluvení.
[Zobrazit další období] [Přejít na Zákazníky]
```

#### 10.2 Nelze geokódovat

```
⚠ Adresu se nepodařilo ověřit. Do optimalizace trasy se nezahrne.
[Opravit adresu]
```

#### 10.3 Chybí telefon

```
⚠ Zákazník nemá telefon. Nelze obvolat.
[Doplnit telefon]
```

#### 10.4 Den je plný

```
❌ Den je téměř plný (92%). Doporučeno přidat max. 1 krátkou návštěvu v okolí.
```

---

### 11. Doporučené UI knihovny

| Knihovna | Účel |
|----------|------|
| shadcn/ui + Radix UI | Dostupnost, moderní vzhled |
| Tailwind CSS | Konzistentní spacing |
| TanStack Table | Tabulka zákazníků |
| React Query | Cachování, optimistic updates |
| React Hook Form + Zod | Formuláře + validace |
| date-fns | Data/časy |
| Zustand | UI stav (den/posádka, panely, filtry) |
| react-virtuoso | Virtualizace dlouhých seznamů |

---

*Dokument vytvořen: 2026-01-31*  
*Poslední aktualizace: 2026-02-02 (Phase 8 - GA Redesign specification)*
