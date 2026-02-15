# PRJ_JOBS — Zastavování běžících úloh

## Stav: NÁVRH

Tento dokument popisuje návrh univerzálního mechanismu pro zastavování (cancellation) běžících úloh na pozadí. Řeší bezpečnost (multi-tenant izolaci), škálovatelnost a pokrývá všechny typy procesorů v systému.

---

## 1. Motivace

Uživatel aktuálně nemůže zastavit běžící úlohu. UI sice obsahuje tlačítko ×, ale backend (`handle_job_cancel` v `worker/src/handlers/jobs.rs`) pouze publikuje falešný "failed" status — samotný processing pokračuje dál. Komentář v kódu to přiznává:

```
// For now, we publish a "cancelled" status to notify subscribers
// In a full implementation, we would remove the job from JetStream queue
```

### Bezpečnostní problémy současného stavu

1. **Cancel bez ověření vlastníka** — `handle_job_cancel` extrahuje `_user_id` z JWT, ale nikdy ho nepoužije. Uživatel A může zrušit úlohu uživatele B.
2. **Historie úloh bez izolace** — `JobHistoryService` nemá `user_id` v `JobHistoryEntry`. Endpoint `get_recent()` vrací úlohy všech uživatelů.
3. **NATS status subscriptions** — frontend se přihlašuje na wildcard `sazinka.job.*.status.*`, takže teoreticky přijímá statusy cizích úloh (v praxi je ignoruje, protože `activeJobsStore` reaguje jen na známé `jobId`).

---

## 2. Inventář procesorů

| Procesor | Soubor | Smyčka | Cancellation bod | Priorita |
|---|---|---|---|---|
| CustomerImportProcessor | `handlers/import.rs` | `for (idx, row) in rows.iter()` | Mezi řádky (každých 50) | Vysoká |
| DeviceImportProcessor | `handlers/import_processors.rs:329` | `for (idx, row) in rows.iter()` | Mezi řádky (každých 50) | Vysoká |
| RevisionImportProcessor | `handlers/import_processors.rs:627` | `for (idx, row) in rows.iter()` | Mezi řádky (každých 50) | Vysoká |
| CommunicationImportProcessor | `handlers/import_processors.rs:969` | `for (idx, row) in rows.iter()` | Mezi řádky (každých 50) | Vysoká |
| VisitImportProcessor | `handlers/import_processors.rs:1260` | `for (idx, row) in rows.iter()` | Mezi řádky (každých 50) | Vysoká |
| ZipImportProcessor | `handlers/import_processors.rs:1609` | `for file_info in &job.files` | Mezi soubory + vnitřní smyčky | Vysoká |
| GeocodeProcessor (batch) | `handlers/geocode.rs:235` | `for (i, customer_id) in ids.iter()` | Mezi zákazníky (každých 10) | Vysoká |
| ExportProcessor | `services/export_processor.rs:247` | `build_export_zip` → fáze | Mezi fázemi (load→format→zip) | Střední |
| RouteJobProcessor | `handlers/jobs.rs:179` | `execute_route_plan` — jedno volání | Mezi fázemi v execute_route_plan | Nízká |
| GeocodeAddressProcessor | `handlers/geocode.rs:312` | Jednorázový (1 adresa) | Nelze — atomický | — |
| ReverseGeocodeProcessor | `handlers/geocode.rs:356` | Jednorázový (1 bod) | Nelze — atomický | — |
| ValhallaMatrix | `services/valhalla_processor.rs:159` | Jedno HTTP volání | Nelze — atomický | — |
| ValhallaGeometry | `services/valhalla_processor.rs:287` | Jedno HTTP volání | Nelze — atomický | — |
| EmailProcessor | `services/email_processor.rs:168` | Jednorázový (1 email) | Nelze — atomický | — |
| SmsProcessor | `services/sms_processor.rs:167` | Jednorázový (1 SMS) | Nelze — atomický | — |

### Tři kategorie

1. **Se smyčkou** — import CSV (5×), ZIP import, geocode batch, export, route. Jde zastavit mezi iteracemi.
2. **Atomické** — single geocode/reverse, email, SMS, Valhalla matrix/geometry. Trvají sekundy, nemá smysl zastavovat.
3. **Ve frontě** (queued, ještě nezačaly) — jde zrušit při vyzvednutí z fronty (lazy cancel).

---

## 3. Architektura

