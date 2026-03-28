# Sazinka - Workflow & UI Koncept

> **Status:** Production — MVP complete + GA Redesign (Phase 8/9) + Smart Slots (multi-crew, Valhalla) + Auto-recalculation + Chronological insertion + Flexible time windows + Responsive mobile (all phases done) + Onboarding wizard (complete) + Detachable panels (design + implementation) + Inbox search + Customer→Inbox deep-link  
> **Verze:** 0.9.3  
> **Datum:** 2026-03-28

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
│ │ 🏠 Depo Brno       │ │  │           🏠                                │   │
│ │    Start 08:00     │ │  │            ╲  ①                            │   │
│ ├────────────────────┤ │  │             ●──╲  ②                       │   │
│ │ 1. Jan Novák       │ │  │                  ●──╲  ③                  │   │
│ │    08:27 - 09:12   │ │  │                       ●                    │   │
│ │    ⏱️ 45min │ 🔒    │ │  │                      ╱                     │   │
│ ├────────────────────┤ │  │                    🏠                        │   │
│ │ 2. Marie Svobodová │ │  └────────────────────────────────────────────┘   │
│ │    09:35 - 10:05   │ │                                                    │
│ │    ⏱️ 30min        │ │  STATISTIKY                                       │
│ ├────────────────────┤ │  ┌────────────────────────────────────────────┐   │
│ │ ...                │ │  │ Celková vzdálenost:  87 km                 │   │
│ ├────────────────────┤ │  │ Celkový čas:         6h 45min              │   │
│ │ 🏠 Depo Brno       │ │  │ Konflikty:           1 ⚠️                   │   │
│ │    Návrat ~16:30   │ │  └────────────────────────────────────────────┘   │
│ └────────────────────┘ │                                                    │
│ [↻ Re-optimalizovat]   │                                                    │
│ [+ Přidat zastávku]    │                                                    │
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
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ① Jan Novák                                    08:27 - 09:12   │ │
│ │    Lesní 123, Brno                                              │ │
│ │    📞 +420 777 123 456                                          │ │
│ │    Revize kotle │ 45 min                                        │ │
│ │    ⚠️ Parkovat za domem                                         │ │
│ │    [🗺️ Navigovat]  [📞 Volat]  [✓ Hotovo]  [✕ Nezastižen]      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│ ... další zastávky ...                                              │
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

### Stránky a jejich propojení
1. **Dashboard** — CTA: "Fronta k obvolání" (primární), "Plánování dne" (sekundární). Widgety "Po termínu" a "Tento týden" klikatelné → filtr.
2. **Fronta k obvolání** (`/inbox`) — Akce "Naplánovat" přesměruje do Plánovače. Proklik na Detail zákazníka / revize. Fulltext search v kandidátech. Deep-link z Zákazníků s `?customerId=` pro fokus na konkrétního zákazníka.
3. **Kalendář** (`/calendar`) — Klik na revizi → Detail revize. Přepínač Termíny/Naplánované.
4. **Plánovač** (`/plan`) — "Přidat z fronty" s kontextovým filtrem. Klik na položku → detail.
5. **Detail revize** — Centrální hub: status, termín, poznámky, akce podle stavu.
6. **Zákazníci** (`/customers`) — Detail zákazníka + preview panel nabízejí CTA „Zobrazit ve frontě" → deep-link do Inboxu.
7. ~~Můj den (`/today`)~~ → **SLOUČENO DO PLÁN DNE (`/plan`)**

#### Detail revize - struktura stránky (workflow hub)

**1) Sticky header** — Název, Status badge, Klíčové info, Primární CTA (context-aware):
  - Čeká na kontakt → `Domluvit termín`
  - Domluveno → `Otevřít v plánovači (den)`
  - Naplánováno → `Otevřít v plánovači (den)`
  - Hotovo → `Zobrazit výsledek`

**2) Kontext zákazníka** — Jméno, adresa, poznámka, kontakty, mini mapa

**3) Detail revize** — Zařízení, termín, přiřazení

**4) Workflow panel** — Kontextové akce dle stavu

**5) Historie a komunikace** — Timeline hovory, emaily, poznámky, návštěvy

**6) Operativa** — Tisk / PDF / Export, Navigovat

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
└───────────────────────────────────────────┘  └─────────────────────────────┘

┌───────────────────────────────────────────┐  ┌─────────────────────────────┐
│ REVIZE                                    │  │ HISTORIE / KOMUNIKACE        │
│ Zařízení: Kotel ABC-123                   │  │ - 20.01: Voláno, nezastižen  │
│ Interval: 12 měsíců                       │  │ - 25.01: Email o termínu     │
│ Poslední revize: 15.01.2026               │  │ [Přidat záznam]               │
└───────────────────────────────────────────┘  └─────────────────────────────┘
```

---

### Tvorba denní trasy z Plánovacího inboxu

**Cíl:** Uživatel vytváří denní trasu přímo na stránce Fronta (Plánovací inbox), aniž by musel přecházet na stránku Plán dne.

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
7. Trasa se **automaticky ukládá** průběžně (auto-save s debounce 1,5 s)

#### Levý panel — Seznam kandidátů

- Checkbox pro hromadný výběr, kandidáti v trase mají vizuální označení
- Klávesová zkratka `A` — přidat aktuálně vybraného kandidáta do trasy

#### Střední panel — Mapa + Zastávky v trase

- Horní část: mapa se zastávkami a trasou
- Spodní část: kompaktní seznam zastávek s metrikami
- **Auto-save:** Status bar: `● Neuložené změny` → `⟳ Ukládám...` → `✓ Uloženo` → `⚠️ Nepodařilo se uložit [Zkusit znovu]`

#### Pravý panel — Detail kandidáta

- Slot suggestions + tlačítko "Přidat do trasy" / "Odebrat z trasy"

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
|                           | | Vzdál: 45km  Čas: 3h   | | [PŘIDAT DO TRASY]|
|                           | | [Optimalizovat][Vyčistit]| | kbd: A přidat    |
+---------------------------+ +------------------------+ +------------------+
```

#### Klávesové zkratky

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
| Asset | `Device` | Přímé mapování |
| ServiceCycle | Logika v `Device` + `Revision` | Není potřeba nová tabulka |
| Job | `Revision` | Revision = co je potřeba udělat |
| Appointment | `Revision` | Revision = kdy se to má udělat |
| Visit | `Visit` | Historický záznam provedení |

**Klíčové rozhodnutí:** Nezavádět nové entity Job/Appointment. `Revision` pokrývá obojí.

### 2. Stavy revize (ROZHODNUTO)

| UX stav | Mapování | Implementace |
|---------|----------|--------------|
| Plánovaná | `upcoming` | `status='upcoming' AND scheduled_date IS NULL` |
| Domluveno | `scheduled` | `status='scheduled'` |
| Potvrzeno | `confirmed` | `status='confirmed'` |
| Naplánováno v trase | `confirmed` | + `route_order IS NOT NULL` |
| Dokončeno | `completed` | `status='completed'` |
| Odloženo | `upcoming` | + `snooze_until` pole |
| Zrušeno | `cancelled` | `status='cancelled'` |

> Pouze dokončené revize (`status='completed'`) se používají pro výpočet zpoždění.

### 3. Algoritmus nabídky slotů (ROZHODNUTO)

**Insertion Heuristic s Valhalla cache:**
1. Pro zvolený den + posádku načti existující trasu
2. Pro nového zákazníka X zkus vložit mezi každou dvojici
3. Spočítej delta travel time: Δ = t(A,X) + t(X,B) - t(A,B)
4. Simuluj forward pass pro feasibility (ověř časová okna)
5. Skóre: 60% Δ travel, 25% slack, 15% area coherence
6. Vyber top 3-5 slotů, diverzifikuj časy

### 4. Multi-crew a multi-depot (ROZHODNUTO)

**MVP:** `Crew.home_depot_id`, `Crew.preferred_area` (PSČ prefixy), ruční přiřazení, UI "Day load" per posádka.
**V2:** Clustering zakázek do N clusterů, auto-balance load, přepsatelná depa.

### 5. Export Google Maps (ROZHODNUTO)

Segmentace po 8-10 zastávkách → 2-5 odkazů. Fallback: PDF/tisk, KML/GPX, per-zastávka navigace.

---

## Jobs Dashboard (Phase 7D)

> **Status:** Partially implemented (Phase 7D core in `/jobs`)
> **Umístění:** `/admin/jobs` (součást Admin sekce)

### Účel

Centralizovaný monitoring asynchronních úloh zpracovávaných přes JetStream:
- Geocoding (Nominatim), Routing (Valhalla), Importy/Exporty, Email/SMS (budoucí)
- Exporty lze z historie stahovat přímo tlačítkem `Stáhnout export`

