CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT,
  locale TEXT DEFAULT 'en',
  ticket_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  locale TEXT DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'pending',
  confirm_token TEXT UNIQUE,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);