### 3.1 CancellationRegistry — globální singleton s RAII Guard

Nový soubor: `worker/src/services/cancellation.rs`

Použijeme RAII pattern (`JobGuard`), který zajistí automatické odstranění záznamu z registru při ukončení scope (ať už úspěšném, nebo při chybě/panice).

```rust
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use once_cell::sync::Lazy;

pub static CANCELLATION: Lazy<CancellationRegistry> = Lazy::new(CancellationRegistry::default);

struct JobEntry {
    token: CancellationToken,
    owner_id: Uuid,
}

/// RAII Guard that automatically removes the job from registry when dropped.
pub struct JobGuard {
    job_id: Uuid,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        CANCELLATION.remove(&self.job_id);
    }
}

#[derive(Clone, Default)]
pub struct CancellationRegistry {
    jobs: Arc<Mutex<HashMap<Uuid, JobEntry>>>,
}

#[derive(Debug)]
pub enum CancelError {
    /// Caller is not the owner of this job
    NotOwner,
}

impl CancellationRegistry {
    /// Register a job with its owner. Called at the start of process_job.
    /// Returns a JobGuard that must be kept in scope during processing.
    pub fn register(&self, job_id: Uuid, owner_id: Uuid) -> JobGuard {
        let token = CancellationToken::new();
        self.jobs.lock().insert(job_id, JobEntry {
            token: token.clone(),
            owner_id,
        });
        JobGuard { job_id }
    }

    /// Cancel a job — ONLY if the caller is the owner.
    /// Returns:
    ///   Ok(true)  — job found and cancelled
    ///   Ok(false) — job not found (already finished or not yet processing)
    ///   Err(NotOwner) — job exists but belongs to a different user
    pub fn cancel(&self, job_id: &Uuid, caller_id: Uuid) -> Result<bool, CancelError> {
        let jobs = self.jobs.lock();
        match jobs.get(job_id) {
            Some(entry) => {
                if entry.owner_id != caller_id {
                    return Err(CancelError::NotOwner);
                }
                entry.token.cancel();
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Pre-register a cancelled token (for queue cancellation).
    /// When the processor picks up the job and calls is_cancelled(), it will
    /// see that the token is already cancelled and skip processing.
    pub fn pre_cancel(&self, job_id: Uuid, caller_id: Uuid) {
        let token = CancellationToken::new();
        token.cancel();
        self.jobs.lock().insert(job_id, JobEntry {
            token,
            owner_id: caller_id,
        });
    }

    /// Check if job is cancelled. Called inside processing loops.
    /// This is the hot path — must be fast (single HashMap lookup under Mutex).
    pub fn is_cancelled(&self, job_id: &Uuid) -> bool {
        self.jobs.lock()
            .get(job_id)
            .map_or(false, |e| e.token.is_cancelled())
    }

    /// Remove finished job. Called automatically by JobGuard::drop.
    pub fn remove(&self, job_id: &Uuid) {
        self.jobs.lock().remove(job_id);
    }
}
```

### 3.2 Závislost

`tokio-util` — pro `CancellationToken`. **Není přítomna** v `worker/Cargo.toml`, je nutné ji přidat.

```toml
tokio-util = "0.7"
```

### 3.3 Registrace modulu

V `worker/src/services/mod.rs` přidat:

```rust
pub mod cancellation;
```

---

## 4. Integrace do procesorů

### 4.1 Vzor pro procesory se smyčkou

Každý procesor potřebuje 2 změny: register (s guardem) a check. Remove se děje automaticky.

```rust
use crate::services::cancellation::CANCELLATION;

async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
    let job: QueuedCustomerImportJob = serde_json::from_slice(&msg.payload)?;
    let job_id = job.id;
    let user_id = job.user_id;

    // ─── 1. Register (RAII Guard) ───
    // Guard will automatically call CANCELLATION.remove(&job_id) when dropped
    let _guard = CANCELLATION.register(job_id, user_id);

    // ─── 2. Check pre-cancel (job was cancelled while in queue) ───
    if CANCELLATION.is_cancelled(&job_id) {
        msg.ack().await.ok();
        self.publish_status(job_id, Status::Cancelled { processed: 0, total: 0 }).await?;
        JOB_HISTORY.record_cancelled(job_id, "import.customer", user_id, started_at);
        // _guard dropped here -> remove() called
        return Ok(());
    }

    // ACK immediately (existing pattern)
    msg.ack().await.ok();

    // ... parse CSV ...

    for (idx, row) in rows.iter().enumerate() {
        // ─── 3. Check every 50 rows ───
        if idx % 50 == 0 && CANCELLATION.is_cancelled(&job_id) {
            self.publish_status(job_id, Status::Cancelled {
                processed: idx as u32,
                total,
            }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.customer", user_id, started_at);
            // _guard dropped here -> remove() called
            return Ok(());
        }

        // ... normal row processing ...
    }

    // ... publish Completed, record history ...
    // _guard dropped here -> remove() called
    Ok(())
}
```

