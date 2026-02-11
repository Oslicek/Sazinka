use chrono::NaiveTime;

pub const DEFAULT_SERVICE_DURATION_MINUTES: u32 = 30;

pub fn default_work_start() -> NaiveTime {
    NaiveTime::from_hms_opt(8, 0, 0).expect("valid static default work start")
}

pub fn default_work_end() -> NaiveTime {
    NaiveTime::from_hms_opt(17, 0, 0).expect("valid static default work end")
}
