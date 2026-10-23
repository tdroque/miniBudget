package main

// Race Budget: a companion feature that shares miniBudget's backend, database
// and conventions (JSON REST, one SQLite file, offline-friendly snapshot).
//
// Race costs live in their own tables, so they never show up in miniBudget's
// entries or summary on their own. A race cost can be pushed into miniBudget
// with POST /api/race-costs/{id}/budget, which creates a normal expense
// transaction and links the two. From then on, edits and deletes of the race
// cost are mirrored to that transaction (race -> miniBudget only).

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var defaultRaceCategories = []string{"Entry fee", "Travel", "Lodging", "Food", "Gear", "Other"}

type Race struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Date      string  `json:"date"` // YYYY-MM-DD or ""
	Budget    float64 `json:"budget"`
	CreatedAt string  `json:"created_at,omitempty"`
}

type RaceCost struct {
	ID            int64   `json:"id"`
	RaceID        int64   `json:"race_id"`
	Name          string  `json:"name"`
	Amount        float64 `json:"amount"`
	Category      string  `json:"category"`
	Date          string  `json:"date"`   // YYYY-MM-DD or ""
	Status        string  `json:"status"` // "planned" | "paid"
	Note          string  `json:"note"`
	TransactionID *int64  `json:"transaction_id"` // set while mirrored in miniBudget
	CreatedAt     string  `json:"created_at,omitempty"`
}

type RaceLimit struct {
	ID        int64   `json:"id"`
	RaceID    int64   `json:"race_id"`
	Category  string  `json:"category"`
	Amount    float64 `json:"amount"`
	CreatedAt string  `json:"created_at,omitempty"`
}

type RaceCategory struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at,omitempty"`
}

type raceSyncSnapshot struct {
	ServerTime     string         `json:"server_time"`
	BudgetCategory string         `json:"budget_category"`
	Races          []Race         `json:"races"`
	Costs          []RaceCost     `json:"costs"`
	Limits         []RaceLimit    `json:"limits"`
	Categories     []RaceCategory `json:"categories"`
}

type rowQuerier interface {
	QueryRow(query string, args ...any) *sql.Row
}

type scanner interface {
	Scan(dest ...any) error
}

// ---------- schema ----------

const raceSchema = `
CREATE TABLE IF NOT EXISTS races (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	type TEXT NOT NULL DEFAULT '',
	date TEXT NOT NULL DEFAULT '',
	budget REAL NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS race_categories (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS race_limits (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
	category TEXT NOT NULL,
	amount REAL NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(race_id, category)
);

CREATE TABLE IF NOT EXISTS race_costs (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	amount REAL NOT NULL,
	category TEXT NOT NULL,
	date TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','paid')),
	note TEXT NOT NULL DEFAULT '',
	-- If the linked miniBudget transaction is deleted there, the race cost
	-- simply becomes unlinked again.
	transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_race_costs_race ON race_costs(race_id);
CREATE INDEX IF NOT EXISTS idx_race_costs_txn ON race_costs(transaction_id);
`

