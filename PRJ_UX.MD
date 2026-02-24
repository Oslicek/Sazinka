# Sazinka - Workflow & UI Koncept

> **Status:** MVP kompletní + Phase 9 (Planner redesign) + sjednocení komponent + Smart Slot Heuristics (multi-crew, Valhalla) + Auto-recalculation + Chronological insertion & break constraints + Routing accuracy fixes + Timeline UX improvements + Flexible time windows + Client detail redesign + Slot heuristics fixes  
> **Verze:** 0.9.2  
> **Datum:** 2026-02-17
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
> - ✅ **Sjednocené komponenty Inbox/Planner** — `RouteDetailTimeline` + `RouteMapPanel` sdílené oběma stránkami
> - ✅ **Bidirectional highlight** — klik na zastávku/segment v timeline ↔ zvýraznění na mapě
> - ✅ **InsertionPreview** — vizualizace vložení kandidáta do trasy na mapě (Inbox only)
> - ✅ **Export+ asynchronně** — export joby běží na workeru a v `Úlohy` lze dokončený export stáhnout přes `Stáhnout export`
> - ✅ **Název export ZIP podle timezone uživatele** — `export-YYYYMMDD-HHMMSS-XX.zip` (čas ve jméně respektuje timezone uživatele, který export spustil)
> - ✅ **Záznam práce V1** (`/worklog`) — rychlý záznam návštěvy, rychlé dokončení plánované/probíhající návštěvy, zachované prokliky na den v kalendáři / návštěvu / zákazníka, včetně mobilně-responsivního layoutu
> - ✅ **Auto-recalculation** — automatický přepočet ETAs/ETDs po každém vložení zastávky nebo drag-and-drop přesunutí pomocí `sazinka.route.recalculate` (Valhalla matrix + sequential schedule)
> - ✅ **Chronological insertion** — nové zastávky se automaticky vkládají v chronologickém pořadí podle `scheduledTimeStart`, nikoliv na konec trasy
> - ✅ **Break constraint enforcement** — pauza respektuje nakonfigurované časové okno (např. 11:30-13:00) a vkládá se do správné mezery mezi zastávkami, ne hned po předchozí zastávce
> - ✅ **Valhalla routing accuracy** — snapping radius snížen z 50 km na 500 m (eliminuje detours způsobené mock geocodingem); break zastávky (bez souřadnic) jsou vyloučeny z Valhalla matrix požadavku, aby nezpůsobovaly fallback na MockRoutingService (40 km/h)
> - ✅ **Break chronological placement** — při výběru pozice pauzy se preferují mezery, kam pauza chronologicky patří (`chronoFit`), takže pauza v 11:30 se nevloží před zastávku v 08:00
> - ✅ **Timeline height halved + hourly labels** — výška plánovací timeline snížena na polovinu (`PIXELS_PER_MINUTE: 1.25`), vlevo přidány hodinové značky
> - ✅ **Collapsible/expandable map** — mapa v Inboxu lze sbalit (zobrazit jen timeline) nebo rozbalit na celou stránku
> - ✅ **Insertion preview deduplication** — opravena duplicitní vizualizace návrhu vložení kandidáta, kdy break rozdělující mezeru vytvářel dva náhledy místo jednoho; `insertAfterIndex` se přiřazuje jen mezerám před customer stopy
> - ✅ **Flexible time windows** — rozlišení mezi domluveným časovým oknem (např. 08:00-12:00) a potřebným časem návštěvy (např. 1 hodina). Dispečer nastaví "Potřebný čas" v detailu zákazníka pod "Domluvený termín", solver umístí zastávku optimálně v rámci okna. Timeline zobrazuje okno jako světle modré pozadí za zastávkou s popiskem "Okno HH:MM - HH:MM". Backend scheduler i VRP solver respektují flexibilní okna. Backward-compatible: zastávky bez explicitního `serviceDurationMinutes` nebo kde `serviceDuration >= windowLength` zůstávají "pinned" (původní chování).
> - ✅ **Client detail layout redesign** — přechod z dvousloupcového na jednosloupcový layout pro lepší čitelnost a využití prostoru. Sekce nyní v pořadí: Domluvený termín (s inline service duration inputem pro flexibilní okna), Revize nejpozději, Kontakt, Adresa, Poznámky. Akční tlačítka (Domluvit termín, Přidat do trasy, Odložit) přesunuty na konec. Odstraněn `window.prompt()` pro zadání potřebného času - nyní inline UI komponenta.
> - ✅ **Default service duration 60 min** — výchozí doba revize změněna z 30 na 60 minut (backend defaults, frontend fallbacks, Settings page)
> - ✅ **Quarter-hour aligned slots** — navrhované sloty zarovnány na čtvrthodiny (8:00, 8:15, 8:30, 8:45) pomocí `ceil_quarter_hour()` v backend insertion a slot_suggester
> - ✅ **Slot overlap filtering** — navrhované sloty se kontrolují proti VŠEM existujícím zastávkám (vč. pauz); překrývající se sloty se filtrují a nezobrazují
> - ✅ **Timeline layout fix** — oprava vertikálního layoutu PlanningTimeline: min. výška stop/break karet 56px, odstraněn margin drift v gapZone
> 
> **Změny v navigaci:**
> - `/planner` → "Plán dne" (sloučeno Plánování + Můj den)
> - `/today` → přesměrování na `/planner`
> - Navigační položka "Můj den" odstraněna

### ⚠️ Internationalization note

> All UI labels, button text, error messages, and user-visible strings in this document are in Czech (original MVP language). These will be extracted to translation keys and available in English as part of the i18n migration — see `PRJ_I18N.MD` for the full phased plan. When implementing new UI features, use `t()` keys from the start, not hardcoded strings.

---

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
│ DOPORUČENÉ SLOTY PRO 30.01.2026 (Multi-crew, Valhalla)             │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ 🚐 Posádka P1 (5 zastávek, 78% dne)                            │ │
│ │ ├─ ⭐ 10:15 - 11:00  │ 92%  │ +8min │ OK    │ [Vybrat]        │ │
│ │ ├─    14:00 - 15:00  │ 71%  │ +22min│ Těsný │ [Vybrat]        │ │
│ │                                                                 │ │
│ │ 🚐 Posádka P2 (3 zastávky, 45% dne)                            │ │
│ │ ├─    10:30 - 11:30  │ 85%  │ +12min│ OK    │ [Vybrat]        │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ NEBO VLASTNÍ ČAS  (real-time validace, debounced 500ms)            │
│ [Časové okno: ___:___ - ___:___]                                   │
│ ❌ Slot se překrývá s návštěvou Dvořáková (error)                  │
│ ⚠️ Před slotem je minimální časová rezerva (warning)               │
│ → Odhadovaný příjezd: 10:03 | Rezerva: 12 min                     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Zrušit]  [✓ Domluvit návštěvu]       │
└─────────────────────────────────────────────────────────────────────┘
```

**Algoritmus nabídky slotů (v2 — multi-crew, Valhalla):**

Aplikace v pozadí (`sazinka.slots.suggest.v2`):
1. Pro **všechny aktivní posádky** (nebo vybranou podmnožinu) načte existující trasu + naplánované revize
2. Pomocí **Valhalla** spočítá matice vzdáleností/časů (reálné souřadnice zákazníků z DB)
3. Pro každou posádku najde **optimální inserční pozice** (sdílená logika `calculate_insertion_positions`)
4. Ohodnotí každý slot **skórovací funkcí**:
   - 40% travel (delta_minutes) — menší objížďka = lepší
   - 25% fit (slack_before + slack_after) — více rezervy = lepší
   - 20% preference — shoda s preferovaným časem zákazníka
   - 15% balance — vyrovnané vytížení posádek
5. Status badge: **OK** (zelený), **Těsný** (žlutý, slack <15 min), **Konflikt** (červený)

**Validace ručně zadaného slotu** (`sazinka.slots.validate`):
- Překryv s existující návštěvou (error)
- Nedosažitelný čas — cestovní doba nestihne (error)
- Mimo pracovní dobu (error)
- Minimální rezerva <15 min (warning)
- Přetížený den >90% (warning)
- Zasahuje do okna pauzy (warning)

Pokud validace vrátí `feasible: false`, zobrazí se **warning box** s možností "Přesto naplánovat" nebo "Vybrat jiný slot".

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

> **Autentizace:** Přístup k aplikaci vyžaduje přihlášení (JWT). Role jsou vynuceny na backendu i frontendu. Viz `PROJECT_MULTIUSER.MD`.

### Role

| Role | Přístup ke stránkám | Popis |
|------|---------------------|-------|
| **Admin** | Vše včetně Admin panelu | Správce systému |
| **Customer** | Vše kromě Admin (včetně Nastavení) | Majitel firmy, může vytvářet pracovníky |
| **Worker** | Vše kromě Admin a Nastavení | Zaměstnanec, vidí data svého zákazníka |

### Režim A: Dispečerka + 1-N aut (Customer + Workers)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dispečerka    │     │   Technik 1     │     │   Technik 2     │
│   (Customer)    │     │   (Worker)      │     │   (Worker)      │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ • Fronta        │     │ • Můj plán      │     │ • Můj plán      │
│ • Domluva       │────▶│ • Status update │     │ • Status update │
│ • Plánování     │     │ • Export        │     │ • Export        │
│ • Přehledy      │     └─────────────────┘     └─────────────────┘
│ • Nastavení     │
└─────────────────┘
```

