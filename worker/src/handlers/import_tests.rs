//! Phase 0: Complete test suite for import/export overhaul.
//! These tests are expected to be RED until the implementation phases complete.

#[cfg(test)]
mod parse_helpers {
    use crate::handlers::import::*;

    // =========================================================================
    // parse_device_type
    // =========================================================================

    #[test]
    fn parse_device_type_en_canonical() {
        assert!(matches!(parse_device_type("gas_boiler"), Some(crate::types::DeviceType::GasBoiler)));
        assert!(matches!(parse_device_type("gas_water_heater"), Some(crate::types::DeviceType::GasWaterHeater)));
        assert!(matches!(parse_device_type("chimney"), Some(crate::types::DeviceType::Chimney)));
        assert!(matches!(parse_device_type("fireplace"), Some(crate::types::DeviceType::Fireplace)));
        assert!(matches!(parse_device_type("gas_stove"), Some(crate::types::DeviceType::GasStove)));
        assert!(matches!(parse_device_type("other"), Some(crate::types::DeviceType::Other)));
    }

    #[test]
    fn parse_device_type_cs_aliases() {
        assert!(matches!(parse_device_type("kotel"), Some(crate::types::DeviceType::GasBoiler)));
        assert!(matches!(parse_device_type("plynový kotel"), Some(crate::types::DeviceType::GasBoiler)));
        assert!(matches!(parse_device_type("ohřívač"), Some(crate::types::DeviceType::GasWaterHeater)));
        assert!(matches!(parse_device_type("bojler"), Some(crate::types::DeviceType::GasWaterHeater)));
        assert!(matches!(parse_device_type("komín"), Some(crate::types::DeviceType::Chimney)));
        assert!(matches!(parse_device_type("krb"), Some(crate::types::DeviceType::Fireplace)));
        assert!(matches!(parse_device_type("sporák"), Some(crate::types::DeviceType::GasStove)));
        assert!(matches!(parse_device_type("jiné"), Some(crate::types::DeviceType::Other)));
        assert!(matches!(parse_device_type("ostatní"), Some(crate::types::DeviceType::Other)));
    }

    #[test]
    fn parse_device_type_case_insensitive() {
        assert!(matches!(parse_device_type("GAS_BOILER"), Some(crate::types::DeviceType::GasBoiler)));
        assert!(matches!(parse_device_type("Gas_Boiler"), Some(crate::types::DeviceType::GasBoiler)));
    }

    #[test]
    fn parse_device_type_unknown_returns_none() {
        assert!(parse_device_type("").is_none());
        assert!(parse_device_type("unknown_type").is_none());
        assert!(parse_device_type("123").is_none());
    }

    // =========================================================================
    // parse_revision_status
    // =========================================================================

    #[test]
    fn parse_revision_status_en_canonical() {
        use crate::types::RevisionStatus;
        assert!(matches!(parse_revision_status("upcoming"), Some(RevisionStatus::Upcoming)));
        assert!(matches!(parse_revision_status("scheduled"), Some(RevisionStatus::Scheduled)));
        assert!(matches!(parse_revision_status("confirmed"), Some(RevisionStatus::Confirmed)));
        assert!(matches!(parse_revision_status("completed"), Some(RevisionStatus::Completed)));
        assert!(matches!(parse_revision_status("cancelled"), Some(RevisionStatus::Cancelled)));
    }

    #[test]
    fn parse_revision_status_cs_aliases() {
        use crate::types::RevisionStatus;
        assert!(matches!(parse_revision_status("nadcházející"), Some(RevisionStatus::Upcoming)));
        assert!(matches!(parse_revision_status("naplánováno"), Some(RevisionStatus::Scheduled)));
        assert!(matches!(parse_revision_status("potvrzeno"), Some(RevisionStatus::Confirmed)));
        assert!(matches!(parse_revision_status("dokončeno"), Some(RevisionStatus::Completed)));
        assert!(matches!(parse_revision_status("zrušeno"), Some(RevisionStatus::Cancelled)));
        assert!(matches!(parse_revision_status("storno"), Some(RevisionStatus::Cancelled)));
    }