### Wireframe

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SAZINKA              Zákazníci  Plán dne  Kalendář  Fronta  Admin         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─ Jobs Dashboard ───────────────────────────────────────────────────────┐ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │ │
│  │  │ Ve frontě   │ │ Zpracování  │ │ Dokončeno   │ │ Selhalo     │      │ │
│  │  │     12      │ │      3      │ │    1,247    │ │      5      │      │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │ │
│  │                                                                         │ │
│  │  ┌─ Aktivní úlohy ────────────────────────────────────────────────────┐│ │
│  │  │  🔄 Valhalla Matrix              ████████████░░░░░░░░ 60%          ││ │
│  │  │  📍 Geocoding Batch              ██████████████████░░ 85%          ││ │
│  │  │  📥 Import CSV                   ████████░░░░░░░░░░░░ 40%          ││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  │                                                                         │ │
│  │  ┌─ Nedávno dokončené / Selhané ──────────────────────────────────────┐│ │
│  │  │  ✓ Geocoding Batch  2m ago  2.3s  │  ✗ Valhalla Matrix 10m ago     ││ │
│  │  │    25 geocoded, 2 failed          │    Error: Connection timeout    ││ │
│  │  │                                    │    [Opakovat] [Zahodit]         ││ │
│  │  └─────────────────────────────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
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
  progress?: number;
  message?: string;
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
}
```

### NATS Subjects

| Subject | Popis |
|---------|-------|
| `sazinka.admin.jobs.list` | Seznam aktivních úloh |
| `sazinka.admin.jobs.stats` | Statistiky front |
| `sazinka.admin.jobs.cancel` | Zrušení úlohy |
| `sazinka.admin.jobs.retry` | Opakování selhané úlohy |

### Integrace

Jobs Dashboard je záložka v Admin sekci: `Admin > Přehled | Export dat | Jobs Dashboard | Nastavení`

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

#### 1.2 Řemeslník (primárně mobil)

**Kontext:** Mobilní web, často venku; potřebuje rychle navigovat, volat, vidět poznámky a uzavřít zakázku.

**Cíl:** Provést návštěvy, minimalizovat zmatky, mít všechny informace dostupné, rychle zaznamenat výsledek.

**Klíčové potřeby:**
- Dnešní plán: pořadí, okna, čas dojezdu, navigace
- Jedno kliknutí: Navigovat, Volat, Na místě, Hotovo
- Poznámky typu "parkování / klíče / přístup" zvýrazněné

---

### 2. Názvosloví (sjednocení)

| UI termín | Popis | Mapování na DB |
|-----------|-------|----------------|
| **Zákazník** | Osoba nebo firma | `Customer` |
| **Zařízení** | Kotel, komín, plynový spotřebič | `Device` |
| **Zakázka** | Co se má udělat (revize/servis/čištění) | `Revision` |
| **Návštěva** | Domluvené datum + časové okno + délka + posádka | `Visit` |
| **Plán dne** | Konkrétní trasa pro den a posádku | `PlannedRoute` |
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
2. **Výjimky řešitelné přímo v místě** (nelze geokódovat → okamžitě "Opravit adresu")
3. **Desktop je hustý a rychlý; mobil je rovnocenný, jen jinak poskládaný**

#### 4.2 Explicitní "Route-aware" režim

Přepínač v Inboxu: `Optimalizovat podle trasy: [Zapnuto]`
Když **OFF**: sloty nemají Δkm/Δmin, jen "časový konflikt". InlineAlert: "Bez ověřené adresy nelze optimalizovat."

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
| Čas jízdy | Z Valhalla matrix |
| Servisní čas | Součet service duration všech zastávek |
| Vytížení dne (load %) | (jízda + servis + pauzy) / pracovní doba |
| Rezerva (slack) | Nejmenší časová rezerva mezi návštěvami |

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

**Scoring dropdown (Phase 4B — Pořadí):**

Toolbar contains a rule-set selector dropdown next to the filter tabs:
```
[Vše] [Akutní] [Do 7 dnů] ...    Pořadí: [Standardní ★ ▾]
                                            ├─ Standardní ★
                                            ├─ Agresivní priority
                                            └─ Pouze geocoding
```
- "★" marks the company default rule set
- Every company has a "Standardní" (Standard) default profile seeded at onboarding that reproduces the legacy lifecycle-rank → due-date → age ordering via factor weights
- The "Žádné" (None) option is removed — a scoring profile is always active
- Selection is persisted per dispatcher in `dispatcher_inbox_state` and restored on next inbox open

**UI stavy:**
1. `context=missing` - Vyžaduje výběr dne+posádky
2. `context=ready, route=loading` - Skeleton metrik a mapy
3. `route=ready, inbox=ready` - Kandidáti seřazení dle "nejlepší vložení"
4. `candidate=selected, suggestions=loading` - Dotekají sloty
5. `routeAware=forcedOff` - Chybí geo, banner s vysvětlením
6. `capacity=warn|danger` - Varování v headeru

**Fulltext search (implementováno):**

Inbox header obsahuje ikonku hledání (lucide `Search`). Po kliknutí se rozbalí
textové pole pro fulltextové hledání v seznamu kandidátů (jméno, město, PSČ).
Komponenta `SearchBox` je sdílená se stránkou Zákazníci.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Plánovací inbox  …  [🔍]                                           │
│  └─ (klik) → [🔍 Hledat kandidáty…_______________] [✕]            │
└─────────────────────────────────────────────────────────────────────┘
```

**Deep-link: „Zobrazit ve frontě" (implementováno):**

Ze stránky Zákazníci lze jedním kliknutím přejít do Inboxu s konkrétním
zákazníkem vybraným a připnutým na první pozici.

*Vstupní body:*
- `CustomerHeader` — CTA „Zobrazit ve frontě" (ikona Inbox), mezi „Do plánu"
  a „Upravit"
- `CustomerPreviewPanel` — stejné CTA ve spodní liště akcí, stejné pořadí

*Chování:*
1. Klik vygeneruje odkaz `/inbox?customerId=<uuid>`
2. `PlanningInbox` přečte query parametr, nastaví výběr kandidáta a uloží
   `focusCustomerId` do `sessionStorage` pro `InboxListPanel`
3. URL se okamžitě vyčistí (`replace: true`) — zpětné tlačítko vede na
   Zákazníky, ne na parametrizovaný inbox
4. `InboxListPanel` při prvním načtení pošle `focusCustomerId` do worker API
5. Worker (`apply_focus_pin`) připne zákazníka na index 0, i pokud je mimo
   stránkovaný top-N slice; vrátí `focusedCustomerIncluded` flag
6. Klient provede client-side re-pin pro případ, že lokální řazení/filtrování
   změní pořadí
7. Pokud zákazník není nalezen (neplatný, anonymizovaný, smazaný), zobrazí se
   varovný banner „Zákazník nebyl nalezen ve frontě." s možností zavření

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Zpět  Alena Hájek [OSOBA]  [📞] [🧭] [➕ Do plánu] [📥 Fronta] [✎]   │
│                                                          ↑                 │
│                                            "Zobrazit ve frontě"            │
└────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Plánovací inbox  …                                                      │
│ ⚠ Zákazník nebyl nalezen ve frontě.                           [✕]      │
│   (varovný banner — zobrazí se pouze pokud fokusovaný zákazník          │
│    není v datech; jinak zákazník je na pozici 0)                        │
├───────────────┬─────────────────────────────────────┬───────────────────┤
│ ★ Alena Hájek │                                     │ Detail:           │
│   (pinned)    │          MAPA                       │ Alena Hájek       │
│ Jana Novotná  │                                     │                   │
│ Michaela…     │                                     │                   │
└───────────────┴─────────────────────────────────────┴───────────────────┘
```

*Lokalizace:* `planner:focus_customer_not_found` (en/cs/sk),
`planner:focus_customer_dismiss`, `customers:action_show_in_inbox`.

---

#### 8.2 Přehled cest / Plan (`/plan`)

**Účel:** Přehled naplánovaných cest s filtrováním. Prohlížení tras s detailní časovou osou a vizualizací na mapě.

**Desktop layout (2 sloupce: sidebar + mapa):**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  LEVÝ SLOUPEC (sidebar)               │  PRAVÝ SLOUPEC (mapa)            │
│  FILTRY                                │  ┌──────────────────────────┐   │
│  [Datum ____] [Posádka: Vše ▾]        │  │      MAPA S TRASOU       │   │
│  [Depo: Vše ▾]                        │  │   ①──②──③──④──🏠         │   │
│                                        │  └──────────────────────────┘   │
│  NAPLÁNOVANÉ CESTY (N)  [↻]           │                                  │
│  ┌──────────────────────────────────┐  │                                  │
│  │ Po 2.2. • Posádka 1 • 3 zast.   │  │                                  │
│  │ 45 km • 2h30                     │  │                                  │
│  └──────────────────────────────────┘  │                                  │
│                                        │                                  │
│  DETAIL TRASY           45 km · 2h30   │                                  │
│  ┌──────────────────────────────────┐  │                                  │
│  │ 🏠 Depo Brno                     │  │                                  │
│  │ ─── 12 km · 18 min ──────────── │  │                                  │
│  │ ① Jan Novák    08:30–09:15      │  │                                  │
│  │ ─── 8 km · 12 min ──────────── │  │                                  │
│  │ ② Marie Svob.  09:45–10:15     │  │                                  │
│  │ ─── 15 km · 22 min ─────────── │  │                                  │
│  │ ③ Petr Černý   10:50–11:35     │  │                                  │
│  │ 🏠 Depo Brno                     │  │                                  │
│  └──────────────────────────────────┘  │                                  │
└────────────────────────────────────────┴──────────────────────────────────┘
```

**Filtry:** Den (single/range), Posádka, Depo. User preferences jako výchozí hodnoty.

**Interakce:** Klik trasa → detail v sidebar. Klik zastávka → highlight na mapě. Klik segment → info o úseku.

**Sdílené komponenty (Inbox + Plan):**
- `RouteDetailTimeline` — vertikální timeline: depo → segment → zastávka → ... → depo
- `RouteMapPanel` — MapLibre GL (piny, segmenty, polyline, highlight, insertion preview)
- Bidirectional highlight: klik v timeline ↔ zvýraznění na mapě

**Nastavení uživatele:** Default posádka/depo v DB (`users.default_crew_id`, `users.default_depot_id`).

---

#### 8.3 Seznam zákazníků

**Desktop (tabulka):**

```
┌───────────────────────────────────────────────────────────────┐
│ Zákazníci  [🔎 hledat…____________________] [Saved ▾] [Filtry] │
│ [Řadit ▾] [Tabulka|Karty]                               [+Nový]│
├───────────────────────────────────────────────────────────────┤
│ ZÁKAZNÍK             | MĚSTO | ZAŘ. | NEJBL. ZAK. | ADRESA | ⋯ │
│ Alena Hájek          | Hodonín| 2    | 3.1.2027    | ✅     | ⋯ │
├───────────────────────────────┬───────────────────────────────┤
│ (klik řádku)                   │ Náhled zákazníka (panel)      │
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
└──────────────────────────────┘
```

#### 8.3a Rozšířená filtrace, řazení a konfigurovatelné sloupce (návrh)

**Kontext:**
- Současná stránka zákazníků je funkční pro základní práci, ale neumožňuje rychle filtrovat/řadit podle všech prakticky důležitých informací pro řemeslníka/dispečerku.
- Cíl: "tabulka jako spreadsheet" + "rychlé common filtry nahoře" + "pokročilé filtry v rozbalitelném panelu".