### 4.2 Konkrétní soubory a místa

| Procesor | Soubor | Smyčka (řádek) | Check interval |
|---|---|---|---|
| CustomerImportProcessor | `handlers/import.rs:1148` | `for (idx, row) in rows.iter()` | Každých 50 řádků |
| DeviceImportProcessor | `handlers/import_processors.rs` | `for (idx, row) in rows.iter()` | Každých 50 řádků |
| RevisionImportProcessor | `handlers/import_processors.rs` | `for (idx, row) in rows.iter()` | Každých 50 řádků |
| CommunicationImportProcessor | `handlers/import_processors.rs` | `for (idx, row) in rows.iter()` | Každých 50 řádků |
| VisitImportProcessor | `handlers/import_processors.rs` | `for (idx, row) in rows.iter()` | Každých 50 řádků |
| ZipImportProcessor | `handlers/import_processors.rs:1660` | `for file_info in &job.files` | Před každým souborem |
| GeocodeProcessor | `handlers/geocode.rs:250` | `for (i, id) in ids.iter()` | Každých 10 zákazníků |

### 4.3 ExportProcessor — mezi fázemi s typovou chybou

Pro robustnější error handling definujeme `ExportError`.

```rust
#[derive(thiserror::Error, Debug)]
pub enum ExportError {
    #[error("Job cancelled")]
    Cancelled,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

async fn build_export_zip(&self, user_id: Uuid, request: &ExportPlusRequest, job_id: Uuid) -> Result<(u32, u64, String), ExportError> {
    // Phase 1: Load data from DB
    let dataset = self.load_dataset(user_id, request).await?;

    if CANCELLATION.is_cancelled(&job_id) {
        return Err(ExportError::Cancelled);
    }

    self.publish_status(job_id, json!({ "type": "processing", "progress": 50, "message": "jobs:formatting" })).await?;

    // Phase 2: Format CSV files
    let files = self.collect_files(...);

    if CANCELLATION.is_cancelled(&job_id) {
        return Err(ExportError::Cancelled);
    }

    self.publish_status(job_id, json!({ "type": "processing", "progress": 80, "message": "jobs:packing_zip" })).await?;

    // Phase 3: Write ZIP
    // ...
    Ok(...)
}
```

V `process_job` rozlišit cancelled vs skutečnou chybu:

```rust
match outcome {
    Ok((row_count, file_size, file_name)) => { /* publish Completed */ }
    Err(ExportError::Cancelled) => {
        self.publish_status(job_id, json!({ "type": "cancelled" })).await?;
        JOB_HISTORY.record_cancelled(job_id, "export", user_id, started_wall);
    }
    Err(ExportError::Other(e)) => { /* publish Failed */ }
}
// _guard dropped -> remove() called
```

### 4.4 Atomické procesory — lazy check only

Procesory bez smyčky (email, SMS, single geocode, Valhalla) dostanou pouze pre-cancel check na začátku `process_job`. Zde `JobGuard` není nutný, protože `remove` voláme explicitně (nebo necháme token expirovat, pokud bychom měli TTL, ale explicitní remove je čistší).

```rust
async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
    let job = parse_job(&msg)?;

    // If pre-cancelled while in queue, skip
    if CANCELLATION.is_cancelled(&job.id) {
        msg.ack().await.ok();
        // Publish cancelled status
        CANCELLATION.remove(&job.id);
        return Ok(());
    }

    // ... normal processing (no loop, no further checks) ...
    Ok(())
}
```

---

## 5. Opravený `handle_job_cancel`

Soubor: `worker/src/handlers/jobs.rs`, funkce `handle_job_cancel` (řádek 933)

### Současný stav (ŠPATNĚ)