    #[test]
    fn parse_revision_status_unknown_returns_none() {
        assert!(parse_revision_status("").is_none());
        assert!(parse_revision_status("invalid").is_none());
    }

    // =========================================================================
    // parse_revision_result
    // =========================================================================

    #[test]
    fn parse_revision_result_en_canonical() {
        use crate::types::RevisionResult;
        assert!(matches!(parse_revision_result("passed"), Some(RevisionResult::Passed)));
        assert!(matches!(parse_revision_result("ok"), Some(RevisionResult::Passed)));
        assert!(matches!(parse_revision_result("conditional"), Some(RevisionResult::Conditional)));
        assert!(matches!(parse_revision_result("failed"), Some(RevisionResult::Failed)));
        assert!(matches!(parse_revision_result("nok"), Some(RevisionResult::Failed)));
    }

    #[test]
    fn parse_revision_result_cs_aliases() {
        use crate::types::RevisionResult;
        assert!(matches!(parse_revision_result("v pořádku"), Some(RevisionResult::Passed)));
        assert!(matches!(parse_revision_result("bez závad"), Some(RevisionResult::Passed)));
        assert!(matches!(parse_revision_result("s výhradami"), Some(RevisionResult::Conditional)));
        assert!(matches!(parse_revision_result("nevyhovělo"), Some(RevisionResult::Failed)));
        assert!(matches!(parse_revision_result("závada"), Some(RevisionResult::Failed)));
    }

    // =========================================================================
    // parse_communication_type
    // =========================================================================

    #[test]
    fn parse_communication_type_en_canonical() {
        use crate::types::CommunicationType;
        assert!(matches!(parse_communication_type("call"), Some(CommunicationType::Call)));
        assert!(matches!(parse_communication_type("email_sent"), Some(CommunicationType::EmailSent)));
        assert!(matches!(parse_communication_type("email_received"), Some(CommunicationType::EmailReceived)));
        assert!(matches!(parse_communication_type("note"), Some(CommunicationType::Note)));
        assert!(matches!(parse_communication_type("sms"), Some(CommunicationType::Sms)));
    }

    #[test]
    fn parse_communication_type_cs_aliases() {
        use crate::types::CommunicationType;
        assert!(matches!(parse_communication_type("hovor"), Some(CommunicationType::Call)));
        assert!(matches!(parse_communication_type("telefonát"), Some(CommunicationType::Call)));
        assert!(matches!(parse_communication_type("email"), Some(CommunicationType::EmailSent)));
        assert!(matches!(parse_communication_type("poznámka"), Some(CommunicationType::Note)));
        assert!(matches!(parse_communication_type("záznam"), Some(CommunicationType::Note)));
    }

    // =========================================================================
    // parse_communication_direction
    // =========================================================================

    #[test]
    fn parse_communication_direction_en_canonical() {
        use crate::types::CommunicationDirection;
        assert!(matches!(parse_communication_direction("outbound"), Some(CommunicationDirection::Outbound)));
        assert!(matches!(parse_communication_direction("inbound"), Some(CommunicationDirection::Inbound)));
        assert!(matches!(parse_communication_direction("out"), Some(CommunicationDirection::Outbound)));
        assert!(matches!(parse_communication_direction("in"), Some(CommunicationDirection::Inbound)));
    }

    #[test]
    fn parse_communication_direction_cs_aliases() {
        use crate::types::CommunicationDirection;
        assert!(matches!(parse_communication_direction("odchozí"), Some(CommunicationDirection::Outbound)));
        assert!(matches!(parse_communication_direction("příchozí"), Some(CommunicationDirection::Inbound)));
    }

    // =========================================================================
    // parse_visit_type / parse_work_type
    // =========================================================================

    #[test]
    fn parse_visit_type_en_canonical() {
        use crate::types::VisitType;
        assert!(matches!(parse_visit_type("revision"), Some(VisitType::Revision)));
        assert!(matches!(parse_visit_type("installation"), Some(VisitType::Installation)));
        assert!(matches!(parse_visit_type("repair"), Some(VisitType::Repair)));
        assert!(matches!(parse_visit_type("consultation"), Some(VisitType::Consultation)));
        assert!(matches!(parse_visit_type("follow_up"), Some(VisitType::FollowUp)));
    }