**Rozhodnutí — persistenční model (locked):**
- **Pouze UPP** pro stav filtrů, řazení a konfigurace sloupců na stránce Zákazníci. **Žádná synchronizace do URL** pro tento stav v této fázi.
- **Sdílení / deep link** není součástí návrhu; později explicitní akce „Sdílet pohled“ (nebo ekvivalent), která může vygenerovat odkaz nebo payload — až bude produktově definováno.
- **Uložené pohledy (saved views), týmové presety a telemetrie** z tohoto dokumentu **vylučujeme** — řeší se až v samostatné iteraci, pokud vůbec.

**Vztah k obecnému vzoru v §21.5 (URL > UPP > default):**  
U jiných stránek může zůstat řetězec precedence s URL. Pro **evoluci stránky Zákazníci** podle tohoto návrhu je **cílový stav výhradně UPP** pro filtry, řazení a mřížku — bez paralelního zápisu do query parametrů. Případný přechod ze stávajícího chování je implementační migrace, ne součást tohoto UX popisu.

**Bug-bash quick win (P0):**
- Typ filtru na stránce zákazníků zobrazuje i18n klíče (`filter_type_all`, `filter_type_company`, `filter_type_person`) místo přeložených labelů.
- Akceptace opravy:
  1. Select zobrazuje lokalizované texty ve všech podporovaných jazycích.
  2. Při přepnutí jazyka se labely okamžitě přepnou.
  3. Persistovaná hodnota filtru zůstává stejná (enum), mění se jen display label.

**UX principy pro Customers grid:**
1. Každá relevantní customer informace má být potenciálně použitelná pro filtraci i řazení (v rozsahu, který backend v dané verzi podporuje).
2. Nejčastější filtry/řazení mají být "1 click away" (toolbar + quick chips).
3. Méně časté kombinace patří do Advanced panelu (drawer/sheet), ne do hlavního toolbaru.
4. **Multisort (ano):** řazení spreadsheet-like — klik na hlavičku viditelného sloupce; **sekundární a další úrovně** přes `Shift+klik` na další viditelný sloupec. Pořadí priorit sortů musí být uživateli viditelné (např. čísla 1·2·3 u hlaviček nebo jeden řádek „Řazení: …“).
5. Viditelné sloupce jsou uživatelsky konfigurovatelné a **persistované výhradně přes UPP** (viz níže).
6. **Mobile (ano):** stejný mentální model — filtry a řazení v **bottom sheetu / full-screen sheetu** (ne přeplněný horní toolbar); karty zobrazují stejná kritéria v zhuštěné podobě; multisort v sheetu (primární + sekundární), případně zjednodušený výchozí preset + rozšíření v sheetu. Column picker na mobilu: omezený počet „prioritních“ polí na kartě + volitelně stejný picker ve sheetu.

**Návrh filtrovacích kritérií (common vs. advanced):**

_Common (vždy viditelné / rychlý přístup):_
- fulltext (`name`, `address`, `phone`, `city`, případně `customerCode`)
- due bucket (`Po termínu`, `Do 7 dní`, `Do 30 dní`, `Vše`)
- geocode kvalita (`OK`, `Pending`, `Failed`, `Missing address`)
- typ zákazníka (`Osoba`, `Firma`, `Vše`)
- oblast (`Město/region/depo`)

_Advanced (rozbalitelný panel):_
- kontaktovatelnost (`má telefon`, `má email`, `preferred contact channel`)
- lifecycle (`last service age`, `next revision window`, `never serviced`)
- operativa (`has open action`, `in planned route`, `needs reschedule`)
- business metadata (`service package`, `customer segment`, `priority`)
- datová kvalita (`missing house number`, `invalid geocode`, `incomplete profile`)

**Řazení (multisort):**
- Primární: klik na hlavičku sloupce (cyklus ASC / DESC / none podle konvence tabulky).
- Sekundární a další: `Shift+klik` na další **viditelný** sloupec; pořadí určuje prioritu.
- Stabilní tie-break: `name ASC` nebo `id ASC` (deterministický výstup při shodě).
- Rychlé presety (dropdown nebo chipy): např. `Nejbližší revize`, `Po termínu`, `Naposledy kontaktováno`, `Město A-Z` — stále persistované v UPP jako součást `sortModel`, ne v URL.
- **Reset řazení** jedním kliknutím (návrat na výchozí), aby uživatel po experimentu nezůstal „zaseknutý“.

**Konfigurovatelné sloupce (persistované v UPP):**
- Column picker (`Zobrazit sloupce`) s kategoriemi:
  - Identita: jméno, typ, segment
  - Kontakt: telefon, email, preferovaný kanál
  - Lokalita: město, adresa, geocode status
  - Revize: poslední, další, overdue days
  - Operativa: open action, in route, assigned crew
- Drag-and-drop reorder sloupců (desktop); na mobilu alternativa (seznam přetahovatelný nebo pořadí přes šipky).
- Volitelné: pin vlevo/vpravo, hustota řádků, šířky sloupců.
- Core sloupce (např. `name`) nelze úplně skrýt.
- **Max. počet současně viditelných sloupců** (doporučení produktu, např. 8–12) kvůli čitelnosti a výkonu — přesné číslo stanoví implementace.

**UPP — jediný zdroj pravdy pro grid (bez URL):**
- Rozdělení doporučeno kvůli kanálům a životnosti:
  - **Session:** pracovní kontext relace (filtry, aktivní vyhledávání) — stav, který je přirozené „začít čistý“ v novém tabu.
  - **Local:** dlouhodobá personalizace tabulky (viditelné sloupce, pořadí, šířky, pin, hustota, **řazení**) — stav, u kterého uživatel očekává, že přetrvá.

_Profil A (`customers.filters` nebo rozšíření existujícího): session_
- `search`, `geocodeFilter`, `revisionFilter`, `typeFilter`, případně `advancedFilterExpression`

_Profil B (`customers.grid`): local_
- `visibleColumns`, `columnOrder`, `columnWidths`, `pinnedColumns`, `density`
- **`sortModel`** (včetně multisort) — řazení patří do **local**, ne session. Uživatel, který si nastaví „město → nejbližší revize“, očekává totéž řazení i v novém tabu / po restartu prohlížeče. Řazení je personalizace tabulky, ne dočasný kontext relace.
- Formát: `[{ column: string, direction: 'asc' | 'desc' }]` — pole objektů, pořadí v poli = priorita multisort.
- **Bez** `activeViewId` a bez konceptu uložených pohledů v této fázi.

**Implementační poznámky (ne funkcionalita v tomto dokumentu):**
- Které filtry a řazení podporuje **API** v které verzi, je samostatný kontrakt (indexy, stránkování, debounce u fulltextu). Dokument UX předpokládá, že „vše relevantní“ je cíl; technicky může být uvedeno po částech.
- Při 0 výsledcích: jasná empty state + akce „Vymazat filtry“ / „Obnovit výchozí řazení“.
- Přístupnost: klávesová navigace v pickeru sloupců, `aria-sort` u hlaviček, sheet s focusem.

**Fáze (doporučené, bez saved views a bez telemetrie):**
1. **P0:** i18n oprava `filter_type_*`.
2. **Fáze 1:** Progressive disclosure (quick + advanced) + UPP pro filtry a sloupce + multisort + mobilní sheet.
3. **Fáze 2 (volitelná):** hlubší advanced filtry / složitější výrazy — **bez** full query builderu, dokud to nebude nutné; alternativa je rozšířit advanced panel o další předdefinované bloky.

---

#### 8.4 Detail zákazníka (workspace + edit drawer)

**Desktop (2 sloupce + taby):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Zpět  Alena Hájek [OSOBA]  [📞] [🧭] [➕ Do plánu] [📥 Fronta] [✎] │
├───────────────────────┬──────────────────────────────────────────────┤
│ Kontakt               │ [Zařízení] [Zakázky&Návštěvy] [Komunik.]     │
│ +420… (kopírovat)     │ ─ Zařízení (kompaktní řádky)                  │
│ email…                │ Kotel…  Interval 12  Další: …  [Domluvit]     │
│ Adresa ✅ Ověřeno      │ Komín…  Interval 24  Další: …  [Domluvit]     │
│ Mini mapa [Otevřít]   │                                                │
│ Poznámky…             │                                                │
└───────────────────────┴──────────────────────────────────────────────┘
```

**CTA „Zobrazit ve frontě" (📥 Fronta):** Naviguje do
`/inbox?customerId=<id>` — viz §8.1 deep-link. Dostupné v `CustomerHeader`
(detail page) i v `CustomerPreviewPanel` (inline panel na stránce Zákazníci).
Pořadí CTA: Do plánu → Fronta → Upravit.

**Mazání zákazníka:** Anonymizace PII (GDPR-style). Potvrzovací dialog. Historická data zachována v anonymizované podobě.

---

#### 8.5 Domluvit termín (vložit do trasy) - dialog/panel

**Desktop (inline panel):**

```
Domluvit termín
Doporučené: [Út 10–12 ✅ +6m/+3.2km] [St 8–10 ✅ +0m] [Čt 12–14 ❌]
Datum [..]  Okno [10:00]–[12:00]  Doba [30m]  (Posádka/Depo dle kontextu)
Stav: ✅ OK (rezerva 18 min)
[Zrušit]                         [Domluvit]
```

---

#### 8.6 Odložit akci - dialog

```
Odložit akci
Odložit do: [dd.mm.rrrr]  Rychle: [+7] [+14] [+30]
Důvod: [Nezvedá ▾]
Poznámka: [__________]
[Zrušit]            [Odložit]
```

**Důvody:** Nezvedá, Dovolená, Chce zavolat později, Jiný

---

#### 8.6a Nastavení pořadí (Settings → Pořadí) — Phase 4A, updated Phase 4B

**Účel:** Správa profilů hodnocení naléhavosti zákazníků pro řazení v inboxu.

**Umístění:** Nový tab "Pořadí" (`#scoring`) v Nastavení. Vyžaduje oprávnění `settings:scoring`.

**Desktop wireframe:**