### Režim B: Řemeslník sám (Customer bez Workers)

```
┌─────────────────────────────────────┐
│     Řemeslník (Customer, vše sám)   │
├─────────────────────────────────────┤
│ • Fronta + mini plánování v jednom  │
│ • "Můj plán" jako výchozí homepage  │
│ • Domluva s automatickými sloty     │
│ • Nastavení                         │
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

### Tvorba denní trasy z Plánovacího inboxu

**Cíl:** Uživatel vytváří denní trasu přímo na stránce Fronta (Plánovací inbox), aniž by musel přecházet na stránku Plán dne. Vybírá zákazníky ze seznamu, přidává je do trasy, optimalizuje a ukládá — vše na jedné obrazovce.

**Stránka:** `/queue` — Plánovací inbox (třísloupcový layout)

#### Workflow tvorby trasy

1. Uživatel vybere datum, posádku a depo v header baru
2. Uživatel prochází seznam kandidátů (levý panel)
3. Kandidáty přidává do trasy buď:
   - Jednotlivě: klik na kandidáta → detail (pravý panel) → tlačítko "Přidat do trasy"
   - Hromadně: zaškrtne checkboxy → tlačítko "Přidat vybrané do trasy"
4. Přidaní kandidáti se zobrazí ve středním panelu pod mapou jako seznam zastávek
5. Mapa průběžně zobrazuje zastávky a propojení
6. Uživatel klikne "Optimalizovat trasu" → VRP solver přepočítá pořadí a časy
7. Trasa se **automaticky ukládá** průběžně (auto-save s debounce 1,5 s) — uživatel nemusí nic ukládat ručně

#### Levý panel — Seznam kandidátů

- U každého kandidáta je checkbox pro hromadný výběr
- Kandidáti, kteří jsou již v trase, mají vizuální označení (barevný proužek vlevo)
- Pod segmentovými záložkami je tlačítko "Přidat vybrané do trasy" (aktivní, když jsou zaškrtnuté checkboxy)
- Klávesová zkratka `A` — přidat aktuálně vybraného kandidáta do trasy

#### Střední panel — Mapa + Zastávky v trase

- Horní část: mapa se zastávkami a trasou
- Spodní část: kompaktní seznam zastávek v trase:
  - Pořadové číslo, jméno zákazníka, adresa, ETA–ETD, tlačítko ✕ (odebrat)
  - Souhrnné metriky: vzdálenost, čas, počet zastávek, zatížení dne (%)
- Akční tlačítka: Optimalizovat trasu, Vyčistit
- **Auto-save:** Trasa se automaticky ukládá 1,5 s po poslední změně (přidání, odebrání, optimalizace). Status bar v hlavičce ukazuje:
  - `● Neuložené změny` — změna čeká na uložení (debounce)
  - `⟳ Ukládám...` — probíhá ukládání
  - `✓ Uloženo právě teď / před N min` — úspěšně uloženo
  - `⚠️ Nepodařilo se uložit [Zkusit znovu]` — chyba s možností retry
- Prázdný stav: "Zatím žádné zastávky v trase. Vyberte kandidáty ze seznamu."

#### Pravý panel — Detail kandidáta

- Pod slot suggestions přidáno tlačítko "Přidat do trasy"
- Pokud je kandidát již v trase, místo "Přidat" se zobrazí "Odebrat z trasy"
- Klávesová zkratka `R` — odebrat aktuálně vybraného z trasy

#### Wireframe

```
PLÁNOVACÍ INBOX — TVORBA TRASY
=============================================================================
Den: 07.02.2026  Posádka: Petr  Depo: Brno-střed  [Route-aware: ON]
=============================================================================

KANDIDÁTI (levý panel)        MAPA + TRASA (střed)         DETAIL (pravý)
+---------------------------+ +------------------------+ +------------------+
| [x] Po termínu  Týden ... | |                        | | Jan Novák        |
|                           | |    [MAPA S TRASOU]      | | Kotel 45min      |
| [ ] Karel S.  Brno  +2min | |    1──2──3──Depo        | | Lesní 123, Brno  |
| [x] Marie D.  Brno  +5min | |                        | |                  |
| [ ] Petr Č.   Blank +8min | +------------------------+ | Slot suggestions:|
| [x] Jana N.   Vyšk +12min | | ZASTÁVKY V TRASE (3)   | | 09:15 +2min  OK  |
| ▌  Anna K. (v trase)      | | 1. Karel S. 08:30-09:15| | 10:45 +5min  OK  |
|                           | | 2. Anna K.  09:45-10:15| | 14:00 +8min Tight|
| [Přidat vybrané do trasy] | | 3. Jiří M.  10:45-11:30| |                  |
|                           | |                    [✕]  | | [PŘIDAT DO TRASY]|
|                           | | Vzdál: 45km  Čas: 3h   | | [Odložit]        |
|                           | | Zatížení: 62%           | | [Detail zákazníka]|
|                           | |                        | |                  |
|                           | | [Optimalizovat][Vyčistit]| | kbd: A přidat    |
|                           | | ✓ Uloženo právě teď     | |      R odebrat   |
+---------------------------+ +------------------------+ +------------------+
```

#### Klávesové zkratky (rozšíření)

| Klávesa | Akce |
|---------|------|
| `A` | Přidat vybraného kandidáta do trasy (best slot) |
| `R` | Odebrat vybraného kandidáta z trasy |
| `Shift+A` | Přidat všechny zaškrtnuté do trasy |

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

> **Status:** Partially implemented (Phase 7D core in `/jobs`)
> **Umístění:** `/admin/jobs` (součást Admin sekce)

### Účel

Centralizovaný monitoring všech asynchronních úloh zpracovávaných přes JetStream:
- Geocoding (Nominatim)
- Routing (Valhalla)
- Importy/Exporty
- Email/SMS (budoucí)
- Exporty lze z historie stahovat přímo tlačítkem `Stáhnout export` u dokončených export jobů

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

#### 8.2 Přehled cest / Planner (`/planner`)

**Účel:** Přehled naplánovaných cest s filtrováním. Prohlížení tras s detailní časovou osou a vizualizací na mapě.

**Desktop layout (2 sloupce: sidebar + mapa):**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  LEVÝ SLOUPEC (sidebar)               │  PRAVÝ SLOUPEC (mapa)            │
│                                        │                                  │
│  FILTRY                                │  ┌──────────────────────────┐   │
│  [Datum ____] [... rozsah]             │  │                          │   │
│  [Posádka: Vše ▾] [Depo: Vše ▾]       │  │      MAPA S TRASOU       │   │
│                                        │  │   (piny + segmenty)      │   │
│  NAPLÁNOVANÉ CESTY (N)  [↻]           │  │                          │   │
│  ┌──────────────────────────────────┐  │  │   ①──②──③──④──🏠         │   │
│  │ Po 2.2. • Posádka 1 • 3 zast.   │  │  │                          │   │
│  │ 45 km • 2h30                     │  │  └──────────────────────────┘   │
│  ├──────────────────────────────────┤  │                                  │
│  │ Út 3.2. • Posádka 1 • 5 zast.   │  │                                  │
│  │ 78 km • 4h15                     │  │                                  │
│  └──────────────────────────────────┘  │                                  │
│                                        │                                  │
│  DETAIL TRASY           45 km · 2h30   │                                  │
│  ┌──────────────────────────────────┐  │                                  │
│  │ 🏠 Depo Brno                     │  │                                  │
│  │ ─── 12 km · 18 min ──────────── │  │                                  │
│  │ ① Jan Novák    08:30–09:15      │  │                                  │
│  │   Lesní 123, Brno  [Potvrzeno]  │  │                                  │
│  │ ─── 8 km · 12 min ──────────── │  │                                  │
│  │ ② Marie Svob.  09:45–10:15     │  │                                  │
│  │   Hlavní 45     [Nepotvrzeno]   │  │                                  │
│  │ ─── 15 km · 22 min ─────────── │  │                                  │
│  │ ③ Petr Černý   10:50–11:35     │  │                                  │
│  │   Nádražní 8    [Potvrzeno]     │  │                                  │
│  │ ─── 10 km · 15 min ─────────── │  │                                  │
│  │ 🏠 Depo Brno                     │  │                                  │
│  └──────────────────────────────────┘  │                                  │
└────────────────────────────────────────┴──────────────────────────────────┘
```

**Filtry:**
- **Den**: výběr jednoho dne s možností přepnout na rozsah
- **Posádka**: defaultně "Vše", výběr z existujících posádek
- **Depo**: defaultně "Vše", výběr z existujících dep
- Uživatelské preference (defaultní posádka, depo) se načtou ze Settings jako výchozí hodnoty

