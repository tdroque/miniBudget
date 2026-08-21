package main

import "time"

const dateLayout = "2006-01-02"

// Transaction is a single, one-off income or expense entry.
type Transaction struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Category    string  `json:"category"`
	Type        string  `json:"type"` // "income" | "expense"
	Date        string  `json:"date"` // YYYY-MM-DD
	Description string  `json:"description"`
	ReceiptPath *string `json:"receipt_path,omitempty"`
	OCRStatus   string  `json:"ocr_status"` // "none" | "pending" | "done" | "failed"
	OCRText     *string `json:"ocr_text,omitempty"`
	CreatedAt   string  `json:"created_at"`
}

// Category is a user-managed label available when logging income or
// expenses. Deleting a category does not touch past entries that already
// used it - it only removes it from the picker going forward.
type Category struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"` // "income" | "expense"
	CreatedAt string `json:"created_at,omitempty"`
}

// RecurringItem is a template for a repeating income/expense (paycheque, rent, etc).
type RecurringItem struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Category    string  `json:"category"`
	Type        string  `json:"type"`      // "income" | "expense"
	Frequency   string  `json:"frequency"` // "weekly" | "biweekly" | "monthly"
	StartDate   string  `json:"start_date"`
	EndDate     *string `json:"end_date"`
	Description string  `json:"description"`
	CreatedAt   string  `json:"created_at"`
}

// Occurrence is a materialized entry shown to the client, whether it came
// from a one-off transaction row or was generated from a recurring item.
type Occurrence struct {
	ID          string  `json:"id"` // "t-<id>" for transactions, "r-<id>-<date>" for recurring
	SourceID    int64   `json:"source_id"`
	SourceType  string  `json:"source_type"` // "transaction" | "recurring"
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Category    string  `json:"category"`
	Type        string  `json:"type"`
	Date        string  `json:"date"`
	Description string  `json:"description"`
	ReceiptPath *string `json:"receipt_path,omitempty"`
	OCRStatus   string  `json:"ocr_status,omitempty"`
}

// occurrencesInRange expands a recurring item into concrete calendar dates
// that fall within [start, end], inclusive.
func occurrencesInRange(item RecurringItem, start, end time.Time) []time.Time {
	var out []time.Time

	itemStart, err := time.Parse(dateLayout, item.StartDate)
	if err != nil {
		return out
	}

	var itemEnd *time.Time
	if item.EndDate != nil && *item.EndDate != "" {
		if t, err := time.Parse(dateLayout, *item.EndDate); err == nil {
			itemEnd = &t
		}
	}

	cursor := itemStart

	switch item.Frequency {
	case "weekly":
		for !cursor.After(end) {
			if !cursor.Before(start) && withinItemBounds(cursor, itemEnd) {
				out = append(out, cursor)
			}
			if itemEnd != nil && cursor.After(*itemEnd) {
				break
			}
			cursor = cursor.AddDate(0, 0, 7)
		}
	case "biweekly":
		for !cursor.After(end) {
			if !cursor.Before(start) && withinItemBounds(cursor, itemEnd) {
				out = append(out, cursor)
			}
			if itemEnd != nil && cursor.After(*itemEnd) {
				break
			}
			cursor = cursor.AddDate(0, 0, 14)
		}
	case "monthly":
		day := itemStart.Day()
		// Walk month by month from the item's start month, clamping the day
		// to the last day of shorter months (e.g. day 31 in February -> 28/29).
		monthCursor := time.Date(itemStart.Year(), itemStart.Month(), 1, 0, 0, 0, 0, time.UTC)
		for {
			occDate := clampedDate(monthCursor.Year(), monthCursor.Month(), day)
			if occDate.After(end) {
				break
			}
			if !occDate.Before(itemStart) && !occDate.Before(start) && withinItemBounds(occDate, itemEnd) {
				out = append(out, occDate)
			}
			monthCursor = monthCursor.AddDate(0, 1, 0)
			if itemEnd != nil && monthCursor.After(*itemEnd) && clampedDate(monthCursor.Year(), monthCursor.Month(), day).After(*itemEnd) {
				break
			}
			// safety valve against runaway loops
			if monthCursor.Year() > end.Year()+1 {
				break
			}
		}
	}

	return out
}

func withinItemBounds(d time.Time, itemEnd *time.Time) bool {
	if itemEnd == nil {
		return true
	}
	return !d.After(*itemEnd)
}

func clampedDate(year int, month time.Month, day int) time.Time {
	firstOfNext := time.Date(year, month+1, 1, 0, 0, 0, 0, time.UTC)
	lastOfMonth := firstOfNext.AddDate(0, 0, -1).Day()
	if day > lastOfMonth {
		day = lastOfMonth
	}
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}