```
┌──────────────────────────────────────────────────────────────────┐
│ Nastavení > Pořadí                                                │
│                                                                   │
│ Profily hodnocení určují pořadí zákazníků v Inboxu.               │
│ Každá firma má výchozí profil "Standardní", který lze upravit.    │
│                                                                   │
│ Aktivní profily                                    [+ Nový profil] │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │ ★ Standardní 🔒                   [Upravit] [Obnovit výchozí]│  │
│ │   Výchozí řazení: stav → termín → stáří zákazníka.          │  │
│ │                                                              │  │
│ │   ── Řazení (sorting) ──────────────────────────             │  │
│ │   Stav zákazníka:       [========●] 1000                     │  │
│ │   Dny do termínu:       [====●====] -5                       │  │
│ │   Stáří zákazníka:      [●========] 0.01                     │  │
│ │                                                              │  │
│ │   ── Urgence (urgency) ─────────────────────────             │  │
│ │   Dny po termínu:       [●========] 0                        │  │
│ │   Geocoding selhal:     [●========] 0                        │  │
│ │   Počet komunikací:     [●========] 0                        │  │
│ │   Dny od posl. kontaktu:[●========] 0                        │  │
│ │   Žádná otevřená akce:  [●========] 0                        │  │
│ ├──────────────────────────────────────────────────────────────┤  │
│ │   Agresivní priority                           [Upravit] [⋯]│  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ Archivované profily                                               │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │   Starý profil                    [Obnovit]                  │  │
│ └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Formulář (vytvořit / upravit profil):**

```
┌──────────────────────────────────────────────────┐
│ Upravit profil hodnocení                          │
│                                                   │
│ Název*:       [Standardní_______________]         │
│ Popis:        [_________________________]         │
│                                                   │
│ ── Řazení (sorting) ──────────────────────        │
│ Stav zákazníka:           [========●] 1000        │
│ Dny do termínu:           [====●====] -5          │
│ Stáří zákazníka:          [●========] 0.01        │
│                                                   │
│ ── Urgence (urgency) ─────────────────────        │
│ Dny po termínu:           [====●====] 5           │
│ Geocoding selhal:         [========●] 20          │
│ Počet komunikací:         [●========] -5          │
│ Dny od posledního kontaktu: [===●=====] 3         │
│ Žádná otevřená akce:     [=====●===] 10           │
│                                                   │
│ [Zrušit]                    [Uložit profil]       │
└──────────────────────────────────────────────────┘
```

**System profile (🔒) — actions:**
- [Upravit] — opens edit form (all 8 factor weights editable)
- [Obnovit výchozí] — confirmation dialog, resets to factory defaults
- [⋯] menu: Nastavit jako výchozí, Archivovat — but **no "Smazat"** option

**Chování:**
- Každá firma má automaticky vytvořený profil "Standardní" s `is_system = TRUE`
- Systémový profil je plně editovatelný, ale nelze ho smazat
- Faktory jsou vizuálně rozděleny do dvou skupin: "Řazení" (lifecycle_rank, days_until_due, customer_age_days) a "Urgence" (overdue_days, geocode_failed, total_communications, days_since_last_contact, no_open_action)
- Změna vah se projeví při dalším načtení inboxu (bez cache — okamžitě)

#### 8.6b Playbook přepínání profilů pořadí (dispatcher)

**Cíl:** Dát dispečerovi jednoduchý a opakovatelný postup, *kdy* přepnout profil řazení podle situace v inboxu.

**Předdefinované profily (lokalizované názvy):**

| System key | Čeština (cs) | Slovenčina (sk) | English (en) | Primární účel |
|---|---|---|---|---|
| `standard` | Standardní | Štandardný | Standard | Vyvážené denní řazení (výchozí) |
| `new_customers_first` | Noví zákazníci první | Noví zákazníci prví | New Customers First | Rychlé zpracování netknutých/nových zákazníků |
| `due_date_radar` | Radar termínů | Radar termínov | Due-Date Radar | Ochrana blížících se termínů + po termínu |
| `overdue_firefighter` | Krizový režim po termínu | Krízový režim po termíne | Overdue Firefighter | Agresivní snížení backlogu po termínu |
| `data_quality_first` | Kvalita dat a geokódingu | Kvalita dát a geokódovania | Data Quality First | Priorita oprav dat blokujících plánování |

**Doporučené váhy (preset baseline):**

| Profil | lifecycle_rank | days_until_due | customer_age_days | overdue_days | geocode_failed | total_communications | days_since_last_contact | no_open_action |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Standardní | +1000 | -5 | +0.01 | 0 | 0 | 0 | 0 | 0 |
| Noví zákazníci první | +1700 | -2 | +0.005 | 0 | 0 | 0 | 0 | +350 |
| Radar termínů | +700 | -12 | +0.005 | +3 | 0 | 0 | 0 | 0 |
| Krizový režim po termínu | +500 | -18 | 0 | +8 | 0 | 0 | 0 | +100 |
| Kvalita dat a geokódingu | +500 | -4 | 0 | 0 | +900 | 0 | 0 | +150 |

**Operativní pravidla přepnutí (kdy použít který profil):**

1. **Výchozí start dne:** začni vždy profilem **Standardní**.
2. **Přepni na "Noví zákazníci první", když:**
   - podíl netknutých zákazníků v inboxu > 30 %, nebo
   - backlog prvního kontaktu roste 3+ dny po sobě.
3. **Přepni na "Radar termínů", když:**
   - položky s termínem do 7 dnů > 25 % inboxu, nebo
   - opakovaně vznikají "last-minute" přeplánování.
4. **Přepni na "Krizový režim po termínu", když:**
   - po termínu je > 15 % inboxu, nebo
   - položek po termínu > 30 dnů je > 20.
5. **Přepni na "Kvalita dat a geokódingu", když:**
   - geocode_failed > 8 % aktivních položek, nebo
   - plánování je blokováno chybou adres/geokódu u 10+ zákazníků.

**Exit kritéria (kdy se vrátit na Standardní):**
- Noví zákazníci první: netknutí klesnou pod 20 %.
- Radar termínů: "do 7 dnů" klesne pod 15 %.
- Krizový režim po termínu: po termínu klesne pod 8 %.
- Kvalita dat: geocode_failed klesne pod 3 %.

**Guardrails (aby řazení nebylo chaotické):**
- Nepřepínat profil více než **2x za den** bez retrospektivy.
- Profil držet minimálně **půl dne** (nebo 1 plánovací blok), aby byl měřitelný efekt.
- Po každém přepnutí sledovat minimálně: počet po termínu, počet netknutých, počet geocode_failed.

---

#### 8.7 Detail zakázky (workflow hub)

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

**Ano:** Vložit do dne/domluvit, Odložit, Uložení poznámky.
**Ne:** Editace adresy + ověření, Reorder celé trasy (draft mód).

---

### 10. Empty states a edge cases

| Stav | Text |
|------|------|
| Inbox je prázdný | "Na tento den nejsou žádné položky k domluvení. [Zobrazit další období] [Přejít na Zákazníky]" |
| Nelze geokódovat | "⚠ Adresu se nepodařilo ověřit. [Opravit adresu]" |
| Chybí telefon | "⚠ Zákazník nemá telefon. [Doplnit telefon]" |
| Den je plný | "❌ Den je téměř plný (92%). Doporučeno přidat max. 1 krátkou návštěvu v okolí." |

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

> **Status:** ✅ Complete — All phases (A–E) done  
> **Version:** 1.9  
> **Date:** 2026-02-21

### 1. Goals

1. Multi-step wizard replacing the single-page Register form.
2. **Email verification** (confirmation link sent via Resend).
3. **Rate-limit** registration + verification endpoints; DDoS guardrails.
4. **Country availability** (CZ now, SK coming soon, waitlist for others).
5. **30-day free trial** — no credit card required.
6. **Device type selection** step for correct tenant configs from day one.
7. All user-facing text in **en**, **cs**, **sk**.
8. Wizard module **lazy-loaded** — zero extra JS until `/register`.
9. Full country list **lazy-loaded** — only fetched on demand.
10. **Progress indicator** visible at all times.

### 2. Current State (implemented)

| Area | Status |
|------|--------|
| Multi-step wizard | ✅ 5 steps with StepIndicator |
| Email verification | ✅ Token hashing (SHA-256), 24h expiry, resend with 60s cooldown |
| Rate limiting | ✅ MultiRateLimiter for register, verify, resend, login, geocode, waitlist |
| Email infrastructure | ✅ EmailSender trait: ResendEmailSender (prod), LogEmailSender (dev), FakeEmailSender (test) |
| Country support | ✅ CZ supported, SK coming soon (dynamic from DB) |
| Device type configs | ✅ 5 builtin types, localized labels, per-tenant seeding |
| Auth guard | ✅ email_verified + onboarding_completed_at checks |

### 3. Progress Indicator

```
──────────────────────────────────────────────────────────
  ①          ②          ③          ④          ⑤
Account   About you   Devices   Depot   All set!
  ●──────────●──────────○──────────○──────────○
             ↑ current
──────────────────────────────────────────────────────────
```

- Completed: filled circle + checkmark + clickable. Current: bold. Future: empty + not clickable.
- Mobile: labels hidden, only numbered circles.

### 4. Wizard Steps

```
┌─────────────────────────────────────────────────────────────┐
│  LANDING  (/register)  — no stepper bar                     │
│                                                             │
│  Ariadline logo                                             │
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
│  Already have an account? [Sign in]                         │
│  [🌐 EN] [🇨🇿 CS] [🇸🇰 SK]                                  │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1 / 5  —  Account                                    │
│  Email, Password (min 8, 1 upper + 1 lower + 1 digit),     │
│  Confirm pwd, Password strength, ToS checkbox               │
│  → Backend creates unverified user, sends verification email│
│  → "Check your inbox" interstitial with Resend button (60s) │
│  → Email link click → token verified → proceed to Step 2    │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2 / 5  —  About you                                  │
│  Name*, Company name (opt), Phone (opt), ICO (opt)          │
│  Language (pre-filled), Country (locked from landing)       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3 / 5  —  What do you service?                       │
│  Checkbox list of 5 builtin device types + custom.          │
│  Chimney first and pre-selected (target market).            │
│  Expandable to adjust duration + interval per type.         │
│  At least 1 type required.                                  │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4 / 5  —  Your depot (home base)                     │
│  Name*, Street*, City*, Postal code*                        │
│  [Verify address] → geocode via Nominatim                   │
│  On failure: interactive Leaflet map for manual pin.        │
│  Continue enabled only after verification.                  │
│  Rate limit: 5 geocode requests / 5 min.                   │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 5 / 5  —  You're all set!                            │
│  Summary: account, N device types, depot, crew.             │
│  "Your 30-day free trial starts today."                     │
│  [Go to Dashboard →]                                        │
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
  │                               │ validate, rate limit, hash   │
  │                               │ INSERT user (unverified)     │
  │                               │ generate token, hash, store  │
  │                               │ ─── email.send ────────────▶ │
  │◀──────────────────────────────│                              │
  │ {ok, message: "check inbox"}  │                              │
  │                               │                              │
  │ sazinka.auth.verify-email     │                              │
  │ {token}                       │                              │
  │──────────────────────────────▶│                              │
  │                               │ hash token, verify, activate │
  │                               │ CREATE tenant + user_tenants  │
  │                               │ generate JWT                 │
  │◀──────────────────────────────│                              │
  │ {token, user}                 │                              │
  │                               │                              │
  │ sazinka.onboarding.profile    │                              │
  │ {name, businessName, ...}     │                              │
  │──────────────────────────────▶│ UPDATE user profile          │
  │                               │                              │
  │ sazinka.onboarding.devices    │                              │
  │ {selectedTypes, customTypes}  │                              │
  │──────────────────────────────▶│ deactivate/update/create     │
  │                               │                              │
  │ sazinka.onboarding.complete   │                              │
  │ {depot: {name, street, ...}}  │                              │
  │──────────────────────────────▶│ INSERT depot + crew          │
  │                               │ set defaults, complete       │
  │◀──────────────────────────────│                              │
  │ {settings}                    │                              │