**Interakce:**
- Kliknutí na trasu v seznamu zobrazí její detail v dolní části sidebaru
- Kliknutí na zastávku v timeline zvýrazní místo na mapě a přeletí na něj
- Kliknutí na segment v timeline zvýrazní úsek cesty na mapě
- Kliknutí na segment cesty na mapě zobrazí info o úseku

**Komponenty (sdílené s Inbox):**
- `RouteListPanel` — seznam tras s kartami (datum, posádka, zastávky, vzdálenost, čas)
- `RouteDetailTimeline` — sdílená vertikální timeline: depo → segment (čas od–do, km, trvání) → zastávka (status badge, dohodnuté/vypočítané časy, warning ikona při rozdílu >15 min) → ... → depo
  - Ve spodním route summary: `Vzdálenost`, `Celkový čas`, `Zatížení` + sekundární údaj `z toho jízda`
  - Sjednocené akce na obou stránkách: `Optimalizovat`, `Přidat pauzu`, `Smazat trasu`
- `RouteMapPanel` — sdílená mapa MapLibre GL (piny, segmenty, polyline, highlight, v Inbox navíc selectedCandidate a insertionPreview)
- Bidirectional highlight: klik v timeline ↔ zvýraznění na mapě, klik na segment/zastávku na mapě ↔ zvýraznění v timeline
- VRP optimalizace s pauzou: opraven backend payload pauzy pro `vrp-pragmatic` (required break), aby se optimalizace nepřepínala na heuristický fallback kvůli chybě deserializace

**Nastavení uživatele (Settings → Moje nastavení):**
- Defaultní posádka a depo se ukládají do DB (`users.default_crew_id`, `users.default_depot_id`)
- Používají se jako výchozí filtry na stránce Planner
- Uživatel může filtrovat i jiné posádky/depa — preference nejsou tvrdá vazba

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

**Mazání zákazníka (aktuální UX):**

- V headeru detailu je akce pro smazání zákazníka (anonymizace).
- Po kliknutí se otevře potvrzovací dialog s upozorněním, že akce je nevratná a osobní údaje budou trvale anonymizovány bez možnosti undo.
- Po potvrzení zákazník zmizí ze seznamů/UI, ale historická navázaná data zůstávají zachována v anonymizované podobě.
- UX copy explicitně komunikuje, že jde o anonymizaci PII (GDPR-style), ne fyzické odstranění historických vazeb.

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

---

## Phase 10: Onboarding Wizard (New User Registration)

> **Status:** ✅ Complete — Phase A ✅ · Phase B ✅ · Phase C ✅ · Phase D ✅ · Phase E ✅  
> **Version:** 1.9  
> **Date:** 2026-02-21

### 1. Goals

1. Replace the current single-page Register form with a multi-step wizard.
2. Add **email verification** (confirmation link sent via Resend).
3. **Rate-limit** registration + verification endpoints; add DDoS guardrails.
4. Show **country availability** (CZ now, SK coming soon, waitlist for others).
5. Communicate the **30-day free trial** — no credit card required.
6. Include a **device type selection** step so the user's tenant has the right configs from day one.
7. All user-facing text available in **en**, **cs**, **sk**.
8. The wizard module is **lazy-loaded** — zero extra JS until the user navigates to `/register`.
9. The full country list is **lazy-loaded** — only fetched when the user explicitly wants a country other than the pre-selected CZ default.
10. A clear **progress indicator** is visible at all times showing total steps, current position, and step labels.

### 2. Current State (as-is)

| Area | Status |
|------|--------|
| `Register.tsx` | Single form: name, email, password, business name (optional), locale. Already lazy-loaded via `React.lazy`. |
| `handle_register` (Rust) | Creates user immediately, returns JWT. No email verification. |
| `RateLimiter` | Exists for login (5 attempts / 5 min). Not applied to registration. |
| Email infrastructure | `EmailProcessor` skeleton (Resend-based, JetStream queue). Not yet sending real emails. |
| `countries` table | Exists with `is_supported` flag. CZ + SK seeded. Admin UI can sync/manage. |
| `users` table | No `email_verified`, `verification_token_hash`, or `verification_expires` columns. |
| `device_type_configs` | Per-tenant. 5 builtin types auto-seeded on tenant creation via DB trigger (`seed_device_types_for_tenant`). Labels are hardcoded Czech. |
| `DeviceTypeConfigManager` | Full CRUD exists in Settings page. ~800 line component. |
| Country list in frontend | `CountrySelect` loads all countries eagerly on first dropdown open. |

### 3. Progress Indicator

The wizard has a persistent **horizontal stepper bar** visible on every step (except the Landing page). It shows:

```
──────────────────────────────────────────────────────────
  ①          ②          ③          ④          ⑤
Account   About you   Devices   Depot   All set!
  ●──────────●──────────○──────────○──────────○
             ↑ current
──────────────────────────────────────────────────────────
```

- **Completed steps**: filled circle + checkmark + clickable (can navigate back).
- **Current step**: filled circle + bold label.
- **Future steps**: empty circle + muted label + not clickable.
- Labels are localized.
- Mobile: labels hidden, only numbered circles with progress line.

### 4. Wizard Steps

```
┌─────────────────────────────────────────────────────────────┐
│  LANDING  (/register)                                       │
│  (no stepper bar — this is the "pre-wizard" page)           │
│                                                             │
│  Ariadline logo                                             │
│                                                             │
│  "Plan routes, manage revisions, save time."                │
│                                                             │
│  🇨🇿 Czech Republic           [Start free trial →]          │
│     Available now · 30 days free · No credit card           │
│                                                             │
│  Coming soon:                                               │
│  🇸🇰 Slovakia                  [Notify me]                  │
│  🇦🇹 Austria                   [Notify me]                  │
│  (... dynamic list from DB where coming_soon = true)        │
│                                                             │
│  📍 Different country?         [Notify me →]                │
│     We'll let you know when we launch in your country.      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  Already have an account? [Sign in]                         │
│                                                             │
│  [🌐 EN] [🇨🇿 CS] [🇸🇰 SK]   ← language switcher            │
└─────────────────────────────────────────────────────────────┘

    User clicks "Start free trial" for CZ
    OR clicks "Notify me" → mini-form (email + country picker) → done
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ①───②───③───④───⑤                                         │
│  ●   ○   ○   ○   ○   Account                               │
│                                                             │
│  STEP 1 / 5  —  Account                                    │
│                                                             │
│  Email        [________________________]                    │
│  Password     [________________________]  (min 8 chars)     │
│  Confirm pwd  [________________________]                    │
│                                                             │
│  Password strength: ████████░░ Strong                       │
│                                                             │
│  ☐ I agree to the [Terms of Service] and [Privacy Policy]   │
│                                                             │
│                              [← Back]  [Continue →]         │
└─────────────────────────────────────────────────────────────┘

    Backend creates unverified user, sends verification email.
    Frontend shows "Check your inbox" interstitial.
    User clicks link in email → token verified → proceed.
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ①───②───③───④───⑤                                         │
│  ✓   ●   ○   ○   ○   About you                             │
│                                                             │
│  STEP 2 / 5  —  About you                                  │
│                                                             │
│  Your name *          [________________________]            │
│  Company name         [________________________] (optional) │
│  Phone                [________________________] (optional) │
│  ICO                  [________________________] (optional) │
│                                                             │
│  Language             [Czech ▾]  (pre-filled from landing)  │
│  Country              Czech Republic (locked from landing)  │
│                                                             │
│                              [← Back]  [Continue →]         │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ①───②───③───④───⑤                                         │
│  ✓   ✓   ●   ○   ○   Devices                               │
│                                                             │
│  STEP 3 / 5  —  What do you service?                       │
│                                                             │
│  Select the device types you work with.                     │
│  You can add or change these later in Settings.             │
│                                                             │
│  ☑ Chimney               30 min · every 12 months  [▾]     │
│  ☐ Gas boiler            60 min · every 12 months          │
│  ☐ Gas water heater      45 min · every 12 months          │
│  ☐ Fireplace / insert    30 min · every 12 months          │
│  ☐ Gas stove             20 min · every 36 months          │
│  (labels shown in user's locale)                            │
│                                                             │
│  Expand a selected type to adjust defaults:                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ☑ Chimney                                [▴ collapse] │   │
│  │   Default duration:  [30] min                        │   │
│  │   Revision interval: [12] months                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add custom device type]                                 │
│                                                             │
│                              [← Back]  [Continue →]         │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ①───②───③───④───⑤                                         │
│  ✓   ✓   ✓   ●   ○   Depot                                 │
│                                                             │
│  STEP 4 / 5  —  Your depot (home base)                     │
│                                                             │
│  This is where your crew starts and ends each day.          │
│                                                             │
│  Depot name *         [________________________]            │
│  Street *             [________________________]            │
│  City *               [________________________]            │
│  Postal code *        [________________________]            │
│                                                             │
│  [Verify address]  → geocode via Nominatim                  │
│  ✅ Address verified (lat: 49.19, lng: 16.61)               │
│                                                             │
│                              [← Back]  [Continue →]         │
└─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│  ①───②───③───④───⑤                                         │
│  ✓   ✓   ✓   ✓   ●   All set!                              │
│                                                             │
│  STEP 5 / 5  —  You're all set!                            │
│                                                             │
│  ✓ Account created                                         │
│  ✓ 1 device type configured (Chimney)                      │
│  ✓ Depot "Brno" saved                                      │
│  ✓ Crew created                                             │
│                                                             │
│  Your 30-day free trial starts today.                       │
│  We'll remind you before it ends — no surprises.            │
│                                                             │
│                    [Go to Dashboard →]                      │
└─────────────────────────────────────────────────────────────┘
```