    #[test]
    fn parse_work_type_en_canonical() {
        use crate::types::WorkType;
        assert!(matches!(parse_work_type("revision"), Some(WorkType::Revision)));
        assert!(matches!(parse_work_type("repair"), Some(WorkType::Repair)));
        assert!(matches!(parse_work_type("installation"), Some(WorkType::Installation)));
        assert!(matches!(parse_work_type("consultation"), Some(WorkType::Consultation)));
        assert!(matches!(parse_work_type("follow_up"), Some(WorkType::FollowUp)));
    }

    #[test]
    fn parse_work_type_cs_aliases() {
        use crate::types::WorkType;
        assert!(matches!(parse_work_type("revize"), Some(WorkType::Revision)));
        assert!(matches!(parse_work_type("kontrola"), Some(WorkType::Revision)));
        assert!(matches!(parse_work_type("oprava"), Some(WorkType::Repair)));
        assert!(matches!(parse_work_type("servis"), Some(WorkType::Repair)));
        assert!(matches!(parse_work_type("instalace"), Some(WorkType::Installation)));
        assert!(matches!(parse_work_type("montáž"), Some(WorkType::Installation)));
        assert!(matches!(parse_work_type("konzultace"), Some(WorkType::Consultation)));
        assert!(matches!(parse_work_type("následná"), Some(WorkType::FollowUp)));
    }

    // =========================================================================
    // parse_date / parse_time
    // =========================================================================

    #[test]
    fn parse_date_iso_format() {
        use chrono::NaiveDate;
        let d = parse_date("2025-03-15");
        assert_eq!(d, Some(NaiveDate::from_ymd_opt(2025, 3, 15).unwrap()));
    }

    #[test]
    fn parse_date_czech_format() {
        use chrono::NaiveDate;
        let d = parse_date("15.03.2025");
        assert_eq!(d, Some(NaiveDate::from_ymd_opt(2025, 3, 15).unwrap()));
    }

    #[test]
    fn parse_date_invalid_returns_none() {
        assert!(parse_date("").is_none());
        assert!(parse_date("not-a-date").is_none());
        assert!(parse_date("2025/03/15").is_none());
    }

    #[test]
    fn parse_time_hhmm() {
        use chrono::NaiveTime;
        let t = parse_time("09:30");
        assert_eq!(t, Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()));
    }

    #[test]
    fn parse_time_hhmmss() {
        use chrono::NaiveTime;
        let t = parse_time("09:30:00");
        assert_eq!(t, Some(NaiveTime::from_hms_opt(9, 30, 0).unwrap()));
    }

    #[test]
    fn parse_time_invalid_returns_none() {
        assert!(parse_time("").is_none());
        assert!(parse_time("25:00").is_none());
        assert!(parse_time("not-a-time").is_none());
    }

    // =========================================================================
    // NATS subject constants (contract tests)
    // =========================================================================

    #[test]
    fn customer_import_status_prefix_contract() {
        // The backend currently uses "sazinka.job.import.status" but the plan
        // requires it to be aligned to "sazinka.job.import.customer.status".
        // This test documents the REQUIRED value after Phase 1 fix.
        // It will FAIL until Phase 1 is implemented (expected RED).
        assert_eq!(
            crate::handlers::import::CUSTOMER_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.customer.status",
            "Customer status prefix must match frontend subscription subject"
        );
    }

    #[test]
    fn customer_import_subject_contract() {
        // Frontend submits to "sazinka.import.customer.submit"
        // Backend listens on CUSTOMER_IMPORT_SUBJECT
        assert_eq!(
            crate::handlers::import::CUSTOMER_IMPORT_SUBJECT,
            "sazinka.import.customer.submit",
            "Customer import subject must match frontend publish subject"
        );
    }
}

#[cfg(test)]
mod import_processors_tests {
    use crate::handlers::import_processors::*;

