package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type api struct {
	db          *sql.DB
	receiptsDir string
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func pathID(r *http.Request) (int64, error) {
	return strconv.ParseInt(r.PathValue("id"), 10, 64)
}

func parseDateRange(r *http.Request) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	startStr := r.URL.Query().Get("start")
	endStr := r.URL.Query().Get("end")

	if startStr == "" {
		startStr = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).Format(dateLayout)
	}
	if endStr == "" {
		endStr = time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, time.UTC).Format(dateLayout)
	}

	start, err := time.Parse(dateLayout, startStr)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end, err := time.Parse(dateLayout, endStr)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return start, end, nil
}

// ---------- Transactions ----------

func (a *api) listTransactionsRange(start, end time.Time) ([]Transaction, error) {
	rows, err := a.db.Query(
		`SELECT id, name, amount, category, type, date, description, receipt_path, ocr_status, ocr_text, created_at
		 FROM transactions WHERE date >= ? AND date <= ? ORDER BY date DESC, id DESC`,
		start.Format(dateLayout), end.Format(dateLayout),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Transaction
	for rows.Next() {
		var t Transaction
		var receiptPath, ocrText sql.NullString
		if err := rows.Scan(&t.ID, &t.Name, &t.Amount, &t.Category, &t.Type, &t.Date, &t.Description, &receiptPath, &t.OCRStatus, &ocrText, &t.CreatedAt); err != nil {
			return nil, err
		}
		if receiptPath.Valid {
			t.ReceiptPath = &receiptPath.String
		}
		if ocrText.Valid {
			t.OCRText = &ocrText.String
		}
		out = append(out, t)
	}
	return out, nil
}

func (a *api) getTransaction(id int64) (Transaction, error) {
	var t Transaction
	var receiptPath, ocrText sql.NullString
	err := a.db.QueryRow(
		`SELECT id, name, amount, category, type, date, description, receipt_path, ocr_status, ocr_text, created_at
		 FROM transactions WHERE id = ?`, id,
	).Scan(&t.ID, &t.Name, &t.Amount, &t.Category, &t.Type, &t.Date, &t.Description, &receiptPath, &t.OCRStatus, &ocrText, &t.CreatedAt)
	if err != nil {
		return t, err
	}
	if receiptPath.Valid {
		t.ReceiptPath = &receiptPath.String
	}
	if ocrText.Valid {
		t.OCRText = &ocrText.String
	}
	return t, nil
}

func (a *api) listRecurring() ([]RecurringItem, error) {
	rows, err := a.db.Query(
		`SELECT id, name, amount, category, type, frequency, start_date, end_date, description, created_at
		 FROM recurring_items ORDER BY start_date DESC, id DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecurringItem
	for rows.Next() {
		var it RecurringItem
		var endDate sql.NullString
		if err := rows.Scan(&it.ID, &it.Name, &it.Amount, &it.Category, &it.Type, &it.Frequency, &it.StartDate, &endDate, &it.Description, &it.CreatedAt); err != nil {
			return nil, err
		}
		if endDate.Valid {
			it.EndDate = &endDate.String
		}
		out = append(out, it)
	}
	return out, nil
}

// combinedOccurrences returns one-off transactions plus materialized recurring
// occurrences within [start, end], sorted by date descending.
func (a *api) combinedOccurrences(start, end time.Time, category string) ([]Occurrence, error) {
	txns, err := a.listTransactionsRange(start, end)
	if err != nil {
		return nil, err
	}
	recs, err := a.listRecurring()
	if err != nil {
		return nil, err
	}

	var out []Occurrence
	for _, t := range txns {
		if category != "" && !strings.EqualFold(t.Category, category) {
			continue
		}
		out = append(out, Occurrence{
			ID:          "t-" + strconv.FormatInt(t.ID, 10),
			SourceID:    t.ID,
			SourceType:  "transaction",
			Name:        t.Name,
			Amount:      t.Amount,
			Category:    t.Category,
			Type:        t.Type,
			Date:        t.Date,
			Description: t.Description,
			ReceiptPath: t.ReceiptPath,
			OCRStatus:   t.OCRStatus,
		})
	}

	for _, rec := range recs {
		if category != "" && !strings.EqualFold(rec.Category, category) {
			continue
		}
		for _, d := range occurrencesInRange(rec, start, end) {
			ds := d.Format(dateLayout)
			out = append(out, Occurrence{
				ID:          "r-" + strconv.FormatInt(rec.ID, 10) + "-" + ds,
				SourceID:    rec.ID,
				SourceType:  "recurring",
				Name:        rec.Name,
				Amount:      rec.Amount,
				Category:    rec.Category,
				Type:        rec.Type,
				Date:        ds,
				Description: rec.Description,
			})
		}
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date > out[j].Date
		}
		return out[i].ID > out[j].ID
	})

	return out, nil
}

func (a *api) listOccurrences(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseDateRange(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid start/end date, expected YYYY-MM-DD")
		return
	}
	category := r.URL.Query().Get("category")
	occ, err := a.combinedOccurrences(start, end, category)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if occ == nil {
		occ = []Occurrence{}
	}
	writeJSON(w, http.StatusOK, occ)
}

func (a *api) createTransaction(w http.ResponseWriter, r *http.Request) {
	var t Transaction
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateEntry(t.Name, t.Amount, t.Category, t.Type, t.Date); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	res, err := a.db.Exec(
		`INSERT INTO transactions (name, amount, category, type, date, description) VALUES (?, ?, ?, ?, ?, ?)`,
		t.Name, t.Amount, t.Category, t.Type, t.Date, t.Description,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	saved, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, saved)
}

func (a *api) updateTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var t Transaction
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateEntry(t.Name, t.Amount, t.Category, t.Type, t.Date); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	_, err = a.db.Exec(
		`UPDATE transactions SET name=?, amount=?, category=?, type=?, date=?, description=? WHERE id=?`,
		t.Name, t.Amount, t.Category, t.Type, t.Date, t.Description, id,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *api) deleteTransaction(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	// Clean up any stored receipt file before dropping the row.
	if t, err := a.getTransaction(id); err == nil && t.ReceiptPath != nil {
		a.removeReceiptFile(*t.ReceiptPath)
	}
	if _, err := a.db.Exec(`DELETE FROM transactions WHERE id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Receipts ----------
//
// Storage today is intentionally simple: an uploaded image is saved under
// receiptsDir and served back at /uploads/<filename>. ocr_status starts at
// "pending" the moment a receipt lands, so a future OCR worker can poll
// `SELECT * FROM transactions WHERE ocr_status = 'pending'`, download the
// file from receipt_path, and report results back via the OCR callback
// endpoint below - no schema or upload-flow changes needed to add that.

var allowedReceiptExt = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".heic": true,
}

const maxReceiptSize = 10 << 20 // 10MB

func (a *api) removeReceiptFile(receiptPath string) {
	filename := filepath.Base(receiptPath)
	_ = os.Remove(filepath.Join(a.receiptsDir, filename))
}

func (a *api) uploadReceipt(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	existing, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "entry not found")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxReceiptSize)
	if err := r.ParseMultipartForm(maxReceiptSize); err != nil {
		writeErr(w, http.StatusBadRequest, "receipt image is too large (max 10MB) or malformed")
		return
	}
	file, header, err := r.FormFile("receipt")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "missing receipt file")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !allowedReceiptExt[ext] {
		writeErr(w, http.StatusBadRequest, "unsupported image type, use JPG, PNG, WEBP, or HEIC")
		return
	}

	// Replace any previous receipt for this entry.
	if existing.ReceiptPath != nil {
		a.removeReceiptFile(*existing.ReceiptPath)
	}

	filename := fmt.Sprintf("txn-%d-%d%s", id, time.Now().UnixNano(), ext)
	dest, err := os.Create(filepath.Join(a.receiptsDir, filename))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save receipt")
		return
	}
	defer dest.Close()
	if _, err := io.Copy(dest, file); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not save receipt")
		return
	}

	receiptPath := "/uploads/" + filename
	if _, err := a.db.Exec(
		`UPDATE transactions SET receipt_path=?, ocr_status='pending', ocr_text=NULL WHERE id=?`,
		receiptPath, id,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	saved, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (a *api) deleteReceipt(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	existing, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "entry not found")
		return
	}
	if existing.ReceiptPath != nil {
		a.removeReceiptFile(*existing.ReceiptPath)
	}
	if _, err := a.db.Exec(
		`UPDATE transactions SET receipt_path=NULL, ocr_status='none', ocr_text=NULL WHERE id=?`, id,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// updateOCRResult is the callback a future OCR worker calls once it has
// processed a pending receipt. Not wired up to any worker yet - this is the
// contract that one would use.
func (a *api) updateOCRResult(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var body struct {
		Status string  `json:"ocr_status"`
		Text   *string `json:"ocr_text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Status != "pending" && body.Status != "done" && body.Status != "failed" && body.Status != "none" {
		writeErr(w, http.StatusBadRequest, "ocr_status must be pending, done, failed, or none")
		return
	}
	if _, err := a.db.Exec(
		`UPDATE transactions SET ocr_status=?, ocr_text=? WHERE id=?`, body.Status, body.Text, id,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	saved, err := a.getTransaction(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

// ---------- Recurring items ----------

func (a *api) listRecurringHandler(w http.ResponseWriter, r *http.Request) {
	items, err := a.listRecurring()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []RecurringItem{}
	}
	writeJSON(w, http.StatusOK, items)
}

func (a *api) createRecurring(w http.ResponseWriter, r *http.Request) {
	var it RecurringItem
	if err := json.NewDecoder(r.Body).Decode(&it); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateEntry(it.Name, it.Amount, it.Category, it.Type, it.StartDate); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if it.Frequency != "weekly" && it.Frequency != "biweekly" && it.Frequency != "monthly" {
		writeErr(w, http.StatusBadRequest, "frequency must be weekly, biweekly, or monthly")
		return
	}
	var endDate interface{}
	if it.EndDate != nil && *it.EndDate != "" {
		endDate = *it.EndDate
	}
	res, err := a.db.Exec(
		`INSERT INTO recurring_items (name, amount, category, type, frequency, start_date, end_date, description)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		it.Name, it.Amount, it.Category, it.Type, it.Frequency, it.StartDate, endDate, it.Description,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	it.ID = id
	writeJSON(w, http.StatusCreated, it)
}

func (a *api) updateRecurring(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	var it RecurringItem
	if err := json.NewDecoder(r.Body).Decode(&it); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := validateEntry(it.Name, it.Amount, it.Category, it.Type, it.StartDate); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if it.Frequency != "weekly" && it.Frequency != "biweekly" && it.Frequency != "monthly" {
		writeErr(w, http.StatusBadRequest, "frequency must be weekly, biweekly, or monthly")
		return
	}
	var endDate interface{}
	if it.EndDate != nil && *it.EndDate != "" {
		endDate = *it.EndDate
	}
	_, err = a.db.Exec(
		`UPDATE recurring_items SET name=?, amount=?, category=?, type=?, frequency=?, start_date=?, end_date=?, description=? WHERE id=?`,
		it.Name, it.Amount, it.Category, it.Type, it.Frequency, it.StartDate, endDate, it.Description, id,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	it.ID = id
	writeJSON(w, http.StatusOK, it)
}

func (a *api) deleteRecurring(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := a.db.Exec(`DELETE FROM recurring_items WHERE id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Categories ----------

func (a *api) listCategories(w http.ResponseWriter, r *http.Request) {
	typeFilter := r.URL.Query().Get("type")
	query := `SELECT id, name, type, created_at FROM categories`
	args := []interface{}{}
	if typeFilter == "income" || typeFilter == "expense" {
		query += ` WHERE type = ?`
		args = append(args, typeFilter)
	}
	query += ` ORDER BY type, name COLLATE NOCASE`

	rows, err := a.db.Query(query, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *api) createCategory(w http.ResponseWriter, r *http.Request) {
	var c Category
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if c.Type != "income" && c.Type != "expense" {
		writeErr(w, http.StatusBadRequest, "type must be income or expense")
		return
	}
	res, err := a.db.Exec(`INSERT INTO categories (name, type) VALUES (?, ?)`, c.Name, c.Type)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeErr(w, http.StatusConflict, "that category already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	c.ID, _ = res.LastInsertId()
	writeJSON(w, http.StatusCreated, c)
}

func (a *api) deleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid id")
		return
	}
	if _, err := a.db.Exec(`DELETE FROM categories WHERE id=?`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Summary ----------

type categoryTotal struct {
	Category string  `json:"category"`
	Type     string  `json:"type"`
	Amount   float64 `json:"amount"`
}

type summaryResponse struct {
	Start        string          `json:"start"`
	End          string          `json:"end"`
	Income       float64         `json:"income"`
	Expense      float64         `json:"expense"`
	Net          float64         `json:"net"`
	ByCategory   []categoryTotal `json:"by_category"`
	Transactions int             `json:"transaction_count"`
}

func (a *api) handleSummary(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseDateRange(r)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid start/end date, expected YYYY-MM-DD")
		return
	}

	occ, err := a.combinedOccurrences(start, end, "")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := summaryResponse{
		Start: start.Format(dateLayout),
		End:   end.Format(dateLayout),
	}

	catTotals := map[string]*categoryTotal{}
	for _, o := range occ {
		if o.Type == "income" {
			resp.Income += o.Amount
		} else {
			resp.Expense += o.Amount
		}
		key := o.Type + "|" + o.Category
		if ct, ok := catTotals[key]; ok {
			ct.Amount += o.Amount
		} else {
			catTotals[key] = &categoryTotal{Category: o.Category, Type: o.Type, Amount: o.Amount}
		}
	}
	resp.Net = resp.Income - resp.Expense
	resp.Transactions = len(occ)

	var cats []categoryTotal
	for _, ct := range catTotals {
		cats = append(cats, *ct)
	}
	sort.Slice(cats, func(i, j int) bool { return cats[i].Amount > cats[j].Amount })
	resp.ByCategory = cats
	if resp.ByCategory == nil {
		resp.ByCategory = []categoryTotal{}
	}

	writeJSON(w, http.StatusOK, resp)
}

// ---------- Validation ----------

func validateEntry(name string, amount float64, category, typ, date string) error {
	if strings.TrimSpace(name) == "" {
		return errBadRequest("name is required")
	}
	if amount <= 0 {
		return errBadRequest("amount must be greater than 0")
	}
	if strings.TrimSpace(category) == "" {
		return errBadRequest("category is required")
	}
	if typ != "income" && typ != "expense" {
		return errBadRequest("type must be income or expense")
	}
	if _, err := time.Parse(dateLayout, date); err != nil {
		return errBadRequest("date must be in YYYY-MM-DD format")
	}
	return nil
}

type errBadRequest string

func (e errBadRequest) Error() string { return string(e) }