```rust
let _user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
    Ok(info) => info.data_user_id(),
    Err(_) => { /* UNAUTHORIZED */ continue; }
};
// _user_id se nikdy nepoužije → žádná kontrola vlastníka
```

### Nový stav

```rust
use crate::services::cancellation::{CANCELLATION, CancelError};

let caller_id = match crate::auth::extract_auth(&request, &jwt_secret) {
    Ok(info) => info.data_user_id(),
    Err(_) => { /* UNAUTHORIZED */ continue; }
};

let job_id = request.payload.job_id;

match CANCELLATION.cancel(&job_id, caller_id) {
    Ok(true) => {
        // Job was running and is now cancelled.
        // Processor will detect is_cancelled() in next loop iteration
        // and publish Cancelled status itself.
        let response = JobActionResponse {
            success: true,
            message: "jobs:cancel_requested".to_string(),
            job_id,
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    Ok(false) => {
        // Job not yet processing — pre-cancel so processor skips it
        CANCELLATION.pre_cancel(job_id, caller_id);
        let response = JobActionResponse {
            success: true,
            message: "jobs:cancel_requested".to_string(),
            job_id,
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    Err(CancelError::NotOwner) => {
        warn!("User {} attempted to cancel job {} owned by another user", caller_id, job_id);
        let error = ErrorResponse::new(request.id, "FORBIDDEN", "You can only cancel your own jobs");
        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
    }
}
```

---

## 6. Nový status: `Cancelled`

### 6.1 Rust typy

Přidat variantu `Cancelled` do všech status enumů:

**`types/import.rs` — CustomerImportJobStatus:**
```rust
#[serde(rename_all = "camelCase")]
Cancelled { processed: u32, total: u32 },
```

**`types/import.rs` — DeviceImportJobStatus, RevisionImportJobStatus, CommunicationImportJobStatus, WorkLogImportJobStatus:**
Stejná varianta.

**`types/import.rs` — ZipImportJobStatus:**
```rust
#[serde(rename_all = "camelCase")]
Cancelled { completed_files: u32, total_files: u32 },
```

**`types/job.rs` — JobStatus (route):**
```rust
#[serde(rename_all = "camelCase")]
Cancelled { message: String },
```

**`types/job.rs` — GeocodeJobStatus:**
```rust
#[serde(rename_all = "camelCase")]
Cancelled { processed: u32, total: u32 },
```

**`types/import_export_job.rs` — ExportJobStatus:**
```rust
#[serde(rename_all = "camelCase")]
Cancelled { message: String },
```

### 6.2 TypeScript typy

V `packages/shared-types/src/import.ts` (a dalších souborech s TypeScript typy) přidat `cancelled` do unionů:

```typescript
| { type: 'cancelled'; processed: number; total: number }
```

### 6.3 Frontend ActiveJob status

V `apps/web/src/stores/activeJobsStore.ts`:

```typescript
export interface ActiveJob {
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  // ...
}
```

---

## 7. JobHistoryService — přidání user_id

### 7.1 Struktura

Soubor: `worker/src/services/job_history.rs`

```rust
pub struct JobHistoryEntry {
    pub id: Uuid,
    pub user_id: Uuid,        // NOVÉ — vlastník úlohy
    pub job_type: String,
    pub status: String,        // "completed" | "failed" | "cancelled"
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub details: Option<String>,
}
```

### 7.2 Nové metody

```rust
pub fn record_cancelled(
    &self,
    id: Uuid,
    job_type: &str,
    user_id: Uuid,
    started_at: DateTime<Utc>,
) {
    let entry = JobHistoryEntry {
        id,
        user_id,
        job_type: job_type.to_string(),
        status: "cancelled".to_string(),
        // ...
    };
    self.add_entry(entry);
}

pub fn get_recent_for_user(&self, user_id: Uuid, limit: usize) -> JobHistoryResponse {
    let history = self.history.read();
    let jobs: Vec<JobHistoryEntry> = history
        .iter()
        .filter(|j| j.user_id == user_id)
        .take(limit)
        .cloned()
        .collect();
    let total = jobs.len();
    JobHistoryResponse { jobs, total }
}
```

### 7.3 Aktualizace existujících volání

Všechna volání `record_completed` a `record_failed` musí přidat `user_id` parametr. To znamená úpravu všech procesorů, kde se tyto metody volají (Job history entry se tvoří na konci každého `process_job`).

