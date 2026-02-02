# Sazinka - Workflow & UI Koncept

> **Status:** MVP kompletní  
> **Verze:** 0.3  
> **Datum:** 2026-02-02
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
- Jedno nebo více vozidel, jedno nebo více dep
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
- Depot/vozidlo
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
│ [Technik 1 - Petr]  [Technik 2 - Jan]  [+ Přidat vozidlo]                  │
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
| Vehicle | Vozidlo/technik | depot_id, kapacita, pracovní doba |
| Depot | Výchozí místo | adresa, GPS |
| Route | Denní plán | datum, vehicle_id, zastávky[], statistiky |

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
- Klíčové info: `Termín`, `Časové okno`, `Délka`, `Technik/vozidlo`
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
- Přiřazení: technik/vozidlo/depo (pokud existuje)
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
| Čeká na kontakt | `upcoming` | `status='upcoming' AND scheduled_date IS NULL` |
| Domluveno | `scheduled` | `status='scheduled'` (má termín, nepotvrzeno) |
| Potvrzeno | `confirmed` | `status='confirmed'` |
| Naplánováno v trase | `confirmed` | + `route_order IS NOT NULL` |
| Dokončeno | `completed` | `status='completed'` |
| Odloženo | `upcoming` | + nové pole `snooze_until` |
| Zrušeno | `cancelled` | `status='cancelled'` |

**Nová pole pro Revision (schema change):**
```sql
ALTER TABLE revisions ADD COLUMN snooze_until DATE;
ALTER TABLE revisions ADD COLUMN snooze_reason VARCHAR(255);
ALTER TABLE revisions ADD COLUMN assigned_vehicle_id UUID REFERENCES vehicles(id);
ALTER TABLE revisions ADD COLUMN route_order INTEGER;
```

### 3. Algoritmus nabídky slotů (ROZHODNUTO)

**Insertion Heuristic s Valhalla cache:**

```
1. Pro zvolený den + vozidlo načti existující trasu:
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

### 4. Multi-vehicle a multi-depot (ROZHODNUTO)

**MVP:**
- `Vehicle.home_depot_id` = default start/end
- `Vehicle.preferred_area` = seznam PSČ prefixů / okresů
- Ruční přiřazení + jednoduché regiony
- UI: zobrazit "Day load" per vehicle

**V2:**
- Clustering zakázek do N clusterů (N = počet aut)
- Auto-balance load mezi vozidly
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
ALTER TABLE revisions ADD COLUMN assigned_vehicle_id UUID;
ALTER TABLE revisions ADD COLUMN route_order INTEGER;

-- Nová tabulka vehicles (pokud neexistuje)
CREATE TABLE vehicles (
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
- [ ] CRUD pro Vehicle entity
- [ ] Endpoint: `revision.queue` - fronta k obvolání

### Fáze 2: Fronta k obvolání (1 týden)

**Endpoint:** `GET /api/revisions/queue`
```typescript
interface QueueFilters {
  status: 'overdue' | 'due_soon' | 'upcoming';
  area?: string;      // PSČ prefix
  deviceType?: string;
  vehicleId?: string;
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
  vehicleId?: string;
  notes?: string;
}
```

**UI komponenty:**
- [ ] `ScheduleRevisionDialog` - modal pro domluvu
- [ ] Kalendář s počtem volných slotů per den
- [ ] Seznam časových oken (zatím bez smart slotů)

### Fáze 4: Plán dne - základní (1-2 týdny)

**Endpoint:** `GET /api/routes/{date}/{vehicleId}`
```typescript
interface DayPlan {
  date: string;
  vehicle: Vehicle;
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
- [ ] Valhalla matrix cache per den/vozidlo
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
| `/api/vehicles` | CRUD | Správa vozidel |
| `/api/routes/{date}` | GET | Plán dne (všechna vozidla) |
| `/api/routes/{date}/{vehicleId}` | GET | Plán dne (konkrétní vozidlo) |
| `/api/routes/{date}/{vehicleId}/reorder` | POST | Změna pořadí |
| `/api/routes/{date}/{vehicleId}/optimize` | POST | Re-optimalizace |
| `/api/slots/suggest` | POST | Doporučené sloty (V2) |
| `/api/export/googlemaps/{date}/{vehicleId}` | GET | Google Maps linky |
| `/api/export/pdf/{date}/{vehicleId}` | GET | PDF export |

---

## Shrnutí klíčových rozhodnutí

| Oblast | Rozhodnutí |
|--------|------------|
| Entity | Nezavádět Job/Appointment, `Revision` je obojí |
| Stavy | Zachovat enum, „čeká na kontakt" = derived, „odloženo" = snooze_until |
| Sloty | Insertion heuristic + Valhalla cache (V2) |
| Multi-vehicle | MVP = ruční + PSČ regiony, V2 = clustering |
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

*Dokument vytvořen: 2026-01-31*  
*Poslední aktualizace: 2026-01-31 (odpovědi na otázky + implementační plán)*