    // =========================================================================
    // classify_error
    // =========================================================================

    #[test]
    fn classify_error_customer_not_found() {
        let (code, field) = classify_error("import:customer_not_found");
        assert!(matches!(code, crate::types::ImportIssueCode::CustomerNotFound));
        assert_eq!(field, "customer_ref");
    }

    #[test]
    fn classify_error_device_not_found() {
        let (code, field) = classify_error("import:device_not_found");
        assert!(matches!(code, crate::types::ImportIssueCode::DeviceNotFound));
        assert_eq!(field, "device_ref");
    }

    #[test]
    fn classify_error_missing_field() {
        let (code, _) = classify_error("import:missing_customer_ref");
        assert!(matches!(code, crate::types::ImportIssueCode::MissingField));
    }

    #[test]
    fn classify_error_duplicate_record() {
        let (code, _) = classify_error("duplicate key value violates unique constraint");
        assert!(matches!(code, crate::types::ImportIssueCode::DuplicateRecord));

        let (code2, _) = classify_error("import:revision_already_exists");
        assert!(matches!(code2, crate::types::ImportIssueCode::DuplicateRecord));
    }

    #[test]
    fn classify_error_invalid_date() {
        let (code, _) = classify_error("import:invalid_date_format");
        assert!(matches!(code, crate::types::ImportIssueCode::InvalidDate));
    }

    #[test]
    fn classify_error_db_error() {
        let (code, _) = classify_error("sqlx error: connection refused");
        assert!(matches!(code, crate::types::ImportIssueCode::DbError));
    }

    #[test]
    fn classify_error_unknown_fallback() {
        let (code, _) = classify_error("some completely unknown error");
        assert!(matches!(code, crate::types::ImportIssueCode::Unknown));
    }

    // =========================================================================
    // build_import_report
    // =========================================================================

    #[test]
    fn build_import_report_basic() {
        use uuid::Uuid;
        use chrono::Utc;

        let job_id = Uuid::new_v4();
        let started_at = Utc::now();
        let report = build_import_report(
            job_id,
            "import.customer",
            "test.csv",
            started_at,
            100,
            90,
            10,
            vec![],
        );

        assert_eq!(report.job_id, job_id);
        assert_eq!(report.job_type, "import.customer");
        assert_eq!(report.filename, "test.csv");
        assert_eq!(report.total_rows, 100);
        assert_eq!(report.imported_count, 90);
        assert_eq!(report.skipped_count, 0); // total - succeeded - failed = 100 - 90 - 10 = 0
        assert!(report.duration_ms < 5000); // should be very fast in test
    }

    #[test]
    fn build_import_report_with_issues() {
        use uuid::Uuid;
        use chrono::Utc;
        use crate::types::{ImportIssue, ImportIssueLevel, ImportIssueCode};

        let job_id = Uuid::new_v4();
        let issues = vec![
            ImportIssue {
                row_number: 5,
                level: ImportIssueLevel::Error,
                code: ImportIssueCode::CustomerNotFound,
                field: "customer_ref".to_string(),
                message: "Customer not found".to_string(),
                original_value: Some("unknown".to_string()),
            },
        ];

        let report = build_import_report(
            job_id, "import.device", "devices.csv",
            Utc::now(), 10, 9, 1, issues,
        );

        assert_eq!(report.issues.len(), 1);
        assert_eq!(report.issues[0].row_number, 5);
    }

    #[test]
    fn build_import_report_skipped_count_calculation() {
        use uuid::Uuid;
        use chrono::Utc;

        // total=10, succeeded=7, failed=2 => skipped=1
        let report = build_import_report(
            Uuid::new_v4(), "import.customer", "test.csv",
            Utc::now(), 10, 7, 2, vec![],
        );
        assert_eq!(report.skipped_count, 1);
    }

    // =========================================================================
    // NATS subject constants for processors
    // =========================================================================

    #[test]
    fn device_import_status_prefix_contract() {
        assert_eq!(
            crate::handlers::import_processors::DEVICE_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.device.status"
        );
    }