### 7.4 Aktualizace handle_job_history

V `handlers/jobs.rs`, funkce `handle_job_history` — použít `get_recent_for_user(caller_id, limit)` místo `get_recent(limit)`.

---

## 8. Frontend

### 8.1 Nový status v activeJobsStore

V handler funkcích (`handleImportJobStatusUpdate`, `handleZipImportJobStatusUpdate`, `handleGeocodeJobStatusUpdate`, `handleExportJobStatusUpdate`) přidat větev:

```typescript
} else if (status.type === 'cancelled') {
  jobStatus = 'cancelled';
  progressText = i18n.t('jobs:cancelled_by_user');
  completedAt = new Date();
}
```

### 8.2 Vizuální odlišení v Jobs.tsx

Cancelled úlohy se odliší od failed:
- Barva: oranžová/žlutá (ne červená)
- Ikona: ⊘ nebo ■ (ne ×)
- Text: "Zrušeno uživatelem" / "Cancelled by user"

V CSS přidat nový styl `.statCancelled`:
```css
.statCancelled {
  background: #fef3c7;
  color: #92400e;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
```

### 8.3 Překlady

Soubory: `apps/web/public/locales/{cs,en,sk}/jobs.json`

```json
{
  "cancelled_by_user": "Zrušeno uživatelem",
  "cancel_confirm": "Opravdu chcete zrušit tuto úlohu?",
  "cancel_forbidden": "Nemáte oprávnění zrušit tuto úlohu"
}
```

### 8.4 Potvrzovací dialog (volitelné)

Před odesláním cancel requestu zobrazit confirm dialog: "Opravdu chcete zastavit tuto úlohu? Již zpracovaná data zůstanou v systému."

---

## 9. Škálovatelnost

### 9.1 Memory footprint

Každý záznam v `CancellationRegistry`: ~96 bytů (UUID + CancellationToken + owner UUID).

| Souběžné úlohy | Paměť |
|---|---|
| 100 | ~10 KB |
| 1 000 | ~96 KB |
| 10 000 | ~960 KB |

Zanedbatelné.

### 9.2 Lock contention

`is_cancelled()` volá `Mutex::lock()` + `HashMap::get()` — řádově nanosekundy. I při stovkách souběžných procesorů není bottleneck. Při extrémním load by šlo přejít na `dashmap::DashMap`, ale není to nutné.

### 9.3 Cleanup

`CANCELLATION.remove(&job_id)` se volá automaticky díky `JobGuard::drop`, takže registry neroste neomezeně ani při chybách/panicích. Pre-cancelled záznamy (kde úloha nikdy nezačne) se uklidí při prvním pokusu procesoru o vyzvednutí.

Potenciální edge case: pre-cancel pro úlohu, která se nikdy nezpracuje (např. prázdná fronta). Řešení: periodický cleanup starých záznamů (starších než 1 hodina). Implementace:

```rust
pub fn cleanup_stale(&self, max_age: std::time::Duration) {
    // Volat periodicky z background tasku, např. každých 5 minut
}
```

Toto ale vyžaduje přidat `created_at` do `JobEntry`. Není kritické pro MVP.

---

## 10. Bezpečnostní model

### 10.1 Autorizační pravidla

1. **Cancel**: Uživatel může zrušit pouze své vlastní úlohy. Ověřuje se přes `CancellationRegistry.cancel(job_id, caller_id)`.
2. **Historie**: Uživatel vidí pouze své vlastní úlohy. Ověřuje se přes `get_recent_for_user(caller_id, limit)`.
3. **Status updates**: Frontend přijímá NATS status updates na wildcard subjects, ale `activeJobsStore` je ignruje pokud `jobId` není v lokálním stavu (úloha nebyla odeslána z tohoto prohlížeče). Backend nepotřebuje změnu.

### 10.2 Ochrana proti IDOR (Insecure Direct Object Reference)

Job UUID jsou v4 (128-bit random) — nehádatelné. Přesto se **vždy** ověřuje `owner_id` při cancel operaci, takže i znalost UUID nestačí.

### 10.3 Role worker

Workers (`role: "worker"`) mají `owner_id` svého zaměstnavatele. `data_user_id()` vrací `owner_id`. Workeři tedy mohou zrušit úlohy svého zaměstnavatele — to je korektní chování (pracují se stejnými daty).

---

## 11. Plán implementace — TDD (test-driven)

