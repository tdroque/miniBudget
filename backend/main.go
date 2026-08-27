package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/data/spend.db"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	receiptsDir := os.Getenv("RECEIPTS_DIR")
	if receiptsDir == "" {
		receiptsDir = "/data/receipts"
	}
	if err := os.MkdirAll(receiptsDir, 0o755); err != nil {
		log.Fatalf("failed to create receipts directory: %v", err)
	}

	db := openDB(dbPath)
	defer db.Close()

	a := &api{db: db, receiptsDir: receiptsDir}

	// OCR is best-effort and never fatal to start up: if the provider can't
	// be created (e.g. OCR_PROVIDER=tesseract but the binary isn't
	// installed), receipts just stay at ocr_status "pending" forever, which
	// is the same behavior as before this feature existed at all.
	ocrProviderName := envOr("OCR_PROVIDER", "tesseract")
	ocrProvider, err := newOCRProvider(ocrProviderName)
	if err != nil {
		log.Printf("ocr: %v — OCR is disabled", err)
	} else if ocrProvider == nil {
		log.Printf("ocr: disabled (OCR_PROVIDER=%s)", ocrProviderName)
	} else {
		workers := 2
		if v := os.Getenv("OCR_MAX_CONCURRENT"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				workers = n
			}
		}
		a.ocrQueue = newOCRQueue(ocrProvider, workers, a)
		log.Printf("ocr: enabled (provider=%s, workers=%d)", ocrProviderName, workers)
		a.requeuePendingReceipts()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// Transactions (one-off entries)
	mux.HandleFunc("GET /api/transactions", a.listOccurrences)
	mux.HandleFunc("POST /api/transactions", a.createTransaction)
	mux.HandleFunc("PUT /api/transactions/{id}", a.updateTransaction)
	mux.HandleFunc("DELETE /api/transactions/{id}", a.deleteTransaction)

	// Receipts + OCR extension point
	mux.HandleFunc("POST /api/transactions/{id}/receipt", a.uploadReceipt)
	mux.HandleFunc("DELETE /api/transactions/{id}/receipt", a.deleteReceipt)
	mux.HandleFunc("PUT /api/transactions/{id}/ocr", a.updateOCRResult)

	// Recurring templates
	mux.HandleFunc("GET /api/recurring", a.listRecurringHandler)
	mux.HandleFunc("POST /api/recurring", a.createRecurring)
	mux.HandleFunc("PUT /api/recurring/{id}", a.updateRecurring)
	mux.HandleFunc("DELETE /api/recurring/{id}", a.deleteRecurring)

	// Categories
	mux.HandleFunc("GET /api/categories", a.listCategories)
	mux.HandleFunc("POST /api/categories", a.createCategory)
	mux.HandleFunc("DELETE /api/categories/{id}", a.deleteCategory)

	// Summary
	mux.HandleFunc("GET /api/summary", a.handleSummary)

	// Offline bootstrap snapshot
	mux.HandleFunc("GET /api/sync", a.handleSync)

	// Uploaded receipt images
	fileServer := http.FileServer(http.Dir(receiptsDir))
	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", fileServer))

	log.Printf("spend-tracker backend listening on :%s (db: %s, receipts: %s)", port, dbPath, receiptsDir)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}