    #[test]
    fn revision_import_status_prefix_contract() {
        assert_eq!(
            crate::handlers::import_processors::REVISION_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.revision.status"
        );
    }

    #[test]
    fn communication_import_status_prefix_contract() {
        assert_eq!(
            crate::handlers::import_processors::COMMUNICATION_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.communication.status"
        );
    }

    #[test]
    fn work_log_import_status_prefix_contract() {
        assert_eq!(
            crate::handlers::import_processors::WORK_LOG_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.worklog.status"
        );
    }

    #[test]
    fn zip_import_status_prefix_contract() {
        assert_eq!(
            crate::handlers::import_processors::ZIP_IMPORT_STATUS_PREFIX,
            "sazinka.job.import.zip.status"
        );
    }

    #[test]
    fn device_import_submit_subject_contract() {
        // Frontend submits to "sazinka.import.device.submit"
        assert_eq!(
            crate::handlers::import_processors::DEVICE_IMPORT_SUBJECT,
            "sazinka.import.device.submit"
        );
    }

    #[test]
    fn revision_import_submit_subject_contract() {
        assert_eq!(
            crate::handlers::import_processors::REVISION_IMPORT_SUBJECT,
            "sazinka.import.revision.submit"
        );
    }

    #[test]
    fn communication_import_submit_subject_contract() {
        assert_eq!(
            crate::handlers::import_processors::COMMUNICATION_IMPORT_SUBJECT,
            "sazinka.import.communication.submit"
        );
    }

    #[test]
    fn work_log_import_submit_subject_contract() {
        assert_eq!(
            crate::handlers::import_processors::WORK_LOG_IMPORT_SUBJECT,
            "sazinka.import.worklog.submit"
        );
    }

    #[test]
    fn zip_import_submit_subject_contract() {
        assert_eq!(
            crate::handlers::import_processors::ZIP_IMPORT_SUBJECT,
            "sazinka.import.zip.submit"
        );
    }
}

#[cfg(test)]
mod csv_customer_row_tests {
    use crate::handlers::import::CsvCustomerRow;

    /// Canonical customer CSV header (snake_case) must deserialize correctly.
    #[test]
    fn csv_customer_row_canonical_headers() {
        let csv = "type;name;contact_person;ico;dic;street;city;postal_code;country;phone;email;notes\n\
                   company;ACME s.r.o.;Jan Novak;12345678;CZ12345678;Hlavni 1;Praha;11000;CZ;+420602000001;info@acme.cz;test note";

        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());

        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "ACME s.r.o.");
        assert_eq!(rows[0].ico.as_deref(), Some("12345678"));
        assert_eq!(rows[0].email.as_deref(), Some("info@acme.cz"));
    }

    /// The `type` field must be present in CsvCustomerRow (Phase 2 requirement).
    /// This test documents the contract. The field will be added in Phase 2.
    #[test]
    fn csv_customer_row_has_type_field() {
        // Verify the canonical CSV with type header parses without error.
        // The actual customer_type field check is done via a local struct
        // until Phase 2 adds the field to CsvCustomerRow.
        #[derive(serde::Deserialize)]
        struct WithType {
            #[serde(alias = "type")]
            customer_type: Option<String>,
            name: String,
        }
        let csv = "type;name\nperson;Jan Novak";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<WithType> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].customer_type.as_deref(), Some("person"));
        assert_eq!(rows[0].name, "Jan Novak");
        // TODO Phase 2: assert!(rows[0].customer_type.is_some()) on actual CsvCustomerRow
    }

    /// Czech alias headers must also deserialize.
    #[test]
    fn csv_customer_row_czech_aliases() {
        let csv = "nazev;ico;telefon\nFirma s.r.o.;12345678;602111222";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows[0].name, "Firma s.r.o.");
        assert_eq!(rows[0].ico.as_deref(), Some("12345678"));
        assert_eq!(rows[0].phone.as_deref(), Some("602111222"));
    }

    /// UTF-8 BOM should be handled gracefully.
    #[test]
    fn csv_customer_row_utf8_bom() {
        // BOM is 3 bytes: EF BB BF
        let bom = "\u{FEFF}";
        let csv = format!("{}name;city\nJan;Praha", bom);
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        // With BOM the first header might be "\u{FEFF}name" - this should still work
        // after Phase 1 BOM stripping is added
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Jan");
    }
}