Každý krok se řídí cyklem RED → GREEN → REFACTOR:
1. Napsat failing test (RED)
2. Napsat minimální implementaci, aby test prošel (GREEN)
3. Refaktorovat pokud potřeba (REFACTOR)
4. Odškrtnout krok v tomto souboru

Po dokončení každého kroku se aktualizuje checkbox v tomto dokumentu.

### Fáze 1: CancellationRegistry (TDD)

Scaffold: přidat `tokio-util` do `Cargo.toml`, vytvořit prázdný `cancellation.rs`, registrovat modul.

- [x] **1.1** TEST: `test_register_and_is_cancelled_false` — nově registrovaný job není cancelled ✅
  - GREEN: Implementovat `register()`, `is_cancelled()`, `JobGuard`, `JobEntry`
- [x] **1.2** TEST: `test_cancel_own_job` — vlastník může zrušit svůj job, `is_cancelled` vrací true ✅
  - GREEN: Implementovat `cancel()`
- [x] **1.3** TEST: `test_cancel_not_owner_rejected` — cizí uživatel dostane `Err(NotOwner)` ✅
  - GREEN: Implementovat owner check v `cancel()`
- [x] **1.4** TEST: `test_cancel_nonexistent_returns_false` — cancel neexistujícího jobu vrací `Ok(false)` ✅
  - GREEN: Handle `None` v `cancel()`
- [x] **1.5** TEST: `test_pre_cancel_is_immediately_cancelled` — `pre_cancel` vytvoří záznam, `is_cancelled` okamžitě true ✅
  - GREEN: Implementovat `pre_cancel()`
- [x] **1.6** TEST: `test_guard_drop_removes_from_registry` — po dropu `JobGuard` je job odstraněn z registry ✅
  - GREEN: Implementovat `Drop` pro `JobGuard`, `remove()`
- [x] **1.7** TEST: `test_register_returns_guard_not_token` — ověřit, že register vrací `JobGuard` ✅
  - GREEN: Refaktorovat návratový typ pokud potřeba

### Fáze 2: JobHistoryService rozšíření (TDD)

- [x] **2.1** TEST: `test_record_cancelled_appears_in_history` — po `record_cancelled` se záznam objeví s `status = "cancelled"` ✅
  - GREEN: Přidat `user_id` do `JobHistoryEntry`, implementovat `record_cancelled`
- [x] **2.2** TEST: `test_get_recent_for_user_isolates_users` — uživatel A nevidí úlohy uživatele B ✅
  - GREEN: Implementovat `get_recent_for_user`
- [x] **2.3** TEST: `test_record_completed_with_user_id` — ověřit že stávající `record_completed` správně ukládá `user_id` ✅
  - GREEN: Aktualizovat signatury `record_completed` a `record_failed`
- [x] **2.4** Aktualizovat **všechny existující volání** `record_completed` a `record_failed` ve všech procesorech, aby předávaly `user_id`. Ověřit `cargo check`. ✅

### Fáze 3: Rust status enumy

- [x] **3.1** Přidat variantu `Cancelled` do `CustomerImportJobStatus`, `DeviceImportJobStatus`, `RevisionImportJobStatus`, `CommunicationImportJobStatus`, `WorkLogImportJobStatus`, `ZipImportJobStatus` v `types/import.rs` ✅
- [x] **3.2** Přidat variantu `Cancelled` do `JobStatus`, `GeocodeJobStatus` v `types/job.rs` ✅
- [x] **3.3** Přidat variantu `Cancelled` do `ExportJobStatus` v `types/import_export_job.rs` ✅
- [x] **3.4** Definovat `ExportError` v `services/export_processor.rs` ✅
- [x] **3.5** `cargo check` — ověřit, že všechno kompiluje ✅

### Fáze 4: handle_job_cancel a handle_job_history (TDD)

- [x] **4.1** Přepsat `handle_job_cancel` — použít `CANCELLATION.cancel()` s ověřením vlastníka ✅
- [x] **4.2** Přepsat `handle_job_history` — použít `get_recent_for_user(caller_id, limit)` ✅
- [x] **4.3** `cargo check` ✅

### Fáze 5: Integrace do procesorů se smyčkou

Pro každý procesor: přidat `_guard = CANCELLATION.register(job_id, user_id)`, pre-cancel check, periodic `is_cancelled()` check ve smyčce.

