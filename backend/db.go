package main

import (
	"database/sql"
	"log"

	_ "modernc.org/sqlite"
)

// defaultCategories seeds a starter set so the app isn't empty on first run.
// Users can add/remove freely from Settings afterwards.
var defaultCategories = []Category{
	{Name: "Paycheque", Type: "income"},
	{Name: "Freelance", Type: "income"},
	{Name: "Gift", Type: "income"},
	{Name: "Interest", Type: "income"},
	{Name: "Other income", Type: "income"},
	{Name: "Rent", Type: "expense"},
	{Name: "Groceries", Type: "expense"},
	{Name: "Utilities", Type: "expense"},
	{Name: "Transport", Type: "expense"},
	{Name: "Dining", Type: "expense"},
	{Name: "Subscriptions", Type: "expense"},
	{Name: "Health", Type: "expense"},
	{Name: "Other", Type: "expense"},
}

func openDB(path string) *sql.DB {
	db, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)")
	if err != nil {
		log.Fatalf("failed to open db: %v", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatalf("failed to connect to db: %v", err)
	}
	// SQLite likes a single writer; keep it simple for a single-user app.
	db.SetMaxOpenConns(1)

	schema := `
	CREATE TABLE IF NOT EXISTS transactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		amount REAL NOT NULL,
		category TEXT NOT NULL,
		type TEXT NOT NULL CHECK (type IN ('income','expense')),
		date TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		receipt_path TEXT,
		ocr_status TEXT NOT NULL DEFAULT 'none' CHECK (ocr_status IN ('none','pending','done','failed')),
		ocr_text TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS recurring_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		amount REAL NOT NULL,
		category TEXT NOT NULL,
		type TEXT NOT NULL CHECK (type IN ('income','expense')),
		frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly')),
		start_date TEXT NOT NULL,
		end_date TEXT,
		description TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		type TEXT NOT NULL CHECK (type IN ('income','expense')),
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		UNIQUE(name, type)
	);

	CREATE TABLE IF NOT EXISTS budgets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		category TEXT NOT NULL UNIQUE,
		amount REAL NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
	CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
	CREATE INDEX IF NOT EXISTS idx_recurring_start ON recurring_items(start_date);
	CREATE INDEX IF NOT EXISTS idx_budgets_category ON budgets(category);
	`

	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("failed to migrate schema: %v", err)
	}

	migrateColumns(db)
	seedCategories(db)

	return db
}

// migrateColumns adds columns introduced after the initial release to
// databases created by older versions of the app. CREATE TABLE IF NOT EXISTS
// only helps on a fresh database, so existing installs need ALTER TABLE.
func migrateColumns(db *sql.DB) {
	existing := map[string]bool{}
	rows, err := db.Query(`PRAGMA table_info(transactions)`)
	if err != nil {
		log.Fatalf("failed to inspect transactions schema: %v", err)
	}
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			rows.Close()
			log.Fatalf("failed to read transactions schema: %v", err)
		}
		existing[name] = true
	}
	rows.Close()

	alters := []struct {
		column string
		ddl    string
	}{
		{"receipt_path", `ALTER TABLE transactions ADD COLUMN receipt_path TEXT`},
		{"ocr_status", `ALTER TABLE transactions ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'none'`},
		{"ocr_text", `ALTER TABLE transactions ADD COLUMN ocr_text TEXT`},
	}
	for _, a := range alters {
		if !existing[a.column] {
			if _, err := db.Exec(a.ddl); err != nil {
				log.Fatalf("failed to add column %s: %v", a.column, err)
			}
		}
	}
}

// seedCategories inserts the starter category list only if the table is
// still empty, so it never overwrites categories the user has edited.
func seedCategories(db *sql.DB) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM categories`).Scan(&count); err != nil {
		log.Fatalf("failed to check categories: %v", err)
	}
	if count > 0 {
		return
	}
	for _, c := range defaultCategories {
		if _, err := db.Exec(`INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)`, c.Name, c.Type); err != nil {
			log.Fatalf("failed to seed category %s: %v", c.Name, err)
		}
	}
}
