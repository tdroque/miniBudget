package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
)

func newTestAPI(t *testing.T) *api {
	t.Helper()
	db := openDB(filepath.Join(t.TempDir(), "test.db"))
	t.Cleanup(func() { db.Close() })
	return &api{db: db, receiptsDir: t.TempDir(), raceBudgetCategory: "Races"}
}

func call(t *testing.T, h http.HandlerFunc, method string, id int64, body any) (int, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, "/", &buf)
	if id != 0 {
		req.SetPathValue("id", strconv.FormatInt(id, 10))
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec.Code, rec.Body.Bytes()
}

func mustCost(t *testing.T, a *api, raceID int64, name string, amt float64) RaceCost {
	t.Helper()
	code, b := call(t, a.createRaceCost, "POST", 0, RaceCost{RaceID: raceID, Name: name, Amount: amt, Category: "Travel"})
	if code != 201 {
		t.Fatalf("create cost: %d %s", code, b)
	}
	var c RaceCost
	json.Unmarshal(b, &c)
	return c
}

func txnCount(t *testing.T, a *api) int {
	var n int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM transactions`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRaceCostMirroring(t *testing.T) {
	a := newTestAPI(t)

	code, b := call(t, a.createRace, "POST", 0, Race{Name: "Cascade 50K", Type: "Ultra", Date: "2026-06-20", Budget: 900})
	if code != 201 {
		t.Fatalf("create race: %d %s", code, b)
	}
	var race Race
	json.Unmarshal(b, &race)

	// Race costs never appear in miniBudget on their own.
	c := mustCost(t, a, race.ID, "Gas", 80)
	if c.Status != "planned" || c.TransactionID != nil {
		t.Fatalf("unexpected new cost: %+v", c)
	}
	if n := txnCount(t, a); n != 0 {
		t.Fatalf("expected 0 transactions, got %d", n)
	}

	// One click: marks paid, creates the expense, auto-creates the category.
	code, b = call(t, a.addCostToBudget, "POST", c.ID, nil)
	if code != 201 {
		t.Fatalf("add to budget: %d %s", code, b)
	}
	json.Unmarshal(b, &c)
	if c.TransactionID == nil || c.Status != "paid" || c.Date == "" {
		t.Fatalf("not linked/paid/dated: %+v", c)
	}
	txn, err := a.getTransaction(*c.TransactionID)
	if err != nil || txn.Amount != 80 || txn.Type != "expense" || txn.Category != "Races" || txn.Name != "Gas" {
		t.Fatalf("bad transaction: %+v %v", txn, err)
	}
	if txn.Description != "Race: Cascade 50K" {
		t.Fatalf("description: %q", txn.Description)
	}
	var catN int
	a.db.QueryRow(`SELECT COUNT(*) FROM categories WHERE name='Races' AND type='expense'`).Scan(&catN)
	if catN != 1 {
		t.Fatalf("budget category not created")
	}
	// Idempotent.
	if code, _ = call(t, a.addCostToBudget, "POST", c.ID, nil); code != 200 || txnCount(t, a) != 1 {
		t.Fatalf("second add should be a no-op, code=%d", code)
	}

	// Editing the cost mirrors to the transaction; linked costs stay paid.
	c.Amount, c.Note, c.Status = 95.5, "bridge toll", "planned"
	code, b = call(t, a.updateRaceCost, "PUT", c.ID, c)
	if code != 200 {
		t.Fatalf("update: %d %s", code, b)
	}
	json.Unmarshal(b, &c)
	txn, _ = a.getTransaction(*c.TransactionID)
	if c.Status != "paid" || txn.Amount != 95.5 || txn.Description != "Race: Cascade 50K — bridge toll" {
		t.Fatalf("not mirrored: cost=%+v txn=%+v", c, txn)
	}

	// Renaming the race refreshes linked descriptions.
	race.Name = "Cascade 50K 2026"
	if code, _ = call(t, a.updateRace, "PUT", race.ID, race); code != 200 {
		t.Fatalf("update race: %d", code)
	}
	txn, _ = a.getTransaction(*c.TransactionID)
	if txn.Description != "Race: Cascade 50K 2026 — bridge toll" {
		t.Fatalf("description not refreshed: %q", txn.Description)
	}

	// Undo removes the transaction but keeps the cost.
	if code, b = call(t, a.removeCostFromBudget, "DELETE", c.ID, nil); code != 200 {
		t.Fatalf("undo: %d %s", code, b)
	}
	json.Unmarshal(b, &c)
	if c.TransactionID != nil || c.Status != "paid" || txnCount(t, a) != 0 {
		t.Fatalf("undo failed: %+v txns=%d", c, txnCount(t, a))
	}

	// Deleting the transaction in miniBudget unlinks the cost (FK SET NULL).
	call(t, a.addCostToBudget, "POST", c.ID, nil)
	cur, _ := getRaceCost(a.db, c.ID)
	if code, _ = call(t, a.deleteTransaction, "DELETE", *cur.TransactionID, nil); code != 204 {
		t.Fatalf("delete txn: %d", code)
	}
	cur, _ = getRaceCost(a.db, c.ID)
	if cur.TransactionID != nil {
		t.Fatalf("cost should be unlinked after miniBudget delete")
	}

	// Deleting a linked cost deletes its transaction.
	call(t, a.addCostToBudget, "POST", c.ID, nil)
	if code, _ = call(t, a.deleteRaceCost, "DELETE", c.ID, nil); code != 204 || txnCount(t, a) != 0 {
		t.Fatalf("delete cost: code=%d txns=%d", code, txnCount(t, a))
	}

	// Deleting a race deletes its costs, limits and mirrored transactions.
	c2 := mustCost(t, a, race.ID, "Flight", 300)
	call(t, a.addCostToBudget, "POST", c2.ID, nil)
	call(t, a.createRaceLimit, "POST", 0, RaceLimit{RaceID: race.ID, Category: "Travel", Amount: 500})
	if code, _ = call(t, a.deleteRace, "DELETE", race.ID, nil); code != 204 {
		t.Fatalf("delete race: %d", code)
	}
	var costs, limits int
	a.db.QueryRow(`SELECT COUNT(*) FROM race_costs`).Scan(&costs)
	a.db.QueryRow(`SELECT COUNT(*) FROM race_limits`).Scan(&limits)
	if costs != 0 || limits != 0 || txnCount(t, a) != 0 {
		t.Fatalf("race delete left rows: costs=%d limits=%d txns=%d", costs, limits, txnCount(t, a))
	}
}

func TestRaceValidationAndSync(t *testing.T) {
	a := newTestAPI(t)
	_, b := call(t, a.createRace, "POST", 0, Race{Name: "Tri", Budget: 100})
	var race Race
	json.Unmarshal(b, &race)

	if code, _ := call(t, a.createRaceCost, "POST", 0, RaceCost{RaceID: race.ID, Name: "x", Amount: 0, Category: "Food"}); code != 400 {
		t.Fatalf("zero amount should be 400, got %d", code)
	}
	if code, _ := call(t, a.createRaceCost, "POST", 0, RaceCost{RaceID: 999, Name: "x", Amount: 5, Category: "Food"}); code != 400 {
		t.Fatalf("unknown race should be 400, got %d", code)
	}
	if code, _ := call(t, a.createRaceCost, "POST", 0, RaceCost{RaceID: race.ID, Name: "x", Amount: 5, Category: "Food", Date: "June 1"}); code != 400 {
		t.Fatalf("bad date should be 400, got %d", code)
	}
	lim := RaceLimit{RaceID: race.ID, Category: "Food", Amount: 50}
	if code, _ := call(t, a.createRaceLimit, "POST", 0, lim); code != 201 {
		t.Fatalf("limit create: %d", code)
	}
	if code, _ := call(t, a.createRaceLimit, "POST", 0, lim); code != 409 {
		t.Fatalf("duplicate limit should be 409, got %d", code)
	}

	code, b := call(t, a.handleRaceSync, "GET", 0, nil)
	if code != 200 {
		t.Fatalf("sync: %d", code)
	}
	var snap raceSyncSnapshot
	json.Unmarshal(b, &snap)
	if len(snap.Races) != 1 || len(snap.Limits) != 1 || len(snap.Categories) != len(defaultRaceCategories) || snap.Costs == nil || snap.BudgetCategory != "Races" {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
}