### 5. Registration flow — sequence diagram

```
Browser                        Worker (Rust)                   Resend
  │                               │                              │
  │ sazinka.auth.register.start   │                              │
  │ {email, password, locale,     │                              │
  │  country}                     │                              │
  │──────────────────────────────▶│                              │
  │                               │ validate email, password     │
  │                               │ check rate limit (IP+email)  │
  │                               │ check email not taken        │
  │                               │ hash password (argon2)       │
  │                               │ INSERT user (email_verified  │
  │                               │   = false)                   │
  │                               │ generate token, hash it       │
  │                               │ store hash + expiry in DB    │
  │                               │                              │
  │                               │ ─── email.send ────────────▶ │
  │                               │   "Click to verify"          │
  │                               │                              │
  │◀──────────────────────────────│                              │
  │ {ok, message: "check inbox"}  │                              │
  │                               │                              │
  │ (user clicks link in email)   │                              │
  │                               │                              │
  │ sazinka.auth.verify-email     │                              │
  │ {token}                       │                              │
  │──────────────────────────────▶│                              │
  │                               │ hash token, lookup by hash, check expiry │
  │                               │ UPDATE email_verified = true  │
  │                               │ CREATE tenant + user_tenants  │
  │                               │ (auto-seeds device type cfgs) │
  │                               │ generate JWT                 │
  │◀──────────────────────────────│                              │
  │ {token, user}                 │                              │
  │                               │                              │
  │ sazinka.onboarding.profile    │                              │
  │ {name, businessName, phone,   │                              │
  │  ico, locale}                 │                              │
  │──────────────────────────────▶│                              │
  │                               │ UPDATE user profile fields   │
  │◀──────────────────────────────│                              │
  │ {ok}                          │                              │
  │                               │                              │
  │ sazinka.onboarding.devices    │                              │
  │ {selectedTypes: [{key,        │                              │
  │   duration, interval}],       │                              │
  │  customTypes: [{label,        │                              │
  │   duration, interval}]}       │                              │
  │──────────────────────────────▶│                              │
  │                               │ deactivate unselected        │
  │                               │   builtin types              │
  │                               │ update duration/interval for │
  │                               │   selected types             │
  │                               │ create custom types          │
  │◀──────────────────────────────│                              │
  │ {deviceTypes: [...]}          │                              │
  │                               │                              │
  │ sazinka.onboarding.complete   │                              │
  │ {depot: {name, street, city,  │                              │
  │  postalCode, lat, lng}}       │                              │
  │──────────────────────────────▶│                              │
  │                               │ INSERT depot (is_primary)    │
  │                               │ INSERT crew "Crew 1"         │
  │                               │   → home_depot_id = depot    │
  │                               │ UPDATE user.default_crew_id  │
  │                               │ UPDATE user.default_depot_id │
  │                               │ SET onboarding_completed_at  │
  │◀──────────────────────────────│                              │
  │ {settings}                    │                              │
```

### 6. Country Availability & Waitlist

#### 6.1 Landing page behaviour

| Country | UI | Action |
|---------|-----|--------|
| CZ (`is_supported = true`, `coming_soon = false`) | Flag + "Available now" badge + "Start free trial" button | Proceeds to Step 1 with `country = "CZ"` |
| Countries where `coming_soon = true` (e.g. SK, AT, ...) | Flag + name + "Coming soon" badge. Rendered as a **dynamic list** from DB. | Each has a "Notify me" link → opens email input inline |
| Others | "Different country?" link below the Coming Soon list | Opens mini-form: email + country picker (lazy) → `INSERT INTO country_waitlist` |

#### 6.2 Country picker lazy loading

The landing page renders:
- **CZ card** statically (always visible),
- **Coming soon list** dynamically from DB (`coming_soon = true`),
- and lazily loads the full country picker only for "Different country?" flow.

The full `CountrySelect` dropdown is loaded **only** when the user clicks "Different country?":

1. `React.lazy(() => import('@/components/common/CountrySelect'))` loads the component chunk.
2. The component itself lazy-loads the country data on first dropdown open (existing behaviour).

Zero extra JS or data fetched until the user explicitly asks for it.

#### 6.3 New DB table: `country_waitlist`

```sql
CREATE TABLE country_waitlist (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email       VARCHAR(255) NOT NULL,
    country     CHAR(2) NOT NULL,
    locale      VARCHAR(10) NOT NULL DEFAULT 'en',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(email, country)
);

CREATE INDEX idx_waitlist_country ON country_waitlist(country);
```

#### 6.4 New column on `countries` table

```sql
ALTER TABLE countries
    ADD COLUMN coming_soon BOOLEAN NOT NULL DEFAULT false;

UPDATE countries SET coming_soon = true WHERE code = 'SK';
```

### 7. Email Verification

#### 7.1 DB migration

```sql
ALTER TABLE users
    ADD COLUMN email_verified         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN verification_token_hash VARCHAR(128),  -- e.g. argon2 or SHA-256 hex
    ADD COLUMN verification_expires   TIMESTAMPTZ,
    ADD COLUMN tos_accepted_at        TIMESTAMPTZ;    -- GDPR: when user accepted ToS + Privacy Policy

-- Auto-verify all existing users
UPDATE users SET email_verified = true
WHERE password_hash != 'not-set';

CREATE INDEX idx_users_verification_token_hash
    ON users(verification_token_hash)
    WHERE verification_token_hash IS NOT NULL;
```

#### 7.2 Token generation

- 32-byte random token, hex-encoded (64 chars). Send raw token in email link.
- Store **hash** of token in DB (`verification_token_hash`), not plaintext. On verify: hash incoming token, lookup by hash, check expiry.
- Expires after **24 hours**.
- **Token reuse on resend**: If the user clicks "Resend", do not immediately overwrite the token. If the existing token is still valid (unexpired), resend the same token. This ensures that if the first email arrives delayed and the user clicks it, the link is still valid. If expired, generate a new one.

#### 7.3 Email templates

Sent via Resend through the existing `EmailProcessor` JetStream queue. Templates are locale-aware:

**1. Verification email (new user):**
| Locale | Subject | Body (excerpt) |
|--------|---------|----------------|
| en | "Verify your Ariadline account" | "Click the link below to verify your email. This link expires in 24 hours." |
| cs | "Ověřte svůj účet Ariadline" | "Kliknutím na odkaz níže ověříte svou e-mailovou adresu. Odkaz je platný 24 hodin." |
| sk | "Overte svoj účet Ariadline" | "Kliknutím na odkaz nižšie overíte svoju e-mailovú adresu. Odkaz je platný 24 hodín." |

**2. Already registered (anti-enumeration):**
If an existing verified user tries to register again, we send this email to prevent them from getting stuck, without revealing to the submitter (who might be an attacker) that the account exists.
| Locale | Subject | Body (excerpt) |
|--------|---------|----------------|
| en | "Account already exists" | "You (or someone else) recently tried to register with this email. You already have an account! Click here to log in." |
| cs | "Účet již existuje" | "Někdo se pokusil zaregistrovat s tímto e-mailem. Účet u nás již máte! Klikněte zde pro přihlášení." |
| sk | "Účet už existuje" | "Niekto sa pokúsil zaregistrovať s týmto e-mailom. Účet u nás už máte! Kliknite sem pre prihlásenie." |

#### 7.4 Verification link format

```
{APP_BASE_URL}/verify-email?token=<hex_token>
```

`APP_BASE_URL` (or `VERIFICATION_BASE_URL`) is configurable: dev/staging use `http://localhost:5173` etc.; production uses `https://app.ariadline.cz`.

Frontend route `/verify-email` reads the token, sends `sazinka.auth.verify-email`, stores JWT, redirects to Step 2.

#### 7.5 Resend verification

"Resend verification email" button with **60-second cooldown** (frontend timer + backend rate limit). NATS subject: `sazinka.auth.resend-verification`.

### 8. Device Type Selection (Step 3)

#### 8.1 Purpose

When a new tenant is created, the DB trigger `seed_device_types_for_tenant` inserts 5 builtin device types with Czech labels. Step 3 lets the user:

1. **Select** which builtin types are relevant (checkbox toggle).
2. **Adjust** default duration and revision interval per selected type.
3. **Add custom** device types (label + duration + interval).

Unselected builtin types are **deactivated** (`is_active = false`), not deleted — so they can be re-enabled later in Settings.

#### 8.2 Builtin types presented

Chimney is listed **first and pre-selected** (target market: chimney sweepers). All others unchecked by default.