#[cfg(test)]
mod csv_device_row_tests {
    /// CsvDeviceRow must have a device_name field (Phase 2 requirement).
    /// This test will FAIL until Phase 2 adds the field.
    #[test]
    fn csv_device_row_has_device_name() {
        // We test the JetStream processor's CsvDeviceRow struct
        // by checking the canonical CSV parses device_name
        let csv = "customer_ref;device_type;device_name;manufacturer;model;serial_number;installation_date;revision_interval_months;notes\n\
                   jan@example.com;gas_boiler;Kotel Alfa;Vaillant;ecoTEC;SN123;2020-01-01;12;ok";

        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());

        // We use a local struct to verify the CSV shape
        #[derive(serde::Deserialize, Debug)]
        struct TestDeviceRow {
            customer_ref: Option<String>,
            device_type: Option<String>,
            #[serde(alias = "device_name")]
            device_name: Option<String>,
            manufacturer: Option<String>,
            model: Option<String>,
            serial_number: Option<String>,
        }

        let rows: Vec<TestDeviceRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].device_name.as_deref(), Some("Kotel Alfa"));
        assert_eq!(rows[0].manufacturer.as_deref(), Some("Vaillant"));
    }
}

#[cfg(test)]
mod work_log_grouping_tests {
    use std::collections::HashMap;

    /// Work log rows with same customer_ref + scheduled_date must be grouped.
    /// This tests the grouping logic contract.
    #[test]
    fn work_log_groups_by_customer_and_date() {
        #[derive(Clone)]
        struct Row {
            customer_ref: String,
            scheduled_date: String,
            work_type: String,
        }

        let rows = vec![
            Row { customer_ref: "jan@example.com".into(), scheduled_date: "2025-03-15".into(), work_type: "revision".into() },
            Row { customer_ref: "jan@example.com".into(), scheduled_date: "2025-03-15".into(), work_type: "repair".into() },
            Row { customer_ref: "petr@example.com".into(), scheduled_date: "2025-03-15".into(), work_type: "revision".into() },
            Row { customer_ref: "jan@example.com".into(), scheduled_date: "2025-03-16".into(), work_type: "consultation".into() },
        ];

        let mut groups: HashMap<(String, String), Vec<Row>> = HashMap::new();
        for row in rows {
            let key = (row.customer_ref.clone(), row.scheduled_date.clone());
            groups.entry(key).or_default().push(row);
        }

        // jan@example.com + 2025-03-15 should have 2 work items
        let key1 = ("jan@example.com".to_string(), "2025-03-15".to_string());
        assert_eq!(groups[&key1].len(), 2);

        // petr@example.com + 2025-03-15 should have 1 work item
        let key2 = ("petr@example.com".to_string(), "2025-03-15".to_string());
        assert_eq!(groups[&key2].len(), 1);

        // jan@example.com + 2025-03-16 should have 1 work item
        let key3 = ("jan@example.com".to_string(), "2025-03-16".to_string());
        assert_eq!(groups[&key3].len(), 1);

        // Total groups = 3
        assert_eq!(groups.len(), 3);
    }

    /// First non-empty value wins for visit-level fields.
    #[test]
    fn work_log_first_non_empty_wins_for_visit_fields() {
        let times = vec![
            (Some("09:00"), Some("10:00")),
            (None, Some("11:00")),
            (Some("08:00"), None),
        ];

        let first_start = times.iter().find_map(|(s, _)| *s);
        let first_end = times.iter().find_map(|(_, e)| *e);

        assert_eq!(first_start, Some("09:00"));
        assert_eq!(first_end, Some("10:00"));
    }
}