```

### 6. Country Availability & Waitlist

| Country | UI | Action |
|---------|-----|--------|
| CZ (`is_supported`) | "Available now" + "Start free trial" | Proceeds to Step 1 |
| `coming_soon` countries | Flag + "Coming soon" badge (dynamic from DB) | "Notify me" → email input |
| Others | "Different country?" link | Mini-form: email + country picker (lazy) → `INSERT INTO country_waitlist` |

Country picker lazy-loaded only on "Different country?" click.
DB table: `country_waitlist(id, email, country, locale, created_at)` with `UNIQUE(email, country)`.
Column: `countries.coming_soon BOOLEAN DEFAULT false`.

### 7. Email Verification

- **Token:** 32-byte random, hex-encoded. Store **hash** in DB, not plaintext.
- **Expiry:** 24 hours.
- **Resend:** Reuse existing valid token (don't overwrite). 60-second cooldown.
- **Anti-enumeration:** `register.start` and `resend-verification` return generic success regardless of email existence. If email exists and verified, send "Already Registered" email with login link.
- **Link format:** `{APP_BASE_URL}/verify-email?token=<hex_token>` (configurable base URL).
- **Email templates:** Locale-aware (en/cs/sk) for verification and already-registered emails.

### 8. Device Type Selection (Step 3)

| # | Key | EN label | Duration | Interval | Default |
|---|-----|----------|----------|----------|---------|
| 1 | `chimney` | Chimney | 30 min | 12 months | **checked** |
| 2 | `gas_boiler` | Gas boiler | 60 min | 12 months | unchecked |
| 3 | `gas_water_heater` | Gas water heater | 45 min | 12 months | unchecked |
| 4 | `fireplace` | Fireplace / insert | 30 min | 12 months | unchecked |
| 5 | `gas_stove` | Gas stove | 20 min | 36 months | unchecked |

All labels localized via i18n keys. Unselected builtins deactivated (`is_active = false`), not deleted.

### 9. Rate Limiting & DDoS Protection

| Endpoint | Limit | Key | Window |
|----------|-------|-----|--------|
| `sazinka.auth.register.start` | 3/email, 10/IP | email + IP | 15 min |
| `sazinka.auth.verify-email` | 5/token | token prefix | 15 min |
| `sazinka.auth.resend-verification` | 2/email | email | 5 min |
| `sazinka.auth.login` | 5/email | email | 5 min |
| `sazinka.onboarding.geocode.depot` | 5/user | user_id | 5 min |
| `sazinka.waitlist.join` | 3/email | email | 1 hour |

Infrastructure: Cloudflare proxy (L3/L4/L7 DDoS mitigation), NATS internal only, WebSocket via Cloudflare.

### 10. Free Trial Messaging

| Key | EN | CS | SK |
|-----|-----|-----|-----|
| `trial_badge` | "30 days free" | "30 dní zdarma" | "30 dní zadarmo" |
| `trial_no_card` | "No credit card required" | "Bez platební karty" | "Bez platobnej karty" |

### 11. Lazy Loading Strategy

```
/login           ← eagerly loaded
/register        ← lazy-loaded (entire wizard module)
  ├── Landing    ← rendered immediately
  ├── WaitlistForm + CountrySelect ← lazy on "Different country?"
  ├── Steps 1-5  ← plain components within wizard chunk
  └── LeafletMap ← lazy on geocode failure (fallback only)
/verify-email    ← lazy-loaded (thin wrapper)
```

### 12. Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Auto-delete unverified users? | Yes. Background job purges after 7 days. |
| Q2 | Allow email change before verification? | No. Start new registration. |
| Q3 | Verification link target? | Open app at `/verify-email?token=...`, frontend verifies, stores JWT, continues wizard. |
| Q4 | Password strength? | Min 8 chars + 1 upper + 1 lower + 1 digit. Both frontend and backend. |
| Q5 | Depot geocoding mandatory? | Yes. Fallback: interactive Leaflet map for manual pin. |
| Q6 | "Crew 1" name editable? | No. Auto-created with i18n key. Editable later in Settings. |
| Q7 | Slovakia? | Blocked. "Coming soon" dynamic list from DB. |
| Q8 | Device labels? | Everything localized. No Czech hardcoding. |
| Q9 | Can user skip Devices step? | No. At least 1 type required. |
| Q10 | Wizard resumable? | Yes. JWT after verification. `onboarding_step` drives resume point. |

### 13. onboarding_step transitions

| Handler | Sets `onboarding_step` to |
|---------|---------------------------|
| `verify-email` | 2 (About you) |
| `onboarding.profile` | GREATEST(current, 3) |
| `onboarding.devices` | GREATEST(current, 4) |
| `onboarding.complete` | 6 (completed) |

---

## 17. Hlášení při krátkém výpadku backendu (worker restart)

Při nasazení nové verze workeru přes `docker compose up -d worker` dochází
k ~2-vteřinnému výpadku spojení.

### 17.1 Kanonický text toastu

| Jazyk | Text |
|-------|------|
| CS | „Propojení se serverem bylo přerušeno. Probíhá obnovení…" |
| EN | "Connection to server lost. Reconnecting…" |
| SK | „Spojenie so serverom bolo prerušené. Obnovujem…" |

### 17.2 Implementační poznámky

- Globální NATS timeout listener v `useNats` hooku nebo Zustand middleware.
- Timeout threshold: 3 s. Toast varianta: `info` (ne `error`).
- Po reconnect: toast automaticky zmizí.

---

## 18. Responsive Mobile Layout

> **Status:** ✅ All phases (0–13) complete  
> **Goal:** Make the entire app usable on phones (≤ 639px) and tablets (640–1023px) while keeping desktop (≥ 1024px) **completely unchanged**.  
> **Constraint:** Maximize shared components, hooks, and CSS. No code duplication.

### 18.0 Locked Decisions

1. **No desktop regression:** desktop viewport behavior must remain unchanged.
2. **Phone breakpoint:** `max-width: 639px`.
3. **Tablet behavior:** `640–1023px` uses the same UX model as phone (mobile UX).
4. **Routing policy:** no external backwards compatibility for `/planner` is required.
5. **Internal path consistency:** all user-facing internal routes must use `/plan`.
6. **Panel navigation:** mobile/tablet panel state must be URL-backed for back-button consistency.
7. **Touch targets:** 44px minimum for primary interactive controls only.
8. **Phase 13:** remains a hardening milestone (breakpoint consolidation).
9. **Release blockers:** Layout, PlanningInbox, Plan, Calendar, Customers, WorkLog.

### 18.1 Current State Audit

**Existing partial responsive:** viewport meta, hamburger on mobile, various ad-hoc breakpoints (600px, 768px, 900px).

**Critical issues (all resolved):**

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | SplitView stacking breaks multi-panel pages | Tab-switched single panel on mobile |
| 2 | No touch-friendly target sizes | 44px minimum via utility classes |
| 3 | Inconsistent breakpoints (5 values) | Consolidated to 639px / 1023px in Phase 13 |
| 4 | No body scroll lock for drawer | `useBodyScrollLock` hook (iOS-safe) |
| 5 | Tables overflow on narrow screens | Card layout on mobile, horizontal scroll |
| 6 | Fixed pixel widths | Percentage/100% widths on mobile |
| 7 | No shared responsive hook | `useBreakpoint` hook |

### 18.2 Design Decisions

**Breakpoint system (3 tiers):**

```
Phone:   0 – 639px      → mobile UX
Tablet:  640px – 1023px → mobile UX (same model as phone)
Desktop: ≥ 1024px       → UNCHANGED (current layout)
```

**Strategy:** Progressive enhancement from desktop down. All changes are additive `@media (max-width)` rules. No existing desktop rule modified or removed.

**Shared infrastructure:**

| File | Purpose |
|------|---------|
| `hooks/useBreakpoint.ts` | Returns `'phone' | 'tablet' | 'desktop'`, `isPhone`, `isMobileUi`, `isTouch` |
| `hooks/useBodyScrollLock.ts` | Lock/unlock body scroll with iOS-safe scroll-position restore |
| `index.css` additions | Breakpoint comment, touch-target utilities, safe-area insets |
| `components/common/MobileTabBar.tsx` | Shared tab bar for mobile panel switching |
| `test/utils/responsive.tsx` | Viewport + matchMedia + router-aware render helpers |

### 18.3 Implementation Phases — Completion Summary

All phases follow TDD (RED → GREEN → REFACTOR) and are complete:

| Phase | Scope | Key Changes |
|-------|-------|-------------|
| 0 | Baseline + route guard | Desktop/phone/tablet DOM snapshots, `/plan` path consistency |
| 1 | Foundation | `useBreakpoint`, `useBodyScrollLock`, global CSS (safe-area, touch targets, font floor) |
| 2 | MobileTabBar | Shared tab component for panel switching on mobile |
| 3 | Layout header polish | Header compacting, status/jobs text hidden on mobile, CSS 1023px/1024px |
| 4 | PlanningInbox mobile | Tab-switched panels (List/Map/Detail), URL-backed state, auto-switch to detail |
| 5 | Plan mobile | Map on top, sidebar below, resizers hidden at ≤1023px |
| 6 | Calendar mobile | Day view default, horizontal scroll week grid, bottom sheet detail |
| 7 | Customers mobile | Full-width cards, stacked toolbar, touch targets |
| 8 | WorkLog mobile | Card layout on mobile, table on desktop |
| 9 | Dialogs/Drawers mobile | Full-screen slide-up sheets on phone (Schedule, Edit, QuickVisit, etc.) |
| 10 | Detail pages mobile | Single-column stacking at 1023px (Customer, Revision, Visit, WorkItem) |
| 11 | Settings/Admin mobile | Tab horizontal scroll, form fields full width |
| 12 | SplitView touch resize | Touch event handlers for convertible/Surface devices (≥1024px only) |
| 13 | Breakpoint consolidation | 25 CSS files: 600px→639px, 768px→1023px, 900px→1023px |

### 18.4 Open Questions (Resolved)

1. **Offline support (Service Worker)** — deferred.
2. **Pull-to-refresh** — deferred.
3. **Landscape phone** — no special handling; tablet breakpoint covers it.

---

## 19. Inbox Panel Architecture — Multi-Window Flexible Layout

> **Status:** Design phase  
> **Datum:** 2026-03-10

### 19.1 Motivation

Plánovací inbox je nejdůležitější a nejkomplexnější stránka. Obsahuje 5 hlavních oblastí:

1. **Seznam kandidátů (List)** — filtrovatelná fronta *(Inbox only)*
2. **Detail zákazníka (Detail)** — kontakt, termín, akce, timeline *(Inbox: otevřený při výběru; Plan: zavřený, otevře se klikem)*
3. **Mapa trasy (Map)** — zastávky, geometrie, depot, insertion preview *(Inbox + Plan)*
4. **Timeline trasy (Route)** — zastávky s drag-reorder, pauzy, metriky *(Inbox + Plan)*
5. **Seznam tras (RouteList)** — filtr den/posádka, přehled tras *(Plan only)*

> Map, Route a Detail jsou **jedna implementace** sdílená oběma stránkami.

Typické workflow kombinace:

| Workflow | Oblasti |
|----------|---------|
| Obvolávání | List + Detail |
| Prostorové plánování | List + Map |
| Optimalizace trasy | Detail + Map + Route |
| Kompletní přehled | List + Detail + Map + Route |
| Prohlížení tras (Plan) | RouteList + Map + Route |

**Problém:** Na telefonu 1 oblast, tabletu 2, desktopu 3. Dispečer s více monitory chce vše viditelné.

### 19.2 Koncept: Detachable Panels

Každý panel lze zobrazit jako:
- **Telefon:** full-screen s bottom sheet / horizontální pruhy
- **Tablet:** 2×2 dlaždice / 2 panely vedle sebe
- **Desktop:** klasický 3-panel layout / detachovat do samostatných oken
- **Multi-monitor:** každý panel v samostatném okně prohlížeče

### 19.3 Technické řešení: BroadcastChannel

```
┌─────────────────────────────────────────────────────┐
│              BroadcastChannel("sazinka-panels")      │
│  ┌──────────┐ ┌──────────┐ ┌──────┐ ┌───────────┐  │
│  │  List     │ │  Detail  │ │ Map  │ │  Route    │  │
│  │  window   │ │  window  │ │window│ │  window   │  │
│  └──────────┘ └──────────┘ └──────┘ └───────────┘  │
│       └─────────────┴───────────┴──────────┘         │
│                  sdílený stav                         │
└─────────────────────────────────────────────────────┘
```

**Sdílený stav (přes BroadcastChannel):**

| Klíč | Popis | Producent |
|------|-------|-----------|
| `selectedCustomerId` | Vybraný zákazník | List, Map, Route |
| `selectedRouteId` | Vybraná trasa | RouteList, Map |
| `routeContext` | Den, posádka, depo | List/RouteList header |
| `routeStops` | Zastávky trasy | Route, List |
| `highlightedSegment` | Zvýrazněný segment | Route, Map |
| `insertionPreview` | Náhled vložení | List (hover) |
| `activePageContext` | `"inbox"` nebo `"plan"` | Hlavní okno |

**Lokální stav (zůstává v okně):** Scroll pozice, UI toggles, MapLibre instance, Virtuoso instance.

### 19.4 Architektura

```
PanelStateProvider (React context)
├── usePanelSignals()           — BroadcastChannel hook (signal-only)
│   ├── sendSignal(signal)      — odeslat do ostatních oken
│   └── onSignal(handler)       — přijmout z jiného okna
├── usePanelState()             — sdílený stav
└── panely:
    ├── InboxListPanel          — Inbox only
    ├── CustomerDetailPanel     — sdílená Inbox + Plan
    ├── RouteMapPanel           — sdílená Inbox + Plan
    ├── RouteTimelinePanel      — sdílená Inbox + Plan
    └── RouteListPanel          — Plan only