| # | Key | i18n key | EN label | Duration | Interval | Default |
|---|-----|----------|----------|----------|----------|---------|
| 1 | `chimney` | `device_type_chimney` | Chimney | 30 min | 12 months | **checked** |
| 2 | `gas_boiler` | `device_type_gas_boiler` | Gas boiler | 60 min | 12 months | unchecked |
| 3 | `gas_water_heater` | `device_type_gas_water_heater` | Gas water heater | 45 min | 12 months | unchecked |
| 4 | `fireplace` | `device_type_fireplace` | Fireplace / insert | 30 min | 12 months | unchecked |
| 5 | `gas_stove` | `device_type_gas_stove` | Gas stove | 20 min | 36 months | unchecked |

All labels are **localized** — no hardcoded Czech. The `sort_order` in the wizard overrides DB `sort_order` to put chimney first.

#### 8.3 Custom type creation

Minimal: just **label**, **duration**, and **interval**. Custom fields can be added later in Settings. This keeps the wizard simple.

#### 8.4 Backend handler: `sazinka.onboarding.devices`

```rust
pub struct OnboardingDevicesRequest {
    /// Builtin types the user selected (with optional overrides)
    pub selected_builtins: Vec<BuiltinSelection>,
    /// New custom types to create
    pub custom_types: Vec<CustomTypeCreation>,
}

pub struct BuiltinSelection {
    pub device_type_key: String,
    pub default_revision_duration_minutes: Option<i32>,
    pub default_revision_interval_months: Option<i32>,
}

pub struct CustomTypeCreation {
    pub label: String,
    pub default_revision_duration_minutes: i32,
    pub default_revision_interval_months: i32,
}
```

Logic:
1. Get tenant_id for user.
2. For each builtin type NOT in `selected_builtins` → `UPDATE SET is_active = false`.
3. For each builtin type IN `selected_builtins` → `UPDATE SET duration, interval` if overridden.
4. For each `custom_types` entry → `INSERT INTO device_type_configs` (is_builtin = false).

#### 8.5 Depot geocoding UX flow (Step 4)

Geocoding is **mandatory** — the app relies on depot coordinates for route planning. The flow handles loading, success, failure, and rate limiting:

```
User fills in Street, City, Postal code
        │
        ▼
[Verify address]  ← button (enabled when all 3 fields non-empty)
        │
        ▼
┌────────────────────────────────────────────────────────┐
│  ⟳ Verifying address...                                │
│  (spinner, button disabled, fields read-only)          │
└────────────────────────────────────────────────────────┘
        │
        ├── SUCCESS ─────────────────────────────────────┐
        │   ┌────────────────────────────────────────────┐
        │   │  ✅ Address verified                        │
        │   │  Coordinates: 49.1951°N, 16.6068°E         │
        │   │  [Continue →] enabled                       │
        │   └────────────────────────────────────────────┘
        │
        ├── GEOCODE FAILED (no result) ──────────────────┐
        │   ┌────────────────────────────────────────────┐
        │   │  ⚠ Could not find this address.            │
        │   │  Please check the street, city and postal  │
        │   │  code, then try again.                     │
        │   │                                            │
        │   │  [Try again]                               │
        │   │                                            │
        │   │  Or pin the location manually:             │
        │   │  ┌──────────────────────────────────────┐  │
        │   │  │                                      │  │
        │   │  │         [Interactive Map]            │  │
        │   │  │      (Click to drop a pin)           │  │
        │   │  │                                      │  │
        │   │  └──────────────────────────────────────┘  │
        │   │  [Use pinned location]                     │
        │   └────────────────────────────────────────────┘
        │
        ├── NETWORK ERROR ───────────────────────────────┐
        │   ┌────────────────────────────────────────────┐
        │   │  ⚠ Verification failed. Please try again.  │
        │   │  [Retry]                                   │
        │   └────────────────────────────────────────────┘
        │
        └── RATE LIMITED ────────────────────────────────┐
            ┌────────────────────────────────────────────┐
            │  ⚠ Too many attempts. Please wait a moment │
            │  and try again.                            │
            │  [Retry] (disabled for 30s, countdown)     │
            └────────────────────────────────────────────┘
```

**Rate limit:** 5 geocode requests per user per 5 minutes. This prevents abuse of the Nominatim instance during onboarding. Uses the same `MultiRateLimiter` infrastructure.

**Manual coordinates fallback:** If geocoding repeatedly fails (e.g. new address not yet in Nominatim), an interactive map (e.g., Leaflet) is displayed centered on the selected country. The user can click to drop a pin to set their depot location directly. The "Use pinned location" button validates that the dropped pin is within plausible range for the selected country (e.g. CZ: lat 48.5–51.1, lng 12.0–18.9).

**"Continue" button state:**
- Disabled until address is verified (either via geocode or pinned location).
- Stays enabled after successful verification — editing the address fields resets the verification state, requiring re-verification.

---

### 9. Rate Limiting & DDoS Protection

#### 9.1 Backend rate limits

| Endpoint | Limit | Key | Window |
|----------|-------|-----|--------|
| `sazinka.auth.register.start` | 3 per email, 10 per IP | email + IP | 15 min |
| `sazinka.auth.verify-email` | 5 per token | token prefix | 15 min |
| `sazinka.auth.resend-verification` | 2 per email | email | 5 min |
| `sazinka.auth.login` | 5 per email (existing) | email | 5 min |
| `sazinka.onboarding.geocode.depot` | 5 per user | user_id | 5 min |
| `sazinka.waitlist.join` | 3 per email | email | 1 hour |

#### 9.2 Implementation

Extend the existing `RateLimiter` into a `MultiRateLimiter`:

```rust
pub struct RateLimiterConfig {
    pub max_attempts: u32,
    pub window_seconds: u64,
}

pub struct MultiRateLimiter {
    limiters: HashMap<String, RateLimiter>,
}
```

#### 9.3 DDoS protection (infrastructure layer)

- **Cloudflare proxy** in front of the app domain — automatic L3/L4/L7 DDoS mitigation, bot management, WAF rate limiting rules as second layer.
- **NATS** not publicly exposed (internal Docker network only).
- **WebSocket** endpoint (NATS over WS) is the only public surface — Cloudflare proxies it.

### 10. Free Trial Messaging

30-day free trial, no credit card. Texts for all three locales:

| Key | EN | CS | SK |
|-----|-----|-----|-----|
| `trial_badge` | "30 days free" | "30 dní zdarma" | "30 dní zadarmo" |
| `trial_no_card` | "No credit card required" | "Bez platební karty" | "Bez platobnej karty" |
| `trial_started` | "Your 30-day free trial starts today. We'll remind you before it ends — no surprises." | "Vaše 30denní zkušební období začíná dnes. Upozorníme vás před jeho koncem — žádná překvapení." | "Vaše 30-dňové skúšobné obdobie začína dnes. Upozorníme vás pred jeho koncom — žiadne prekvapenia." |

### 11. "Behind the scenes" — What the backend does at each step

| Step | Backend action |
|------|---------------|
| Landing page load | Fetch supported + coming-soon countries from DB (public endpoint, no auth; lightweight query, cached) |
| Landing → "Start free trial" | Nothing (country stored in frontend wizard state) |
| Landing → "Notify me" (Coming Soon or Other) | `INSERT INTO country_waitlist` |
| Step 1 → Continue | `INSERT INTO users` (email_verified=false, tos_accepted_at=now()), generate/store verification token hash, send verification email. |
| Email link clicked | `UPDATE users SET email_verified=true`, create tenant + user_tenant relation (triggers `seed_device_types_for_tenant`), issue JWT |
| Step 2 → Continue | `UPDATE users SET name, business_name, phone, ico, locale, country` |
| Step 3 → Continue | Deactivate unselected builtins, update selected overrides, create custom types |
| Step 4 → "Verify address" | Call Nominatim geocoder (`sazinka.onboarding.geocode.depot`) |
| Step 4 → Continue | `INSERT INTO depots`, `INSERT INTO crews` (label from i18n key `onboarding_default_crew_name`), update user defaults, set `onboarding_completed_at` |
| Step 5 → "Go to Dashboard" | Frontend redirect (data already saved) |

### 12. Lazy Loading Strategy

```
/login           ← eagerly loaded (Login.tsx)
/register        ← lazy-loaded (entire wizard module)
  ├── Landing    ← rendered immediately, CZ card static + Coming Soon from API
  ├── WaitlistForm  ← lazy-loaded on "Different country?" click
  │   └── CountrySelect ← lazy-loaded on dropdown open (existing)
  ├── StepIndicator ← rendered on all wizard steps (1–5)
  ├── Step1Account  ← rendered on "Start free trial" click
  ├── VerifyEmail   ← rendered after Step 1 submit
  ├── Step2Profile  ← rendered after email verified
  ├── Step3Devices  ← rendered after Step 2 submit
  ├── Step4Depot    ← rendered after Step 3 submit
  │   └── LeafletMap ← lazy-loaded on geocode failure (fallback only)
  └── Step5Done     ← rendered after Step 4 submit
/verify-email    ← lazy-loaded (thin wrapper, calls verify then redirects)
```

The wizard is a single lazy chunk. Sub-steps are plain components (not further code-split) since the wizard module itself is already deferred. `CountrySelect` stays in its own chunk because it pulls in the full 200+ country dataset. The **Leaflet map** (interactive fallback for geocoding failure) is also a separate lazy chunk — it's a large dependency only needed in the rare case that Nominatim fails.