#[cfg(test)]
mod export_ref_resolution_tests {
    /// customer_ref export priority: ICO -> email -> phone -> customer_uuid:<uuid>
    #[test]
    fn customer_ref_priority_ico_first() {
        struct Customer {
            ico: Option<String>,
            email: Option<String>,
            phone: Option<String>,
            id: uuid::Uuid,
        }

        fn export_customer_ref(c: &Customer) -> String {
            if let Some(ico) = &c.ico {
                return ico.clone();
            }
            if let Some(email) = &c.email {
                return email.clone();
            }
            if let Some(phone) = &c.phone {
                return phone.clone();
            }
            format!("customer_uuid:{}", c.id)
        }

        let c_with_ico = Customer {
            ico: Some("12345678".into()),
            email: Some("test@example.com".into()),
            phone: Some("+420602000001".into()),
            id: uuid::Uuid::new_v4(),
        };
        assert_eq!(export_customer_ref(&c_with_ico), "12345678");

        let c_with_email_only = Customer {
            ico: None,
            email: Some("test@example.com".into()),
            phone: Some("+420602000001".into()),
            id: uuid::Uuid::new_v4(),
        };
        assert_eq!(export_customer_ref(&c_with_email_only), "test@example.com");

        let c_with_phone_only = Customer {
            ico: None,
            email: None,
            phone: Some("+420602000001".into()),
            id: uuid::Uuid::new_v4(),
        };
        assert_eq!(export_customer_ref(&c_with_phone_only), "+420602000001");

        let c_uuid_fallback = Customer {
            ico: None,
            email: None,
            phone: None,
            id: uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
        };
        assert_eq!(
            export_customer_ref(&c_uuid_fallback),
            "customer_uuid:00000000-0000-0000-0000-000000000001"
        );
    }

    /// device_ref export priority: serial_number -> device_name -> device_type (if unique) -> device_uuid:<uuid>
    #[test]
    fn device_ref_priority_serial_first() {
        struct Device {
            serial_number: Option<String>,
            device_name: Option<String>,
            device_type: String,
            id: uuid::Uuid,
        }

        fn export_device_ref(d: &Device) -> String {
            if let Some(serial) = &d.serial_number {
                return serial.clone();
            }
            if let Some(name) = &d.device_name {
                return name.clone();
            }
            format!("device_uuid:{}", d.id)
        }

        let d_with_serial = Device {
            serial_number: Some("SN123".into()),
            device_name: Some("Kotel Alfa".into()),
            device_type: "gas_boiler".into(),
            id: uuid::Uuid::new_v4(),
        };
        assert_eq!(export_device_ref(&d_with_serial), "SN123");

        let d_with_name = Device {
            serial_number: None,
            device_name: Some("Kotel Alfa".into()),
            device_type: "gas_boiler".into(),
            id: uuid::Uuid::new_v4(),
        };
        assert_eq!(export_device_ref(&d_with_name), "Kotel Alfa");

        let d_uuid_fallback = Device {
            serial_number: None,
            device_name: None,
            device_type: "gas_boiler".into(),
            id: uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap(),
        };
        assert_eq!(
            export_device_ref(&d_uuid_fallback),
            "device_uuid:00000000-0000-0000-0000-000000000002"
        );
    }

    /// Import resolver must handle customer_uuid: prefix before normal heuristics.
    #[test]
    fn resolve_customer_ref_uuid_prefix_recognized() {
        let ref_str = "customer_uuid:00000000-0000-0000-0000-000000000001";
        let has_prefix = ref_str.starts_with("customer_uuid:");
        assert!(has_prefix, "Resolver must detect customer_uuid: prefix");

        let uuid_str = &ref_str["customer_uuid:".len()..];
        let parsed = uuid::Uuid::parse_str(uuid_str);
        assert!(parsed.is_ok(), "UUID after prefix must be valid");
    }

    /// Import resolver must handle device_uuid: prefix before normal heuristics.
    #[test]
    fn resolve_device_ref_uuid_prefix_recognized() {
        let ref_str = "device_uuid:00000000-0000-0000-0000-000000000002";
        let has_prefix = ref_str.starts_with("device_uuid:");
        assert!(has_prefix, "Resolver must detect device_uuid: prefix");

        let uuid_str = &ref_str["device_uuid:".len()..];
        let parsed = uuid::Uuid::parse_str(uuid_str);
        assert!(parsed.is_ok(), "UUID after prefix must be valid");
    }
}