- [x] **5.1** `CustomerImportProcessor` (`handlers/import.rs`) ✅
- [x] **5.2** `DeviceImportProcessor` (`handlers/import_processors.rs`) ✅
- [x] **5.3** `RevisionImportProcessor` (`handlers/import_processors.rs`) ✅
- [x] **5.4** `CommunicationImportProcessor` (`handlers/import_processors.rs`) ✅
- [x] **5.5** `VisitImportProcessor` (`handlers/import_processors.rs`) ✅
- [x] **5.6** `ZipImportProcessor` (`handlers/import_processors.rs`) — check před každým souborem ✅
- [x] **5.7** `GeocodeProcessor` (`handlers/geocode.rs`) — check každých 10 zákazníků ✅
- [x] **5.8** `ExportProcessor` (`services/export_processor.rs`) — check mezi fázemi, použít `ExportError` ✅
- [x] **5.9** `RouteJobProcessor` (`handlers/jobs.rs`) — pre-cancel check ✅
- [x] **5.10** Atomické procesory — lazy pre-cancel check (email, SMS, single geocode, reverse geocode, Valhalla matrix, Valhalla geometry) ✅
- [x] **5.11** `cargo check` — ověřit kompilaci ✅

### Fáze 6: TypeScript shared types

- [x] **6.1** Přidat `cancelled` status do všech unionů v `packages/shared-types/src/import.ts` ✅

### Fáze 7: Frontend

- [x] **7.1** `activeJobsStore.ts` — přidat `'cancelled'` do `ActiveJob.status`, handle ve všech handler funkcích ✅
- [x] **7.2** `Jobs.tsx` — vizuální odlišení (barva, ikona, text), filter tab, status badge ✅
- [x] **7.3** `Jobs.module.css` — nový styl `.statCancelled`, `.statusBadge.cancelled`, `.cancelledRow` ✅
- [x] **7.4** Překlady — `cs/jobs.json`, `en/jobs.json`, `sk/jobs.json` ✅
- [x] **7.5** `types/jobStatus.ts` — přidat `JobStatusCancelled`, `isCancelled()`, update `isTerminal()` ✅

### Fáze 8: Ověření

- [x] **8.1** `cargo check` — backend kompiluje bez chyb ✅ (188 warnings, 0 errors)
- [x] **8.2** `cargo test` — všechny testy prochází ✅ (282 passed, 0 failed, 6 ignored)
- [x] **8.3** Frontend build check (tsc / vite build) ✅ (0 errors in job-related files; fix: added `'cancelled'` to `JobHistoryEntry.status` in `jobService.ts`)

---

## 12. Soubory dotčené změnami

### Nové soubory
- `worker/src/services/cancellation.rs` (včetně `#[cfg(test)] mod tests` uvnitř souboru)

### Změněné soubory — backend
- `worker/Cargo.toml` — přidat `tokio-util`
- `worker/src/services/mod.rs` — registrace modulu
- `worker/src/services/job_history.rs` — user_id, record_cancelled, get_recent_for_user
- `worker/src/services/export_processor.rs` — cancellation check mezi fázemi, ExportError
- `worker/src/handlers/jobs.rs` — handle_job_cancel, handle_job_history
- `worker/src/handlers/import.rs` — CustomerImportProcessor
- `worker/src/handlers/import_processors.rs` — 5 importních procesorů + ZipImportProcessor
- `worker/src/handlers/geocode.rs` — GeocodeProcessor
- `worker/src/types/import.rs` — Cancelled varianta (6 enumů)
- `worker/src/types/job.rs` — Cancelled varianta (JobStatus, GeocodeJobStatus)
- `worker/src/types/import_export_job.rs` — Cancelled varianta (ExportJobStatus)

### Změněné soubory — shared types
- `packages/shared-types/src/import.ts` — cancelled status

### Změněné soubory — frontend
- `apps/web/src/services/jobService.ts` — cancelled status v JobHistoryEntry
- `apps/web/src/stores/activeJobsStore.ts` — cancelled handling
- `apps/web/src/pages/Jobs.tsx` — vizuální odlišení
- `apps/web/src/pages/Jobs.module.css` — .statCancelled styl
- `apps/web/public/locales/cs/jobs.json` — překlady
- `apps/web/public/locales/en/jobs.json` — překlady
- `apps/web/public/locales/sk/jobs.json` — překlady