```

Každý panel může běžet embedded (child) nebo detached (`window.open()`).

### 19.5 Layout Manager

```
┌──────────────────────────────────────────────────────────────┐
│ Plánovací inbox   [Den ▾] [Posádka ▾]   Layout: [≡] [⊞] [↗]│
└──────────────────────────────────────────────────────────────┘
```

| Režim | Ikona | Popis | Viewport |
|-------|-------|-------|----------|
| Stack | ≡ | Panely pod sebou, bottom sheet | Phone |
| Split | ⊟ | 2 panely vedle sebe | Tablet |
| Tiles | ⊞ | 2×2 dlaždice | Desktop |
| Classic | ◫ | Současný 3-panel layout | Desktop |
| Detach | ↗ | Panel v novém okně | Multi-monitor |

### 19.6 Detach Flow (multi-window)

1. Klik na ↗ u panelu → `window.open('/panel/map', ...)`
2. Nové okno renderuje panel uvnitř `PanelStateProvider`
3. Oba okna na stejném `BroadcastChannel`
4. Výběr kandidáta v List → Detail i Map reagují okamžitě
5. Zavření detached okna → hlavní okno se vrátí k embedded režimu

**Omezení:** `window.open()` může být blokován pop-up blockerem. Každé okno má vlastní NATS připojení.

### 19.7 Fáze implementace — přehled

> Všechny fáze sledují TDD (RED → GREEN → REFACTOR) s paralelizací kde možné.

```
A.0 ─── Define shared types/interfaces/context
│
├─▶ WAVE 1 (parallel): A.1 Map, A.2 Route, A.3 Detail, A.4 List, A.5 RouteList
│
├─▶ WAVE 2 (parallel): A.6 Wire PlanningInbox, A.7 Wire Plan.tsx
│
├─▶ A.8 Cross-page integration tests
│
├─▶ WAVE 3 (parallel): E BroadcastChannel sync, C Tablet layout
│
├─▶ D Layout Manager UI
│
└─▶ F Detach panel to separate window
```

### 19.8 Otevřené otázky (resolved)

1. **Persistence layoutu** — Hybrid: localStorage pro okamžitou odezvu, debounce-sync do DB (5s). Při načtení: fetch z DB, merge s localStorage (DB wins pokud novější).
2. **NATS reconnect v detached oknech** — Nezávislé spojení. Každé okno má vlastní NATS connection.
3. **Drag-and-drop across windows** — Tlačítko "Přidat do trasy" + klávesová zkratka (Ctrl+Enter) přes BroadcastChannel. Nativní DnD pouze v rámci jednoho okna.
4. **Phone bottom sheet vs. horizontal dual** — Stack (bottom sheet) jako výchozí a jediný režim na telefonu.

---

## 20. Detachable Panels — Map & List (Revised Implementation Plan)

> **Status:** ✅ All phases (G.1–G.6) done  
> **Datum:** 2026-03-10  
> **Prerequisite:** Section 19 infrastructure

### 20.1 Scope & Constraints

**Detachable per page:**
- **Inbox:** Map, List (Queue)
- **Plan:** Map

**NOT detachable:** Detail + Timeline stay together on the main page. RouteList (Plan-only) is not detachable.

**Rules:**
1. **Single instance** — each panel exists exactly once. When detached, it disappears from the main page.
2. **Independent data** — each panel connects to NATS independently and fetches its own data. No bulk data sync over BroadcastChannel.
3. **Coordination signals only** — BroadcastChannel carries lightweight IDs/indices only.
4. **Main page = menu host** — original page keeps the navigation bar.
5. **Last panel can't detach** — when only one panel group remains, detach button hidden.
6. **Detach in all views** — available from `stack`, `dual`, `grid`, `wide` layouts.

### 20.2 Architecture Overview

```
Main window (app.ariadline.com/inbox)
├── Navigation menu (always present)
├── LayoutManager toolbar
└── Embedded panels:
    ├── [List]          — detachable ↗
    ├── [Detail+Timeline] — always here, not detachable
    └── [Map]           — detachable ↗

BroadcastChannel("sazinka-panels")
├── { type: "SELECT_CUSTOMER", customerId }
├── { type: "SELECT_ROUTE", routeId }
├── { type: "HIGHLIGHT_SEGMENT", segmentIndex }
├── { type: "ROUTE_CONTEXT", date, crewId, depotId }
├── { type: "REQUEST_CONTEXT_SNAPSHOT" }
├── { type: "CONTEXT_SNAPSHOT", routeContext, selected* }
├── { type: "PANEL_DETACHED", panel, page }
└── { type: "PANEL_REATTACHED", panel, page }
    (sender filtering via senderId — ignore own messages)