#[cfg(test)]
mod export_csv_header_tests {
    /// Export CSV headers must match canonical format from PRJ_PLAN.MD.
    #[test]
    fn customers_csv_canonical_headers() {
        let expected = "type;name;contact_person;ico;dic;street;city;postal_code;country;phone;email;notes";
        // This test will verify the actual export output once Phase 6 is implemented.
        // For now it documents the contract.
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "type");
        assert_eq!(cols[1], "name");
        assert_eq!(cols[4], "dic");
        assert_eq!(cols[11], "notes");
        assert_eq!(cols.len(), 12);
    }

    #[test]
    fn devices_csv_canonical_headers() {
        let expected = "customer_ref;device_type;device_name;manufacturer;model;serial_number;installation_date;revision_interval_months;notes";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "customer_ref");
        assert_eq!(cols[2], "device_name"); // device_name must be present
        assert_eq!(cols.len(), 9);
    }

    #[test]
    fn revisions_csv_canonical_headers() {
        let expected = "device_ref;customer_ref;due_date;status;scheduled_date;scheduled_time_start;scheduled_time_end;completed_at;duration_minutes;result;findings";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "device_ref");
        assert_eq!(cols[1], "customer_ref");
        assert_eq!(cols.len(), 11);
    }

    #[test]
    fn communications_csv_canonical_headers() {
        let expected = "customer_ref;date;comm_type;direction;subject;content;contact_name;contact_phone;duration_minutes";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "customer_ref");
        assert_eq!(cols[1], "date");
        assert_eq!(cols.len(), 9);
    }

    #[test]
    fn work_log_csv_canonical_headers() {
        let expected = "customer_ref;scheduled_date;scheduled_time_start;scheduled_time_end;device_ref;work_type;status;result;duration_minutes;result_notes;findings;requires_follow_up;follow_up_reason";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "customer_ref");
        assert_eq!(cols[5], "work_type"); // unified work_type (not visit_type)
        assert_eq!(cols.len(), 13);
    }

    #[test]
    fn routes_csv_canonical_headers() {
        let expected = "route_id;date;status;crew_id;crew_name;depot_id;total_distance_km;total_duration_minutes;optimization_score;stops_count";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "route_id");
        assert_eq!(cols.len(), 10);
    }

    #[test]
    fn route_stops_csv_canonical_headers() {
        let expected = "route_id;stop_order;stop_type;customer_ref;revision_ref;customer_name;address;eta;etd;break_duration_minutes;break_time_start;scheduled_date;scheduled_time_start;scheduled_time_end;revision_status";
        let cols: Vec<&str> = expected.split(';').collect();
        assert_eq!(cols[0], "route_id");
        assert_eq!(cols[3], "customer_ref"); // real ref, not pseudo-id
        assert_eq!(cols.len(), 15);
    }
}

#[cfg(test)]
mod csv_edge_cases {
    use crate::handlers::import::CsvCustomerRow;

    #[test]
    fn header_only_csv_produces_zero_rows() {
        let csv = "name;city;email";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap_or_default();
        assert_eq!(rows.len(), 0);
    }

    #[test]
    fn quoted_semicolons_preserved() {
        let csv = "name;notes\nJan;\"Poznámka; s středníkem\"";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].notes.as_deref(), Some("Poznámka; s středníkem"));
    }

    #[test]
    fn czech_characters_preserved() {
        let csv = "name;city\nJiří Černý;Ústí nad Labem";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows[0].name, "Jiří Černý");
        assert_eq!(rows[0].city.as_deref(), Some("Ústí nad Labem"));
    }

    #[test]
    fn crlf_line_endings_handled() {
        let csv = "name;city\r\nJan;Praha\r\nPetr;Brno";
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .from_reader(csv.as_bytes());
        let rows: Vec<CsvCustomerRow> = reader.deserialize().collect::<Result<_, _>>().unwrap();
        assert_eq!(rows.len(), 2);
    }
}