### 13. TDD Implementation Plan

#### Phase A: Database & Types (backend) ✅ DONE

##### A1. Migration 023 — email verification columns

**Red:**
```rust
#[test]
fn user_has_email_verified_field() {
    // query user → assert email_verified exists and defaults to false
}
#[test]
fn user_has_verification_token_hash_field() {
    // insert user → set verification_token_hash → query back → assert match
}
```

**Green:** Migration adding `email_verified`, `verification_token_hash`, `verification_expires` to `users`. Backfill existing users as verified.

**Refactor:** Update `User` struct, `USER_COLUMNS`, `UserPublic` to include `emailVerified`.

##### A2. Migration 024 — country_waitlist table + countries.coming_soon

**Red:**
```rust
#[test]
fn can_insert_and_query_waitlist_entry() { ... }
#[test]
fn waitlist_unique_constraint_on_email_country() { ... }
#[test]
fn country_has_coming_soon_field() { ... }
```

**Green:** Migration creating `country_waitlist`, adding `coming_soon` to `countries`.

**Refactor:** Create `CountryWaitlistEntry` type, update `Country` struct.

##### A3. Migration 025 — onboarding progress columns

**Red:**
```rust
#[test]
fn user_has_onboarding_completed_at() {
    // newly created user → assert onboarding_completed_at IS NULL
}
#[test]
fn user_has_onboarding_step() {
    // newly created user → assert onboarding_step = 2 after verification
}
```

**Green:** 
- `ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ;`
- `ALTER TABLE users ADD COLUMN onboarding_step SMALLINT NOT NULL DEFAULT 0;`  
  (`0` = pre-verification, `2` = at About you, `3` = at Devices, `4` = at Depot, `5` = at All set, `6` = completed)
- Backfill existing users: `UPDATE users SET onboarding_completed_at = created_at, onboarding_step = 6 WHERE email_verified = true`.

##### A4. Shared types — new message payloads

**Red (TypeScript):**
```typescript
describe('RegisterStartRequest', () => {
    it('requires email, password, locale, country', () => { ... });
});
describe('OnboardingDevicesRequest', () => {
    it('requires selectedBuiltins array', () => { ... });
});
describe('OnboardingCompleteRequest', () => {
    it('requires depot fields', () => { ... });
});
```

**Green:** Add types to `packages/shared-types/src/auth.ts` and `packages/shared-types/src/onboarding.ts`.

---

#### Phase B: Backend Handlers ✅ DONE (B1–B3, B7, B8)

##### B1. `handle_register_start` — create unverified user + send email

**Red:**
```rust
#[tokio::test]
async fn register_start_creates_unverified_user() { ... }
#[tokio::test]
async fn register_start_stores_verification_token_hash() { ... }
#[tokio::test]
async fn register_start_sends_already_registered_email_for_verified_duplicate() { ... }  // anti-enumeration
#[tokio::test]
async fn register_start_resends_verification_for_unverified_duplicate() { ... }  // re-engage abandoned signup
#[tokio::test]
async fn register_start_rate_limited() { ... }
```

**Green:** Handler on `sazinka.auth.register.start`:
1. Validate email + password (min 8 chars, at least 1 uppercase + 1 lowercase + 1 digit — per Q4).
2. Check rate limit.
3. If email already exists **and verified**: publish "Already Registered" email job (with login link) to JetStream and return generic success — anti-enumeration (section 16.2).
4. If email already exists **but unverified**: re-send the verification email (reuse existing valid token per section 7.2, or generate new if expired) and return generic success.
5. Hash password, insert user (`email_verified = false`).
6. Generate verification token, hash it, store hash with 24h expiry.
7. Publish verification email job to JetStream.
8. Return generic success message.

##### B2. `handle_verify_email` — verify token, issue JWT

**Red:**
```rust
#[tokio::test]
async fn verify_email_activates_user() { ... }
#[tokio::test]
async fn verify_email_returns_jwt() { ... }
#[tokio::test]
async fn verify_email_rejects_expired_token() { ... }
#[tokio::test]
async fn verify_email_rejects_invalid_token() { ... }
#[tokio::test]
async fn verify_email_rejects_already_verified() { ... }
```

**Green:** Handler on `sazinka.auth.verify-email`. On success, create tenant mapping, issue JWT, and set `users.onboarding_step = 2`.

##### B3. `handle_resend_verification`

**Red:**
```rust
#[tokio::test]
async fn resend_reuses_valid_unexpired_token() { ... }
#[tokio::test]
async fn resend_rate_limited() { ... }
#[tokio::test]
async fn resend_rejects_already_verified() { ... }
```

**Green:** Handler on `sazinka.auth.resend-verification`. Return generic success (anti-enumeration; see section 16.2).

##### B4. `handle_onboarding_profile` — save user profile fields

**Red:**
```rust
#[tokio::test]
async fn onboarding_profile_updates_user() {
    // send name, phone, ico → query user → assert fields set
}
#[tokio::test]
async fn onboarding_profile_rejects_unverified() { ... }
```

**Green:** Handler on `sazinka.onboarding.profile`. On success, set `users.onboarding_step = GREATEST(onboarding_step, 3)`.

##### B5. `handle_onboarding_devices` — configure device types

**Red:**
```rust
#[tokio::test]
async fn onboarding_devices_deactivates_unselected_builtins() {
    // select only gas_boiler + chimney → query configs → assert 3 others inactive
}
#[tokio::test]
async fn onboarding_devices_updates_duration_override() {
    // select gas_boiler with duration=90 → query → assert 90
}
#[tokio::test]
async fn onboarding_devices_creates_custom_type() {
    // send custom type "Heat pump" → query → assert exists, is_builtin=false
}
#[tokio::test]
async fn onboarding_devices_rejects_unverified() { ... }
```

**Green:** Handler on `sazinka.onboarding.devices`. On success, set `users.onboarding_step = GREATEST(onboarding_step, 4)`.

##### B6. `handle_onboarding_complete` — save depot + create crew

**Red:**
```rust
#[tokio::test]
async fn onboarding_creates_depot_and_crew() {
    // complete with depot → query depots → assert 1 primary
    // query crews → assert "Crew 1" linked to depot
}
#[tokio::test]
async fn onboarding_sets_default_ids() {
    // complete → query user → assert default_crew_id, default_depot_id set
}
#[tokio::test]
async fn onboarding_sets_completed_at() {
    // complete → query user → assert onboarding_completed_at IS NOT NULL
}
#[tokio::test]
async fn onboarding_rejects_unverified() { ... }
```

**Green:** Handler on `sazinka.onboarding.complete`. Wrap in transaction and set `users.onboarding_step = 6`.

##### B7. `handle_waitlist_join`

**Red:**
```rust
#[tokio::test]
async fn waitlist_join_inserts_entry() { ... }
#[tokio::test]
async fn waitlist_join_idempotent() { ... }
#[tokio::test]
async fn waitlist_join_rate_limited() { ... }
```

**Green:** Handler on `sazinka.waitlist.join`.

##### B8. MultiRateLimiter

**Red:**
```rust
#[test]
fn multi_rate_limiter_independent_configs() { ... }
```

**Green:** Extend `RateLimiter` into `MultiRateLimiter`.

---

#### Phase C: Email Abstraction Layer & Resend Integration ✅ DONE (C0, C1)

The current `EmailProcessor` is tightly coupled to JetStream and has no abstraction for the actual send operation. We need a trait-based abstraction so that:

- **Production**: sends via Resend HTTP API.
- **Development**: logs emails to console + writes to a local file (inspectable).
- **Tests**: captures sent emails in memory for assertions.

##### C0. `EmailSender` trait + implementations

**Location:** `worker/src/services/email.rs` (new module, replaces direct Resend coupling in `email_processor.rs`)

**Red:**
```rust
#[test]
fn email_message_builder_sets_all_fields() {
    let msg = EmailMessage::new("to@example.com", "Subject", "<p>Body</p>")
        .with_text("Body")
        .with_from("sender@example.com", "Sender");
    assert_eq!(msg.to, "to@example.com");
    assert_eq!(msg.subject, "Subject");
    assert!(msg.from_email.is_some());
}

#[tokio::test]
async fn fake_sender_captures_emails() {
    let sender = FakeEmailSender::new();
    sender.send(&EmailMessage::new("a@b.com", "Hi", "<p>Hi</p>")).await.unwrap();
    let sent = sender.sent_emails();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].to, "a@b.com");
}

#[tokio::test]
async fn fake_sender_can_simulate_failure() {
    let sender = FakeEmailSender::new().with_failure("Simulated outage");
    let result = sender.send(&EmailMessage::new("a@b.com", "Hi", "<p>Hi</p>")).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn log_sender_does_not_fail() {
    let sender = LogEmailSender::new();
    sender.send(&EmailMessage::new("a@b.com", "Hi", "<p>Hi</p>")).await.unwrap();
    // no panic, email logged to tracing + file
}
```

**Green:**

