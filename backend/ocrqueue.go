package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
)

// ocrJob is one receipt waiting to be processed. receiptPath is captured at
// enqueue time so the worker can detect a stale job (see
// setOCRResultIfCurrent in handlers.go) if the receipt gets replaced or
// deleted while the job is sitting in the queue or mid-processing.
type ocrJob struct {
	transactionID int64
	receiptPath   string
}

// ocrQueue is a small in-process worker pool. Receipts are processed one at
// a time per worker, in the background, so uploading a photo never blocks
// on OCR — the HTTP response for the upload returns immediately with
// ocr_status "pending", and this queue is what eventually flips it to
// "done" or "failed".
type ocrQueue struct {
	jobs     chan ocrJob
	provider OCRProvider
	a        *api
}

// newOCRQueue starts `workers` background goroutines pulling from a
// buffered channel. The buffer (not the worker count) is what determines
// how many uploads can be "waiting" before enqueue starts shedding load;
// sized generously since a single job is cheap to hold (two ints).
func newOCRQueue(provider OCRProvider, workers int, a *api) *ocrQueue {
	if workers < 1 {
		workers = 1
	}
	q := &ocrQueue{
		jobs:     make(chan ocrJob, 200),
		provider: provider,
		a:        a,
	}
	for i := 0; i < workers; i++ {
		go q.worker()
	}
	return q
}

// enqueue never blocks the caller (the upload HTTP handler). If the queue
// is somehow completely full — 200 receipts already waiting, which would
// mean something is very wrong — the job is marked failed immediately
// rather than silently dropped, so it doesn't sit at "pending" forever
// with no explanation.
func (q *ocrQueue) enqueue(job ocrJob) {
	select {
	case q.jobs <- job:
	default:
		log.Printf("ocr: queue full, dropping job for transaction %d", job.transactionID)
		reason := "OCR queue was full — try re-uploading the receipt"
		q.a.setOCRResultIfCurrent(job.transactionID, job.receiptPath, "failed", &reason)
	}
}

func (q *ocrQueue) worker() {
	for job := range q.jobs {
		q.process(job)
	}
}

func (q *ocrQueue) process(job ocrJob) {
	fullPath, err := q.a.resolveReceiptFile(job.receiptPath)
	if err != nil {
		reason := err.Error()
		q.a.setOCRResultIfCurrent(job.transactionID, job.receiptPath, "failed", &reason)
		return
	}

	result, err := q.provider.Extract(context.Background(), fullPath)
	if err != nil {
		log.Printf("ocr: transaction %d failed: %v", job.transactionID, err)
		reason := err.Error()
		q.a.setOCRResultIfCurrent(job.transactionID, job.receiptPath, "failed", &reason)
		return
	}

	q.a.setOCRResultIfCurrent(job.transactionID, job.receiptPath, "done", &result.RawText)
}

// resolveReceiptFile turns a stored receipt_path ("/uploads/xyz.jpg") into
// an absolute path on disk and confirms the file is actually there before
// handing it to the OCR provider.
func (a *api) resolveReceiptFile(receiptPath string) (string, error) {
	filename := filepath.Base(receiptPath)
	full := filepath.Join(a.receiptsDir, filename)
	if _, err := os.Stat(full); err != nil {
		return "", err
	}
	return full, nil
}

// requeuePendingReceipts re-enqueues any receipt still stuck at "pending"
// from a previous run — e.g. the server restarted (deploy, crash) while a
// job was queued or mid-processing. Without this, that receipt would sit at
// "pending" forever with nothing left to ever pick it up, since the queue
// itself is purely in-memory and doesn't survive a restart.
func (a *api) requeuePendingReceipts() {
	if a.ocrQueue == nil {
		return
	}
	rows, err := a.db.Query(`SELECT id, receipt_path FROM transactions WHERE ocr_status = 'pending' AND receipt_path IS NOT NULL`)
	if err != nil {
		log.Printf("ocr: failed to check for pending receipts on startup: %v", err)
		return
	}
	defer rows.Close()

	var count int
	for rows.Next() {
		var id int64
		var receiptPath string
		if err := rows.Scan(&id, &receiptPath); err != nil {
			continue
		}
		a.ocrQueue.enqueue(ocrJob{transactionID: id, receiptPath: receiptPath})
		count++
	}
	if count > 0 {
		log.Printf("ocr: re-queued %d receipt(s) left pending from a previous run", count)
	}
}