Detached window (app.ariadline.com/panel/map?page=inbox&date=...&crewId=...&depotId=...)
├── Own NATS connection
├── Own PanelStateProvider (enableChannel=true)
├── Panel component (fetches data independently)
└── No navigation menu, no Layout wrapper
```

### 20.3 Key Data Each Panel Needs Independently

**Map panel (detached):**
- Bootstrap: URL seed (`date`, `crewId`, `depotId`) → `CONTEXT_SNAPSHOT` handshake
- Route stops via `routeService.loadRouteStops(routeId)`
- Route geometry via `geometryService.submitGeometryJob()`
- Selected customer / highlighted segment from BroadcastChannel

**List panel (detached):**
- Inbox candidates via `getInbox()` (NATS)
- Scoring rule sets, inbox state (NATS)
- Route context: URL seed + optional snapshot override
- In-route customer IDs: fetch route stops locally, derive `Set<string>`

### 20.4 BroadcastChannel Message Contract (v2 — signals only)

```typescript
type PanelSignal =
  | { type: 'SELECT_CUSTOMER'; customerId: string | null }
  | { type: 'HIGHLIGHT_SEGMENT'; segmentIndex: number | null }
  | { type: 'ROUTE_CONTEXT'; date: string; crewId: string; depotId: string }
  | { type: 'SELECT_ROUTE'; routeId: string | null }
  | { type: 'REQUEST_CONTEXT_SNAPSHOT' }
  | {
      type: 'CONTEXT_SNAPSHOT';
      routeContext: { date: string; crewId: string; depotId: string } | null;
      selectedCustomerId: string | null;
      selectedRouteId: string | null;
      highlightedSegment: number | null;
    }
  | { type: 'PANEL_DETACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' }
  | { type: 'PANEL_REATTACHED'; panel: 'map' | 'list'; page: 'inbox' | 'plan' }
```

Each message includes `senderId` (random UUID per window) for echo filtering.
`PANEL_DETACHED`/`PANEL_REATTACHED` include `page` so Inbox and Plan don't interfere.

**Hybrid bootstrap precedence:**
1. Parse URL seed context immediately and start loading
2. Request `CONTEXT_SNAPSHOT` from main window
3. If snapshot arrives and differs → snapshot overrides
4. If no snapshot (timeout) → keep URL-seeded context

### 20.5 DetachState Hook

```typescript
interface DetachState {
  detachedPanels: Set<'map' | 'list'>;
  detach(panel: 'map' | 'list'): void;
  reattach(panel: 'map' | 'list'): void;
  isDetached(panel: 'map' | 'list'): boolean;
  canDetach: boolean;
}
```

- Reads `activePageContext` from `usePanelState()`
- Builds URL with context seed on detach
- Polls `window.closed` for auto-reattach
- Filters incoming signals by page
- Closes all detached windows on unmount

### 20.6 Implementation Phases — Completion Summary

| Phase | Goal | Status |
|-------|------|--------|
| G.1 | Signal-only BroadcastChannel (`usePanelSignals`) — replace full-state `usePanelChannel` | ✅ DONE |
| G.2 | DetachState hook (`useDetachState`) — track detached panels, open/close windows | ✅ DONE |
| G.3 | InboxListPanel self-sufficient (own NATS data fetching) | ✅ DONE |
| G.4 | RouteMapPanel self-sufficient (own NATS data fetching) | ✅ DONE |
| G.5 | Wire detach into PlanningInbox — `useDetachState`, conditional rendering | ✅ DONE |
| G.5b | Wire detach into Plan — Map only | ✅ DONE |
| G.6 | DetachedPanelPage — `/panel/:panelId` route, NATS bootstrap, hybrid context | ✅ DONE |

### 20.7 Dependency Diagram

```
G.1 (Signal-only BroadcastChannel)
 │
 ├──→ G.2 (DetachState hook)
 │      ├──→ G.5  (Wire into PlanningInbox)
 │      │      └──→ G.6 (DetachedPanelPage bootstrap)
 │      └──→ G.5b (Wire into Plan — Map only)
 │             └──→ G.6
 │
 ├──→ G.3 (InboxListPanel self-sufficient)
 │      └──→ G.5
 │
 └──→ G.4 (RouteMapPanel self-sufficient)
        ├──→ G.5
        └──→ G.5b
```

**Parallel:** G.2, G.3, G.4 after G.1. G.5 + G.5b in parallel. G.6 last.

### 20.8 What Changes vs. Section 19

| Aspect | Section 19 (original) | Section 20 (revised) |
|--------|----------------------|---------------------|
| Detachable panels | All 5 | Inbox: Map + List; Plan: Map |
| Data sync | Full PanelState diffs | Hybrid bootstrap + signal-only runtime |
| Panel data loading | From PanelStateContext | Each panel fetches independently via NATS |
| Panel instances | Could coexist | Single instance — detach removes from main |
| Detail+Timeline | Independent panels | Stay together, always on main page |
| Last panel rule | Not defined | Last panel can't be detached |

### 20.9 Resolved Questions

1. **Route context ownership** — Main page (Detail+Timeline) keeps context selectors. Changes broadcast as `ROUTE_CONTEXT`.
2. **Detached panel title bar** — Small bar with panel name + "Back to main" link.

### 20.10 Decision — Detach in All Views

Keep detach available in all layout modes (`stack`, `dual`, `grid`, `wide`).
**Pros:** Consistent experience, faster workflows, fewer support questions, better multi-monitor fit.
**Cons:** More UI states to test, more header placement work on phone, slightly higher regression risk.

### 20.11 Decision — Hybrid Detached Bootstrap

URL-seeded route context for immediate startup + `CONTEXT_SNAPSHOT` handshake for live alignment.
Runtime rule: URL seed is initial; snapshot overrides when received. Timeout → keep seeded context.

---

## 21. Unified Persistence Platform (UPP)

> **Status:** ✅ Complete — Core framework + page wiring (P0–P6) done  
> **Location:** `apps/web/src/persistence/`  
> **Date:** 2026-03-24

### 21.1 Purpose

UPP is a framework for persisting and restoring UI filter/control state across page navigations, tab sessions, and browser restarts. Before UPP, each page managed its own `sessionStorage` / `localStorage` access with ad-hoc key naming, inconsistent serialization, and no structured precedence between URL parameters, stored values, and defaults.

UPP solves:

| Problem | UPP Solution |
|---------|-------------|
| Scattered `storage.getItem` / `setItem` calls | Centralized `PersistenceOrchestrator` facade |
| No namespace isolation between users/pages | Structured key: `sazinka:persist:v1:user:{userId}:profile:{profileId}:control:{controlId}` |
| Lossy falsy handling (`false`, `0`, `''` treated as missing) | Nullish-safe `resolveValue` utility (`??` over `||`) |
| No precedence between URL, storage, defaults | Configurable `readPriority` per profile (`url > session > local > server`) |
| Silent data corruption | Versioned envelope format with validation |
| Code duplication across pages | Declarative profiles + reusable React hooks |

### 21.2 Architecture

```
Page Component
  │
  └── PersistenceProvider (React Context)
        │  userId, profiles[], adapters{}
        │
        ├── PersistenceOrchestrator (core engine)
        │     ├── hydrateProfile()   — read from adapters, resolve precedence
        │     ├── commit()           — write to all writeTargets
        │     ├── clear()            — remove single control
        │     └── resetProfile()     — remove all controls in a profile
        │
        ├── Adapters (read/write to storage backends)
        │     ├── SessionStorageAdapter  (channelId: 'session')
        │     ├── LocalStorageAdapter    (channelId: 'local')
        │     ├── UrlAdapter             (channelId: 'url')
        │     ├── ServerPreferencesAdapter (channelId: 'server')
        │     └── MemoryAdapter          (channelId: 'session', for tests)
        │
        ├── Plugins (encode/decode/normalize per data type)
        │     ├── TextSearchPlugin   (pluginId: 'text')
        │     ├── EnumPlugin         (pluginId: 'enum')
        │     ├── BooleanPlugin      (pluginId: 'boolean')
        │     ├── DatePlugin         (pluginId: 'date')
        │     ├── DateRangePlugin    (pluginId: 'dateRange')
        │     └── JsonPlugin         (pluginId: 'json')
        │
        └── React Hooks (consumer API)
              ├── usePersistentControl<T>(profileId, controlId, debounceMs?)
              │     → { value: T, setValue: (v: T) => void }
              ├── usePersistentProfile(profileId)
              │     → { state, commit, reset }
              └── usePersistence()
                    → { orchestrator, profiles, userId, getState, commit, reset }
```

### 21.3 Core Concepts

#### Envelope

Every persisted value is wrapped in a versioned envelope for validation and precedence resolution:

```typescript
interface PersistenceEnvelope<T> {
  v: 1;              // Schema version
  ts: number;        // Timestamp (Date.now())
  value: T;          // The actual persisted value
  source: ChannelId; // Which adapter wrote it ('url' | 'session' | 'local' | 'server')
}
```

The `isValidEnvelope()` function guards against corrupt or outdated data in storage.

#### Adapter

A `PersistenceAdapter` is a strategy for reading/writing envelopes to a specific storage backend:

```typescript
interface PersistenceAdapter {
  readonly channelId: ChannelId;
  read(key: string, ctx: HydrationContext): PersistenceEnvelope<unknown> | null;
  write(key: string, envelope: PersistenceEnvelope<unknown>, ctx: HydrationContext): void;
  remove(key: string, ctx: HydrationContext): void;
  subscribe?(key: string, listener: (env | null) => void): () => void;
}
```

Adapters are shared as module-level singletons (`sessionAdapter`, `localAdapter`) to avoid duplicate instances.

#### Profile

A `PersistenceProfile` declares which controls a page persists, where to read from, and where to write:

```typescript
interface PersistenceProfile {
  profileId: string;              // e.g. 'customers.filters'
  controls: ControlSpec[];        // List of controls to persist
  readPriority: ChannelId[];      // Ordered list: first match wins (e.g. ['url', 'session', 'local'])
  writeTargets: ChannelId[];      // Where to persist on commit (e.g. ['session'])
}
```

#### Control

Each control in a profile is a `ControlSpec`:

```typescript
interface ControlSpec<T = unknown> {
  controlId: string;       // e.g. 'search', 'dateFrom', 'crew'
  pluginId: string;        // e.g. 'text', 'enum', 'boolean', 'date', 'json'
  defaultValue: T;         // Fallback when no stored value exists
  writeMode: WriteMode;    // 'immediate' | 'debounced' | 'onBlur'
  debounceMs?: number;     // Only for 'debounced' writeMode
  validators: Array<(value: T) => boolean>;
  sanitize?: (value: T) => T;
  legacyKeys?: string[];   // Old key names for migration
}
```

#### Precedence

On hydration, the orchestrator reads each control from every adapter in `readPriority` order, then selects the highest-priority envelope. Within the same priority, the newest timestamp wins:

```
Channel priority (highest to lowest): url > session > local > server
Same channel: newest ts wins
```

This is implemented in `resolvePrecedence()`.

#### Storage Key Format

All UPP keys follow a namespaced pattern to prevent collisions:

```
sazinka:persist:v1:user:{userId}:profile:{profileId}:control:{controlId}
```

Example: `sazinka:persist:v1:user:abc-123:profile:customers.filters:control:search`

### 21.4 React Integration

#### PersistenceProvider

Each page wraps its inner component tree in a `PersistenceProvider`:

```tsx
<PersistenceProvider
  userId={userId}
  profiles={[customersProfile]}
  adapters={{ session: sessionAdapter }}