func migrateRaceSchema(db *sql.DB) error {
	if _, err := db.Exec(raceSchema); err != nil {
		return err
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM race_categories`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		for _, c := range defaultRaceCategories {
			if _, err := db.Exec(`INSERT OR IGNORE INTO race_categories (name) VALUES (?)`, c); err != nil {
				return err
			}
		}
	}
	return nil
}

// ---------- validation ----------

func validOptionalDate(d string) bool {
	if d == "" {
		return true
	}
	_, err := time.Parse(dateLayout, d)
	return err == nil
}

func validateRace(r *Race) error {
	r.Name = strings.TrimSpace(r.Name)
	r.Type = strings.TrimSpace(r.Type)
	if r.Name == "" {
		return errBadRequest("name is required")
	}
	if r.Budget < 0 {
		return errBadRequest("budget cannot be negative")
	}
	if !validOptionalDate(r.Date) {
		return errBadRequest("date must be in YYYY-MM-DD format")
	}
	return nil
}

func validateRaceCost(c *RaceCost) error {
	c.Name = strings.TrimSpace(c.Name)
	c.Category = strings.TrimSpace(c.Category)
	c.Note = strings.TrimSpace(c.Note)
	if c.Status == "" {
		c.Status = "planned"
	}
	if c.Name == "" {
		return errBadRequest("name is required")
	}
	if c.Amount <= 0 {
		return errBadRequest("amount must be greater than 0")
	}
	if c.Category == "" {
		return errBadRequest("category is required")
	}
	if c.Status != "planned" && c.Status != "paid" {
		return errBadRequest("status must be planned or paid")
	}
	if !validOptionalDate(c.Date) {
		return errBadRequest("date must be in YYYY-MM-DD format")
	}
	return nil
}

func parseID(s string) (int64, error) { return strconv.ParseInt(s, 10, 64) }

func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return false
	}
	return true
}

func failBadRequest(w http.ResponseWriter, err error) {
	writeErr(w, http.StatusBadRequest, err.Error())
}

func (a *api) raceExists(q rowQuerier, id int64) bool {
	var one int
	return q.QueryRow(`SELECT 1 FROM races WHERE id = ?`, id).Scan(&one) == nil
}

// ---------- races ----------

func scanRace(s scanner) (Race, error) {
	var r Race
	err := s.Scan(&r.ID, &r.Name, &r.Type, &r.Date, &r.Budget, &r.CreatedAt)
	return r, err
}

const raceCols = `id, name, type, date, budget, created_at`

func (a *api) listAllRaces() ([]Race, error) {
	rows, err := a.db.Query(`SELECT ` + raceCols + ` FROM races ORDER BY CASE WHEN date = '' THEN 1 ELSE 0 END, date, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Race{}
	for rows.Next() {
		r, err := scanRace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (a *api) listRaces(w http.ResponseWriter, r *http.Request) {
	out, err := a.listAllRaces()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) createRace(w http.ResponseWriter, r *http.Request) {
	var in Race
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRace(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	res, err := a.db.Exec(`INSERT INTO races (name, type, date, budget) VALUES (?, ?, ?, ?)`, in.Name, in.Type, in.Date, in.Budget)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	saved, err := scanRace(a.db.QueryRow(`SELECT `+raceCols+` FROM races WHERE id = ?`, id))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) updateRace(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in Race
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRace(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()
	res, err := tx.Exec(`UPDATE races SET name=?, type=?, date=?, budget=? WHERE id=?`, in.Name, in.Type, in.Date, in.Budget, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "race not found")
		return
	}
	// Linked miniBudget entries mention the race name in their description.
	if err := refreshLinkedDescriptions(tx, id, in.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := scanRace(tx.QueryRow(`SELECT `+raceCols+` FROM races WHERE id = ?`, id))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *api) deleteRace(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	// Costs mirrored into miniBudget go with the race.
	rows, err := tx.Query(`SELECT transaction_id FROM race_costs WHERE race_id = ? AND transaction_id IS NOT NULL`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var txnIDs []int64
	for rows.Next() {
		var t int64
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		txnIDs = append(txnIDs, t)
	}
	rows.Close()

	var receipts []string
	for _, t := range txnIDs {
		p, err := deleteTransactionTx(tx, t)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if p != "" {
			receipts = append(receipts, p)
		}
	}
	if _, err := tx.Exec(`DELETE FROM races WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, p := range receipts {
		a.removeReceiptFile(p)
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- miniBudget mirroring helpers ----------

func raceDescription(raceName, note string) string {
	d := "Race: " + raceName
	if note != "" {
		d += " — " + note
	}
	return d
}

// deleteTransactionTx removes a transaction inside tx and returns its receipt
// path (if any) so the caller can delete the file after commit.
func deleteTransactionTx(tx *sql.Tx, id int64) (string, error) {
	var receipt sql.NullString
	err := tx.QueryRow(`SELECT receipt_path FROM transactions WHERE id = ?`, id).Scan(&receipt)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(`DELETE FROM transactions WHERE id = ?`, id); err != nil {
		return "", err
	}
	return receipt.String, nil
}

func refreshLinkedDescriptions(tx *sql.Tx, raceID int64, raceName string) error {
	rows, err := tx.Query(`SELECT transaction_id, note FROM race_costs WHERE race_id = ? AND transaction_id IS NOT NULL`, raceID)
	if err != nil {
		return err
	}
	type pair struct {
		id   int64
		note string
	}
	var ps []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.note); err != nil {
			rows.Close()
			return err
		}
		ps = append(ps, p)
	}
	rows.Close()
	for _, p := range ps {
		if _, err := tx.Exec(`UPDATE transactions SET description = ? WHERE id = ?`, raceDescription(raceName, p.note), p.id); err != nil {
			return err
		}
	}
	return nil
}

func (a *api) ensureBudgetCategory(tx *sql.Tx) error {
	_, err := tx.Exec(`INSERT OR IGNORE INTO categories (name, type) VALUES (?, 'expense')`, a.raceBudgetCategory)
	return err
}

// ---------- race costs ----------

const raceCostCols = `id, race_id, name, amount, category, date, status, note, transaction_id, created_at`

func scanRaceCost(s scanner) (RaceCost, error) {
	var c RaceCost
	var txn sql.NullInt64
	err := s.Scan(&c.ID, &c.RaceID, &c.Name, &c.Amount, &c.Category, &c.Date, &c.Status, &c.Note, &txn, &c.CreatedAt)
	if txn.Valid {
		v := txn.Int64
		c.TransactionID = &v
	}
	return c, err
}

func getRaceCost(q rowQuerier, id int64) (RaceCost, error) {
	return scanRaceCost(q.QueryRow(`SELECT `+raceCostCols+` FROM race_costs WHERE id = ?`, id))
}

func (a *api) listAllRaceCosts(raceID int64) ([]RaceCost, error) {
	q := `SELECT ` + raceCostCols + ` FROM race_costs`
	var args []any
	if raceID > 0 {
		q += ` WHERE race_id = ?`
		args = append(args, raceID)
	}
	q += ` ORDER BY CASE WHEN date = '' THEN 1 ELSE 0 END, date, id`
	rows, err := a.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RaceCost{}
	for rows.Next() {
		c, err := scanRaceCost(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *api) listRaceCosts(w http.ResponseWriter, r *http.Request) {
	var raceID int64
	if v := r.URL.Query().Get("race_id"); v != "" {
		n, err := parseID(v)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid race_id")
			return
		}
		raceID = n
	}
	out, err := a.listAllRaceCosts(raceID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) createRaceCost(w http.ResponseWriter, r *http.Request) {
	var in RaceCost
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRaceCost(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	if !a.raceExists(a.db, in.RaceID) {
		writeErr(w, http.StatusBadRequest, "race not found")
		return
	}
	res, err := a.db.Exec(
		`INSERT INTO race_costs (race_id, name, amount, category, date, status, note) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.RaceID, in.Name, in.Amount, in.Category, in.Date, in.Status, in.Note,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	saved, err := getRaceCost(a.db, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) updateRaceCost(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in RaceCost
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRaceCost(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	cur, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "race cost not found")
		return
	}
	if in.RaceID == 0 {
		in.RaceID = cur.RaceID
	}
	if !a.raceExists(tx, in.RaceID) {
		writeErr(w, http.StatusBadRequest, "race not found")
		return
	}
	linked := cur.TransactionID != nil
	if linked {
		// A cost that's in miniBudget has been spent by definition.
		in.Status = "paid"
		if in.Date == "" {
			in.Date = cur.Date
		}
	}
	if _, err := tx.Exec(
		`UPDATE race_costs SET race_id=?, name=?, amount=?, category=?, date=?, status=?, note=? WHERE id=?`,
		in.RaceID, in.Name, in.Amount, in.Category, in.Date, in.Status, in.Note, id,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if linked {
		var raceName string
		if err := tx.QueryRow(`SELECT name FROM races WHERE id = ?`, in.RaceID).Scan(&raceName); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if _, err := tx.Exec(
			`UPDATE transactions SET name=?, amount=?, date=?, description=? WHERE id=?`,
			in.Name, in.Amount, in.Date, raceDescription(raceName, in.Note), *cur.TransactionID,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	saved, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *api) deleteRaceCost(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	var receipt string
	if cur, err := getRaceCost(tx, id); err == nil && cur.TransactionID != nil {
		if receipt, err = deleteTransactionTx(tx, *cur.TransactionID); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM race_costs WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if receipt != "" {
		a.removeReceiptFile(receipt)
	}
	w.WriteHeader(http.StatusNoContent)
}

// addCostToBudget is the one-click "send to miniBudget". It marks the cost as
// paid (it's now in the real ledger), creates an expense transaction and
// links the two. Calling it again on an already-linked cost is a no-op.
func (a *api) addCostToBudget(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	c, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "race cost not found")
		return
	}
	if c.TransactionID != nil {
		writeJSON(w, http.StatusOK, c)
		return
	}
	var raceName string
	if err := tx.QueryRow(`SELECT name FROM races WHERE id = ?`, c.RaceID).Scan(&raceName); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	date := c.Date
	if date == "" {
		date = time.Now().Format(dateLayout)
	}
	if err := a.ensureBudgetCategory(tx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	res, err := tx.Exec(
		`INSERT INTO transactions (name, amount, category, type, date, description) VALUES (?, ?, ?, 'expense', ?, ?)`,
		c.Name, c.Amount, a.raceBudgetCategory, date, raceDescription(raceName, c.Note),
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	txnID, _ := res.LastInsertId()
	if _, err := tx.Exec(`UPDATE race_costs SET status='paid', date=?, transaction_id=? WHERE id=?`, date, txnID, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

// removeCostFromBudget is the undo: it deletes the mirrored transaction and
// unlinks the race cost, which stays as a paid cost in Race Budget.
func (a *api) removeCostFromBudget(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := a.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	c, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "race cost not found")
		return
	}
	var receipt string
	if c.TransactionID != nil {
		if receipt, err = deleteTransactionTx(tx, *c.TransactionID); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if _, err := tx.Exec(`UPDATE race_costs SET transaction_id = NULL WHERE id = ?`, id); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	saved, err := getRaceCost(tx, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if receipt != "" {
		a.removeReceiptFile(receipt)
	}
	writeJSON(w, http.StatusOK, saved)
}

// ---------- per-race category limits ----------

func scanRaceLimit(s scanner) (RaceLimit, error) {
	var l RaceLimit
	err := s.Scan(&l.ID, &l.RaceID, &l.Category, &l.Amount, &l.CreatedAt)
	return l, err
}

const raceLimitCols = `id, race_id, category, amount, created_at`

func (a *api) listAllRaceLimits() ([]RaceLimit, error) {
	rows, err := a.db.Query(`SELECT ` + raceLimitCols + ` FROM race_limits ORDER BY race_id, category`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RaceLimit{}
	for rows.Next() {
		l, err := scanRaceLimit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (a *api) listRaceLimits(w http.ResponseWriter, r *http.Request) {
	out, err := a.listAllRaceLimits()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func validateRaceLimit(l *RaceLimit) error {
	l.Category = strings.TrimSpace(l.Category)
	if l.Category == "" {
		return errBadRequest("category is required")
	}
	if l.Amount <= 0 {
		return errBadRequest("amount must be greater than 0")
	}
	return nil
}

func (a *api) createRaceLimit(w http.ResponseWriter, r *http.Request) {
	var in RaceLimit
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRaceLimit(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	if !a.raceExists(a.db, in.RaceID) {
		writeErr(w, http.StatusBadRequest, "race not found")
		return
	}
	res, err := a.db.Exec(`INSERT INTO race_limits (race_id, category, amount) VALUES (?, ?, ?)`, in.RaceID, in.Category, in.Amount)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, http.StatusConflict, "a limit for that category already exists on this race")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	saved, err := scanRaceLimit(a.db.QueryRow(`SELECT `+raceLimitCols+` FROM race_limits WHERE id = ?`, id))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) updateRaceLimit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var in RaceLimit
	if !decodeBody(w, r, &in) {
		return
	}
	if err := validateRaceLimit(&in); err != nil {
		failBadRequest(w, err)
		return
	}
	// A limit's race is fixed once created; only category/amount can change.
	res, err := a.db.Exec(`UPDATE race_limits SET category=?, amount=? WHERE id=?`, in.Category, in.Amount, id)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, http.StatusConflict, "a limit for that category already exists on this race")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "limit not found")
		return
	}
	saved, err := scanRaceLimit(a.db.QueryRow(`SELECT `+raceLimitCols+` FROM race_limits WHERE id = ?`, id))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *api) deleteRaceLimit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := a.db.Exec(`DELETE FROM race_limits WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- race categories ----------

func (a *api) listAllRaceCategories() ([]RaceCategory, error) {
	rows, err := a.db.Query(`SELECT id, name, created_at FROM race_categories ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RaceCategory{}
	for rows.Next() {
		var c RaceCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (a *api) listRaceCategories(w http.ResponseWriter, r *http.Request) {
	out, err := a.listAllRaceCategories()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) createRaceCategory(w http.ResponseWriter, r *http.Request) {
	var in RaceCategory
	if !decodeBody(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	// Adding a category that already exists just returns the existing one.
	if _, err := a.db.Exec(`INSERT OR IGNORE INTO race_categories (name) VALUES (?)`, in.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var saved RaceCategory
	err := a.db.QueryRow(`SELECT id, name, created_at FROM race_categories WHERE name = ?`, in.Name).Scan(&saved.ID, &saved.Name, &saved.CreatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) deleteRaceCategory(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	// Like miniBudget categories: only removes it from the picker; past
	// costs keep their category text.
	if _, err := a.db.Exec(`DELETE FROM race_categories WHERE id = ?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- offline bootstrap ----------

func (a *api) handleRaceSync(w http.ResponseWriter, r *http.Request) {
	races, err := a.listAllRaces()
	if err == nil {
		var costs []RaceCost
		var limits []RaceLimit
		var cats []RaceCategory
		if costs, err = a.listAllRaceCosts(0); err == nil {
			if limits, err = a.listAllRaceLimits(); err == nil {
				if cats, err = a.listAllRaceCategories(); err == nil {
					writeJSON(w, http.StatusOK, raceSyncSnapshot{
						ServerTime:     time.Now().UTC().Format(time.RFC3339),
						BudgetCategory: a.raceBudgetCategory,
						Races:          races,
						Costs:          costs,
						Limits:         limits,
						Categories:     cats,
					})
					return
				}
			}
		}
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}