```rust
/// A single outbound email.
pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
    pub from_email: Option<String>,
    pub from_name: Option<String>,
}

/// Result of a send operation.
pub struct SendResult {
    pub message_id: String,
}

/// Abstraction over email delivery.
#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send(&self, message: &EmailMessage) -> Result<SendResult>;
}

// --- Implementations ---

/// Production: sends via Resend HTTP API.
pub struct ResendEmailSender { api_key: String, from_email: String, from_name: String }

/// Development: logs to tracing (info level) + appends to `logs/emails.jsonl`.
pub struct LogEmailSender { log_dir: PathBuf }

/// Tests: captures emails in Arc<Mutex<Vec<EmailMessage>>>, optionally simulates failures.
pub struct FakeEmailSender { sent: Arc<Mutex<Vec<EmailMessage>>>, fail_with: Option<String> }
```

**Selection logic** (in `main.rs` or config):
```rust
fn create_email_sender() -> Arc<dyn EmailSender> {
    if let Ok(api_key) = std::env::var("RESEND_API_KEY") {
        Arc::new(ResendEmailSender::new(&api_key, ...))
    } else {
        info!("RESEND_API_KEY not set — using LogEmailSender (dev mode)");
        Arc::new(LogEmailSender::new("logs"))
    }
}
```

Tests inject `FakeEmailSender` directly.

**Refactor:** `EmailProcessor` receives `Arc<dyn EmailSender>` instead of `Option<EmailConfig>`. The `process_job` method calls `self.sender.send(...)` instead of having a `TODO: Implement actual email sending` comment.

##### C1. Email templates

**Red:**
```rust
#[test]
fn verification_email_renders_en() {
    let html = render_verification_email("https://...", "en");
    assert!(html.contains("Verify your"));
}
#[test]
fn verification_email_renders_cs() {
    let html = render_verification_email("https://...", "cs");
    assert!(html.contains("Ověřte"));
}
#[test]
fn verification_email_renders_sk() {
    let html = render_verification_email("https://...", "sk");
    assert!(html.contains("Overte"));
}
#[test]
fn already_registered_email_renders_en() {
    let html = render_already_registered_email("https://...", "en");
    assert!(html.contains("already have an account"));
}
```

**Green:** 
- `render_verification_email(link: &str, locale: &str) -> EmailMessage` — returns a fully-formed `EmailMessage` with locale-aware subject + HTML body for new users.
- `render_already_registered_email(link: &str, locale: &str) -> EmailMessage` — returns `EmailMessage` for duplicate registration attempts.

##### C2. ResendEmailSender HTTP implementation

**Red:**
```rust
#[tokio::test]
async fn resend_sender_posts_to_api() {
    // Use a mock HTTP server (e.g. wiremock) to verify:
    // - POST to /emails
    // - Authorization: Bearer <api_key>
    // - JSON body contains to, from, subject, html
    // - Returns message_id from mock response
}

#[tokio::test]
async fn resend_sender_returns_error_on_4xx() {
    // Mock returns 422 → assert Result::Err with meaningful message
}
```

**Green:** `ResendEmailSender::send()` — HTTP POST to `https://api.resend.com/emails` using `reqwest`. Parses response for `id` field.

##### C3. LogEmailSender for development

**Red:**
```rust
#[tokio::test]
async fn log_sender_writes_to_file() {
    let dir = tempdir().unwrap();
    let sender = LogEmailSender::new(dir.path());
    sender.send(&EmailMessage::new("a@b.com", "Test", "<p>Test</p>")).await.unwrap();
    let content = std::fs::read_to_string(dir.path().join("emails.jsonl")).unwrap();
    assert!(content.contains("a@b.com"));
}
```

**Green:** `LogEmailSender::send()` — logs via `tracing::info!`, appends JSON line to `logs/emails.jsonl`. The file is human-readable and can be tailed during development (`tail -f logs/emails.jsonl`).

**Dev workflow:** When a verification email is "sent" in dev mode, the developer sees:

```
INFO  email: [DEV] Email to=user@example.com subject="Verify your Ariadline account"
INFO  email: [DEV] Verification link: https://app.ariadline.cz/verify-email?token=abc123...
```

The full email (HTML, text, headers) is in `logs/emails.jsonl` for inspection.

---

#### Phase D: Frontend — Wizard Components ✅ DONE

##### D1. StepIndicator component

**Red:**
```typescript
describe('StepIndicator', () => {
    it('renders 5 steps with labels', () => { ... });
    it('marks completed steps with checkmark', () => { ... });
    it('highlights current step', () => { ... });
    it('makes completed steps clickable', () => { ... });
    it('disables future steps', () => { ... });
    it('works on mobile (labels hidden, circles visible)', () => { ... });
});
```

**Green:** `StepIndicator.tsx` — horizontal stepper, localized labels.

##### D2. Wizard shell + state management

**Red:**
```typescript
describe('OnboardingWizard', () => {
    it('renders Landing step by default', () => { ... });
    it('advances to Step1 on "Start free trial" click', () => { ... });
    it('shows StepIndicator on steps 1-5 but not on Landing', () => { ... });
    it('preserves state across steps (country, locale, email)', () => { ... });
    it('allows navigating back to completed steps via StepIndicator', () => { ... });
});
```

**Green:** `OnboardingWizard.tsx` — state machine, React context for shared state.

**Refactor:** Update `/register` route to use new wizard.

##### D3. Landing step

**Red:**
```typescript
describe('Landing', () => {
    it('shows CZ as available with "Start free trial" button', () => { ... });
    it('shows SK as "Coming soon" with disabled button', () => { ... });
    it('shows "Different country?" link', () => { ... });
    it('lazy-loads WaitlistForm on "Different country?" click', () => { ... });
    it('shows language switcher (en/cs/sk)', () => { ... });
    it('shows free trial badge', () => { ... });
    it('links to /login', () => { ... });
});
```

**Green:** `Landing.tsx`.

##### D4. WaitlistForm (lazy)

**Red:**
```typescript
describe('WaitlistForm', () => {
    it('renders email input and lazy CountrySelect', () => { ... });
    it('submits to sazinka.waitlist.join', () => { ... });
    it('shows success message after submit', () => { ... });
    it('shows error on rate limit', () => { ... });
});
```

**Green:** `WaitlistForm.tsx`.

##### D5. Step1Account

**Red:**
```typescript
describe('Step1Account', () => {
    it('renders email, password, confirm password fields', () => { ... });
    it('shows password strength indicator', () => { ... });
    it('validates password match before submit', () => { ... });
    it('validates minimum length', () => { ... });
    it('shows ToS + Privacy Policy checkbox with links', () => { ... });
    it('disables Continue until ToS checkbox is checked', () => { ... });
    it('submits to sazinka.auth.register.start', () => { ... });
    it('transitions to VerifyEmail on success (always shows generic success — anti-enumeration)', () => { ... });
    it('shows rate limit error', () => { ... });
    it('Back discards form and returns to Landing — user starts registration from scratch', () => { ... });
});
```

**Green:** `Step1Account.tsx`.

##### D6. VerifyEmail interstitial

**Red:**
```typescript
describe('VerifyEmail', () => {
    it('shows "Check your inbox" with email address', () => { ... });
    it('shows "Resend" button', () => { ... });
    it('disables "Resend" for 60s after click', () => { ... });
    it('shows countdown timer', () => { ... });
});
```

**Green:** `VerifyEmail.tsx`.

##### D7. `/verify-email` route

**Red:**
```typescript
describe('VerifyEmailRoute', () => {
    it('reads token from URL', () => { ... });
    it('calls sazinka.auth.verify-email', () => { ... });
    it('stores JWT, redirects to step 2 on success', () => { ... });
    it('shows error on invalid/expired token', () => { ... });
});
```

**Green:** New lazy route `/verify-email` → `VerifyEmailCallback.tsx`.

##### D8. Step2Profile

**Red:**
```typescript
describe('Step2Profile', () => {
    it('pre-fills locale and country from wizard state', () => { ... });
    it('requires name', () => { ... });
    it('makes business name, phone, ICO optional', () => { ... });
    it('submits to sazinka.onboarding.profile', () => { ... });
    it('advances to Step3', () => { ... });
});
```

**Green:** `Step2Profile.tsx`.

##### D9. Step3Devices

**Red:**
```typescript
describe('Step3Devices', () => {
    it('fetches builtin device types on mount', () => { ... });
    it('renders checkbox list of 5 builtin types', () => { ... });
    it('shows Chimney first and pre-checked', () => { ... });
    it('shows all other types unchecked by default', () => { ... });
    it('shows duration and interval for each type', () => { ... });
    it('allows expanding a selected type to edit duration/interval', () => { ... });
    it('shows "Add custom device type" button', () => { ... });
    it('allows adding a custom type with label/duration/interval', () => { ... });
    it('requires at least 1 type selected to continue', () => { ... });
    it('disables Continue when all types are unchecked', () => { ... });
    it('submits to sazinka.onboarding.devices', () => { ... });
    it('advances to Step4', () => { ... });
});
```

**Green:** `Step3Devices.tsx`.

##### D10. Step4Depot