>
  <CustomersInner />
</PersistenceProvider>
```

The provider creates a `PersistenceOrchestrator`, hydrates state on mount, re-hydrates when `userId` changes, and exposes `getState` / `commit` / `reset` through React context.

#### usePersistentControl

The primary hook for individual controls. Returns the current value and a stable `setValue` callback. Supports optional debounce for text inputs:

```tsx
const { value: search, setValue: setSearch } = usePersistentControl<string>(
  CUSTOMERS_PROFILE_ID, 'search', 300  // 300ms debounce
);
```

On unmount, any pending debounced write is flushed to ensure no data loss.

#### usePersistentProfile

For bulk access to all controls in a profile at once. Provides a `commit(controlId, value)` and `reset()`:

```tsx
const { state, commit, reset } = usePersistentProfile('customers.filters');
```

### 21.5 Wiring Patterns

#### Value Precedence Chain

Pages resolve the effective value of each control using a `URL > UPP > Default` chain with `resolveValue`:

```typescript
const viewMode = resolveValue<'table' | 'cards'>(
  searchParams?.view,   // URL parameter (highest priority)
  uppViewMode,          // UPP-persisted value
  'table'               // Static default (lowest priority)
) ?? 'table';
```

`resolveValue` returns the first non-null, non-undefined candidate — preserving valid falsy values like `false`, `0`, and `''`.

#### URL-to-UPP Sync on Mount

To ensure URL parameters survive navigation (user lands with `?crew=abc`, navigates away, comes back without URL param), pages sync initial URL params to UPP on first mount:

```typescript
const didSyncRef = useRef(false);
useEffect(() => {
  if (didSyncRef.current) return;
  didSyncRef.current = true;
  if (searchParams?.crew) setUppCrew(searchParams.crew);
  if (searchParams?.depot) setUppDepot(searchParams.depot);
}, []);
```

#### Legacy Migration (One-Time Seeding)

For pages migrating from direct storage to UPP, `readLegacyKey` reads old un-namespaced keys and seeds them into UPP on first mount:

```typescript
const didSeedRef = useRef(false);
useEffect(() => {
  if (didSeedRef.current) return;
  didSeedRef.current = true;
  if (uppValue === null || uppValue === undefined) {
    const legacy = readLegacyKey('session', 'planningInbox.filters');
    if (legacy != null) setUppValue(legacy);
  }
}, []);
```

`readLegacyKey` handles JSON objects, boolean strings (`"true"` / `"false"`), plain strings, and corrupt JSON gracefully.

#### Debounced Text Inputs

For search inputs, `usePersistentControl` accepts a `debounceMs` parameter. The component maintains a local `useState` for immediate UI responsiveness while UPP commits are debounced:

```typescript
const { value: uppSearch, setValue: setUppSearch } = usePersistentControl<string>(
  PROFILE_ID, 'search', 300,
);
const [localSearch, setLocalSearch] = useState(uppSearch ?? '');
const setSearch = useCallback((v: string) => {
  setLocalSearch(v);   // Immediate UI update
  setUppSearch(v);     // Debounced persistence
}, [setUppSearch]);
```

#### Channel Isolation

When a page needs controls in different storage backends (e.g., filters in `sessionStorage`, preferences in `localStorage`), it uses separate profiles:

```tsx
<PersistenceProvider
  userId={userId}
  profiles={[inboxFiltersProfile, inboxBreakRuleProfile]}
  adapters={{ session: sessionAdapter, local: localAdapter }}
>
```

The `inboxFiltersProfile` writes to `session`, `inboxBreakRuleProfile` writes to `local` — enforced by their `writeTargets`.

### 21.6 Active Profiles

| Profile ID | Page | Controls | Storage |
|-----------|------|----------|---------|
| `customers.filters` | Customers | search, viewMode, geocodeFilter, revisionFilter, typeFilter, sortBy, sortOrder (7) | session |
| `routes.filters` | Routes | dateFrom, dateTo, isDateRange, crew, depot (5) | session |
| `plan.filters` | Plan | dateFrom, dateTo, isDateRange, crew, depot (5) | session |
| `inbox.filters` | PlanningInbox | filters (1 JSON object) | session |
| `inbox.breakRule` | PlanningInbox | enforceDrivingBreakRule (1 boolean) | local |

### 21.7 What UPP Does NOT Manage

These keys remain as direct `sessionStorage` / `localStorage` access — see `STORAGE_ALLOWLIST.md` for the full list:

| Key | Storage | Reason |
|-----|---------|--------|
| `sazinka.auth.*` | local | Security-sensitive auth tokens |
| `sazinka.errorLog` | local | Must survive UPP failures |
| `planningInbox.context` | session | Route timeline critical — kept direct for safety |
| `planningInbox.selectedId` | session | Route timeline critical — kept direct for safety |
| `planner.sidebarWidth`, `planner.routeListHeight` | local | Layout preferences, deferred |
| `sazinka.snooze.defaultDays` | local | Rarely changes, deferred |
| `sazinka.layoutPreference` | local | Managed by `useLayoutMode` hook |

### 21.8 File Structure

```
apps/web/src/persistence/
├── core/
│   ├── types.ts                    — PersistenceEnvelope, PersistenceAdapter, PersistenceProfile, etc.
│   ├── PersistenceOrchestrator.ts  — Central engine: hydrate, commit, clear, reset
│   └── precedence.ts               — Channel priority + timestamp resolution
├── adapters/
│   ├── SessionStorageAdapter.ts    — sessionStorage read/write/subscribe
│   ├── LocalStorageAdapter.ts      — localStorage read/write/subscribe
│   ├── UrlAdapter.ts               — URL search params (read-only in practice)
│   ├── ServerPreferencesAdapter.ts — Server-side user preferences
│   ├── MemoryAdapter.ts            — In-memory adapter for tests
│   └── singletons.ts               — Module-level sessionAdapter + localAdapter instances
├── plugins/
│   ├── types.ts                    — ControlPlugin<T> interface
│   ├── registry.ts                 — PluginRegistry (register/get/has)
│   ├── TextSearchPlugin.ts         — Plain string encode/decode
│   ├── EnumPlugin.ts               — Enumerated string values
│   ├── BooleanPlugin.ts            — Boolean encode/decode
│   ├── DatePlugin.ts               — ISO date string
│   ├── DateRangePlugin.ts          — { from, to } date pair
│   └── JsonPlugin.ts               — Arbitrary JSON objects
├── react/
│   ├── PersistenceProvider.tsx      — React context: orchestrator + state management
│   ├── usePersistentControl.ts     — Hook for single control (with debounce)
│   ├── usePersistentProfile.ts     — Hook for full profile access
│   └── resolveValue.ts             — Nullish-safe multi-candidate precedence
├── profiles/
│   ├── customersProfile.ts         — Customers page (7 controls, session)
│   ├── routesProfile.ts            — Routes page (5 controls, session)
│   ├── planProfile.ts              — Plan page (5 controls, session)
│   ├── inboxProfile.ts             — Inbox combined (legacy, unused in wiring)
│   ├── inboxFiltersProfile.ts      — Inbox filters (1 JSON control, session)
│   └── inboxBreakRuleProfile.ts    — Inbox break rule (1 boolean, local)
├── migration/
│   └── legacySeed.ts               — One-time reader for old un-namespaced storage keys
├── __tests__/                      — 24 test files, 239 tests
│   ├── PersistenceOrchestrator.test.ts
│   ├── PersistenceProvider.test.tsx
│   ├── usePersistentControl.test.tsx
│   ├── usePersistentProfile.test.tsx
│   ├── resolveValue.test.ts
│   ├── singletons.test.ts
│   ├── legacySeed.test.ts
│   ├── precedence.test.ts
│   ├── types.contract.test.ts
│   ├── adapterContract.test.ts
│   ├── SessionStorageAdapter.test.ts
│   ├── LocalStorageAdapter.test.ts
│   ├── UrlAdapter.test.ts
│   ├── ServerPreferencesAdapter.test.ts
│   ├── crossTab.storage.test.ts
│   ├── BooleanPlugin.test.ts
│   ├── DatePlugin.test.ts
│   ├── DateRangePlugin.test.ts
│   ├── EnumPlugin.test.ts
│   ├── JsonPlugin.test.ts
│   ├── TextSearchPlugin.test.ts
│   ├── jsonPlugin.fuzz.test.ts
│   ├── urlCodec.property.test.ts
│   └── registry.test.ts
├── STORAGE_ALLOWLIST.md            — Keys exempt from UPP (auth, errors, route timeline)
└── index.ts                        — Public API barrel
```

### 21.9 Test Coverage

| Suite | Tests | Scope |
|-------|-------|-------|
| Core (orchestrator, precedence, types) | 45 | Hydration, commit, clear, reset, envelope validation |
| Adapters (session, local, url, server, memory, contract) | 42 | Read/write/remove, cross-tab, quota overflow |
| Plugins (6 types + registry + fuzz) | 52 | Encode/decode/normalize/isEmpty/equals per plugin |
| React (Provider, hooks, resolveValue, singletons) | 100 | Context wiring, debounce, unmount flush, falsy preservation |
| Page wiring guards (Customers, Routes, Plan, Inbox) | 98 | Unmount/remount survival, URL precedence, channel isolation, legacy seeding, route timeline safety |
| **Total** | **337** | |

---

*Dokument vytvořen: 2026-01-31*  
*Poslední aktualizace: 2026-03-24 (added Section 21: Unified Persistence Platform)*
