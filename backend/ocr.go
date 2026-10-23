package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// OCRResult is what a provider extracts from a receipt image. Phase 1 only
// captures raw text; pulling out structured fields (merchant/amount/date)
// is a natural follow-up once this plumbing exists, and providers that can
// do that directly (cloud vision APIs, multimodal LLMs) can add them to
// this struct without changing how the queue or the DB write-back works.
type OCRResult struct {
	RawText string
}

// OCRProvider is the seam between "a receipt got uploaded" and "something
// reads text out of it." Swapping providers — a cloud vision API, a
// multimodal LLM, a specialized receipt-parsing service — means writing a
// new implementation of this interface, nothing else in the app changes.
type OCRProvider interface {
	Extract(ctx context.Context, imagePath string) (OCRResult, error)
}

// newOCRProvider builds whichever provider OCR_PROVIDER selects. A nil
// provider with a nil error means OCR is intentionally turned off
// (OCR_PROVIDER=none or unset-and-defaulted-to-none) — callers should treat
// that as "don't enqueue jobs," not as a startup failure.
func newOCRProvider(name string) (OCRProvider, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "none":
		return nil, nil
	case "tesseract":
		return newTesseractProvider()
	default:
		return nil, fmt.Errorf("unknown OCR_PROVIDER %q (supported: tesseract, none)", name)
	}
}

// ---------- Tesseract: the default, free, fully self-hosted provider ----------

type tesseractProvider struct {
	binPath string
	lang    string
	psm     string
	timeout time.Duration
}

func newTesseractProvider() (*tesseractProvider, error) {
	bin, err := exec.LookPath("tesseract")
	if err != nil {
		return nil, fmt.Errorf("tesseract binary not found in PATH (install tesseract-ocr, or set OCR_PROVIDER=none): %w", err)
	}
	lang := envOr("OCR_LANG", "eng")
	// PSM 6 ("assume a single uniform block of text") fits receipts much
	// better than Tesseract's default automatic page-segmentation mode,
	// which is tuned for general documents/photos and can get confused by
	// a narrow, noisy column of text into finding nothing at all.
	psm := envOr("OCR_PSM", "6")
	return &tesseractProvider{binPath: bin, lang: lang, psm: psm, timeout: 30 * time.Second}, nil
}

func (p *tesseractProvider) Extract(ctx context.Context, imagePath string) (OCRResult, error) {
	// Preprocessing (illumination correction, denoise, contrast stretch,
	// upscale — see ocr_preprocess.go) makes a dramatic difference on real
	// phone photos of receipts. If it fails for some reason, fall back to
	// running Tesseract on the original rather than failing the whole job
	// over a preprocessing bug.
	target := imagePath
	tmpFile, err := os.CreateTemp("", "ocr-pre-*.png")
	if err == nil {
		tmpPath := tmpFile.Name()
		tmpFile.Close()
		defer os.Remove(tmpPath)
		if err := preprocessForOCR(imagePath, tmpPath); err == nil {
			target = tmpPath
		}
	}

	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, p.binPath, target, "stdout", "-l", p.lang, "--psm", p.psm)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return OCRResult{}, errors.New("tesseract timed out")
	}
	if err != nil {
		// tesseract writes its actual error (bad image, unreadable file,
		// etc.) to stderr, not to the Go error itself, which is just
		// "exit status 1" on its own.
		return OCRResult{}, fmt.Errorf("tesseract failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	return OCRResult{RawText: strings.TrimSpace(stdout.String())}, nil
}