**Red:**
```typescript
describe('Step4Depot', () => {
    it('renders depot name, street, city, postal code', () => { ... });
    it('disables "Verify address" until street+city+postal filled', () => { ... });
    it('shows loading spinner during geocoding', () => { ... });
    it('shows verified lat/lng on success', () => { ... });
    it('enables "Continue" only after verification', () => { ... });
    it('shows error + retry on geocode failure', () => { ... });
    it('shows interactive map fallback on geocode failure', () => { ... });
    it('validates pinned coords are within country bounds', () => { ... });
    it('resets verification state when address fields change', () => { ... });
    it('shows rate limit message when too many attempts', () => { ... });
    it('submits to sazinka.onboarding.complete', () => { ... });
    it('advances to Step5', () => { ... });
});
```

**Green:** `Step4Depot.tsx`.

##### D11. Step5Done

**Red:**
```typescript
describe('Step5Done', () => {
    it('shows summary (account, N device types, depot, crew)', () => { ... });
    it('shows free trial message', () => { ... });
    it('navigates to / on button click', () => { ... });
});
```

**Green:** `Step5Done.tsx`.

##### D12. i18n — onboarding namespace

**Red:**
```typescript
describe('onboarding translations', () => {
    it('has all keys in en', () => { ... });
    it('has all keys in cs', () => { ... });
    it('has all keys in sk', () => { ... });
    it('has no missing keys vs en baseline', () => { ... });
});
```

**Green:** Create `apps/web/public/locales/{en,cs,sk}/onboarding.json`.

---

#### Phase E: Integration & Auth Guard ✅ DONE

##### E1. Protect app behind email_verified

**Red:**
```rust
#[tokio::test]
async fn unverified_user_cannot_access_protected_endpoints() { ... }
```

**Green:** Add `email_verified` to JWT payload. Frontend `ProtectedRoute` checks `user.emailVerified`. Unverified user redirected to wizard.

##### E2. Existing users backward compat

**Green:** Migration backfills `email_verified = true` for existing users (done in A1). `onboarding_completed_at` backfilled in A3.

##### E3. Incomplete onboarding redirect

**Red:**
```typescript
describe('OnboardingGuard', () => {
    it('redirects to wizard step 2 if profile not complete', () => { ... });
    it('allows access to dashboard if onboarding complete', () => { ... });
});
```

**Green:** `ProtectedRoute` checks `user.onboardingCompletedAt`. If null → redirect to `/register` and resume from `user.onboardingStep`.

---

### 14. Implementation Order (dependency graph)

```
A1 (migration: email_verified)
 └─▶ A4 (shared types)
      ├─▶ B1 (register.start)
      │    └─▶ B2 (verify-email)
      │         ├─▶ B4 (onboarding.profile)
      │         │    └─▶ B5 (onboarding.devices)
      │         │         └─▶ B6 (onboarding.complete)
      │         │              └─▶ E1 (auth guard)
      │         └─▶ B3 (resend-verification)
      └─▶ B8 (MultiRateLimiter) ←── used by B1–B3, B7

A2 (migration: waitlist + coming_soon) ──▶ B7 (waitlist.join)
A3 (migration: onboarding_completed_at) ──▶ E3 (onboarding guard)

C0 (EmailSender trait + Fake + Log) ──▶ C1 (email template) ──▶ C2 (Resend impl) + C3 (Log impl) ──▶ B1

D1 (StepIndicator) ──▶ D2 (wizard shell) ──▶ D3..D11 (steps)
D12 (i18n) ←── parallel with D1..D11

E2 (backward compat) ←── after A1 + A3
```

Recommended execution order:
1. **A1 + A2 + A3** — all migrations (parallel)
2. **A4** — shared types
3. **B8** — MultiRateLimiter
4. **C0** — EmailSender trait + FakeEmailSender + LogEmailSender
5. **C1 + C2 + C3** — verification template + ResendEmailSender + LogEmailSender file output
6. **B1 → B2 → B3** — registration flow
7. **B4 → B5 → B6** — onboarding handlers
8. **B7** — waitlist handler
9. **D1 → D2 → D3 → D4 → D5 → D6 → D7 → D8 → D9 → D10 → D11** — frontend
10. **D12** — translations (overlaps with D-phase)
11. **E1 + E2 + E3** — auth guard + backward compat + onboarding guard

### 15. Decisions (resolved)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Auto-delete unverified users after N days? | **Yes.** Background job purges `WHERE email_verified = false AND created_at < now() - interval '7 days'`. |
| Q2 | Allow email change before verification? | **No.** Changing email means abandoning the current registration and starting a new one. |
| Q3 | Verification link target? | **Option A selected.** Open the Ariadline app directly at `/verify-email?token=...`. Frontend reads token, calls backend verification, stores JWT, then continues wizard at Step 2. No intermediate static confirmation page. |
| Q4 | Password strength beyond min 8? | **Enforced.** Minimum 8 characters + at least 1 uppercase + 1 lowercase + 1 digit. Validated on both frontend (real-time indicator) and backend (reject on submit). |
| Q5 | Depot geocoding mandatory? | **Yes.** See section 8.5 for the detailed geocoding UX flow including rate limiting, loading states, and failure handling. |
| Q6 | "Crew 1" name editable in wizard? | **No.** Auto-created with localized label (i18n key `onboarding_default_crew_name`). Editable later in Settings. |
| Q7 | Slovakia: blocked or available with warning? | **Blocked.** Listed under "Coming soon" alongside any other upcoming countries. "Coming soon" is a **dynamic list** of countries where `coming_soon = true`, not just Slovakia. |
| Q8 | Device type labels — Czech only or localized? | **Everything localized.** No Czech-specific hardcoding anywhere. Builtin types use i18n keys (`device_type_chimney`, `device_type_gas_boiler`, etc.). This is a multi-country product from day one. |
| Q9 | Can the user skip the Devices step? | **No.** At least 1 type must be selected. Chimney is pre-selected as the default (target audience: chimney sweepers in Czechia first). The wizard says "You can change this later in Settings." |
| Q10 | Should the wizard be resumable? | **Yes.** JWT is stored after email verification (Step 1). If user returns later, `onboarding_completed_at IS NULL` triggers resume. Resume point is driven by explicit onboarding progress (`onboarding_step`), not inferred from seeded data. |

### 16. Additional Decisions & Implementation Notes

#### 16.1 Answers (from review)

| Topic | Decision |
|-------|----------|
| Depot geocoding NATS subject | **New subject.** Use a dedicated subject for onboarding depot geocoding (e.g. `sazinka.onboarding.geocode.depot`), not the existing geocoding subject. |
| Landing country list | **Exposed.** The list of supported + coming-soon countries is available via a public endpoint (no auth required). |
| Verification token storage | **Stored as hash.** Store `verification_token_hash` in DB (like password reset flows), not the raw token. Compare incoming token by hashing and matching. |
| Crew default name | **Localized.** "Crew 1" must use an i18n key (e.g. `onboarding_default_crew_name`) so it displays correctly in en/cs/sk. |
| Step 1 "Back" button | **Discards form and returns to Landing.** User starts registration from scratch. No partial state is preserved. |

#### 16.2 Suggestions (incorporated)

| Suggestion | Implementation |
|------------|----------------|
| **Anti-enumeration** | `register.start` and `resend-verification` return the same generic success message ("If this email can receive the message, we sent it") regardless of whether the email exists. If the email exists, the backend sends an "Already Registered" email with a login link so legitimate users do not get stuck waiting. |
| **LogEmailSender** | Add `logs/emails.jsonl` to `.gitignore`. Optionally add rotation or max-size limit so the file does not grow unbounded in dev. |
| **Verification link base URL** | Make configurable via `APP_BASE_URL` or `VERIFICATION_BASE_URL`. Dev/staging use `http://localhost:5173` etc.; production uses `https://app.ariadline.cz`. |
| **Lazy loading diagram** | Landing renders: CZ card (static) + Coming Soon list (from public API). Full country picker lazy-loaded only when user clicks "Different country?". |
| **Onboarding Telemetry** | We will track where users drop off (e.g., using Plausible, PostHog, or custom DB tracking). The frontend will emit tracking events at key milestones (Step 1 submit, email verified, Step 3 complete, etc.) to measure funnel conversion. |
| **onboarding_step transitions** | See table 16.4 below. |

#### 16.3 Verification token hash (migration)

See **section 7.1** for the DB migration (`verification_token_hash`). Backend: generate random token, send in email, store `hash(token)` in DB. On verify: hash incoming token, lookup by hash, check expiry.

#### 16.4 onboarding_step transitions

| Handler | Sets `onboarding_step` to |
|---------|---------------------------|
| `verify-email` | 2 (About you) |
| `onboarding.profile` | GREATEST(current, 3) (Devices) |
| `onboarding.devices` | GREATEST(current, 4) (Depot) |
| `onboarding.complete` | 6 (completed) |

Semantics: `0` = pre-verify, `2` = at About you, `3` = at Devices, `4` = at Depot, `5` = at All set, `6` = onboarding completed.

---

*Dokument vytvořen: 2026-01-31*  
*Poslední aktualizace: 2026-02-23 (Phase 10: Onboarding Wizard plan v1.6 — fixes + ToS, Leaflet lazy-load, unverified duplicate handling)*
