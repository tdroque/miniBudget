package main

import (
	"encoding/binary"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"os"
)

// preprocessForOCR loads a receipt photo and applies a pipeline tuned for
// the specific ways phone photos of receipts go wrong: wrong-side-up JPEGs
// (see readJPEGOrientation below), uneven lighting/shadows, sensor noise,
// and low effective contrast. Writes a PNG to outPath for the OCR provider
// to read instead of the original.
//
// This came from actually measuring the difference on deliberately
// degraded test receipts. Two findings mattered most:
//   - A photo saved the way real phone cameras save it — pixels in
//     landscape, with an EXIF tag saying "rotate 90° for display" — took
//     Tesseract from complete garbage to a clean, fully correct read once
//     that tag was actually honored. Go's standard image decoders ignore
//     EXIF orientation entirely, so without this, sideways text was being
//     fed straight to Tesseract with no correction at all.
//   - Illumination correction (below) is the second-biggest factor:
//     receipts photographed by hand almost always have some shadow or
//     lighting gradient across them, and Tesseract handles that far worse
//     than it handles noise or blur.
func preprocessForOCR(inPath, outPath string) error {
	src, err := loadImage(inPath)
	if err != nil {
		return err
	}
	gray := toGray(src)
	gray = applyOrientationGray(gray, readJPEGOrientation(inPath))
	background := boxBlurGray(gray, 25) // estimate of the lighting itself
	corrected := correctIllumination(gray, background)
	denoised := boxBlurGray(corrected, 1)    // light smoothing, kills sensor speckle
	stretched := autocontrast(denoised, 1.0) // restore full contrast range
	upscaled := upscale(stretched, 2)        // Tesseract does better with more pixels per character
	return savePNG(upscaled, outPath)
}

// readJPEGOrientation looks for the EXIF Orientation tag (0x0112) in a
// JPEG's APP1 segment. Returns 1 ("normal", i.e. no correction needed) if
// the file isn't a JPEG, has no EXIF data, or is malformed in any way —
// deliberately never an error, since "assume no rotation" is always a safe
// fallback and a bad receipt photo shouldn't block OCR entirely over this.
// Stress-tested against truncated files, non-images, and JPEGs with
// deliberately corrupted EXIF segments (garbled byte-order marker,
// out-of-bounds IFD offset, bogus entry count) — all fail closed to
// orientation 1 rather than panicking.
func readJPEGOrientation(path string) int {
	data, err := os.ReadFile(path)
	if err != nil || len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	pos := 2
	for pos+4 <= len(data) {
		if data[pos] != 0xFF {
			break
		}
		marker := data[pos+1]
		if marker == 0xD8 || marker == 0xD9 {
			pos += 2
			continue
		}
		segLen := int(data[pos+2])<<8 | int(data[pos+3])
		if marker == 0xDA { // start of scan — actual image data follows, stop
			break
		}
		if marker == 0xE1 && pos+2+segLen <= len(data) { // APP1 (EXIF)
			if o := parseEXIFOrientation(data[pos+4 : pos+2+segLen]); o != 0 {
				return o
			}
		}
		if segLen < 2 {
			break // malformed segment length — bail out rather than loop forever
		}
		pos += 2 + segLen
	}
	return 1
}

// parseEXIFOrientation reads just enough of a TIFF/EXIF IFD0 to find the
// Orientation tag. Returns 0 (not 1) when not found/malformed, so the
// caller can tell "no tag present" apart from "tag present and says
// normal" — not that it matters for what we do with it, but it's the more
// honest signal.
func parseEXIFOrientation(seg []byte) int {
	if len(seg) < 8 || string(seg[0:4]) != "Exif" {
		return 0
	}
	tiff := seg[6:]
	if len(tiff) < 8 {
		return 0
	}
	var bo binary.ByteOrder
	switch string(tiff[0:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0
	}
	ifdOffset := bo.Uint32(tiff[4:8])
	if int(ifdOffset)+2 > len(tiff) {
		return 0
	}
	numEntries := int(bo.Uint16(tiff[ifdOffset : ifdOffset+2]))
	entriesStart := ifdOffset + 2
	for i := 0; i < numEntries; i++ {
		entryOffset := entriesStart + uint32(i*12)
		if int(entryOffset)+12 > len(tiff) {
			break
		}
		tag := bo.Uint16(tiff[entryOffset : entryOffset+2])
		if tag == 0x0112 {
			valOffset := entryOffset + 8
			if int(valOffset)+2 > len(tiff) {
				return 0
			}
			return int(bo.Uint16(tiff[valOffset : valOffset+2]))
		}
	}
	return 0
}

// applyOrientationGray physically applies what the EXIF tag says should
// happen, covering all 8 standard EXIF orientation values (only 1, 3, 6,
// and 8 — no flip, 180°, 90° CW, 90° CCW — are common from real cameras;
// the flip variants exist mostly for scanners/mirrored sources, but are
// cheap to support correctly while we're here).
func applyOrientationGray(src *image.Gray, orientation int) *image.Gray {
	switch orientation {
	case 2:
		return flipGrayH(src)
	case 3:
		return rotateGray180(src)
	case 4:
		return flipGrayV(src)
	case 5:
		return rotateGray90CW(flipGrayH(src))
	case 6:
		return rotateGray90CW(src)
	case 7:
		return rotateGray90CCW(flipGrayH(src))
	case 8:
		return rotateGray90CCW(src)
	default:
		return src
	}
}

func rotateGray90CW(src *image.Gray) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewGray(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetGray(h-1-y, x, src.GrayAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func rotateGray90CCW(src *image.Gray) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewGray(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetGray(y, w-1-x, src.GrayAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func rotateGray180(src *image.Gray) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetGray(w-1-x, h-1-y, src.GrayAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func flipGrayH(src *image.Gray) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetGray(w-1-x, y, src.GrayAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func flipGrayV(src *image.Gray) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	dst := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dst.SetGray(x, h-1-y, src.GrayAt(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

func loadImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

func savePNG(img image.Image, path string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, img)
}

func toGray(src image.Image) *image.Gray {
	b := src.Bounds()
	dst := image.NewGray(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			dst.Set(x, y, color.GrayModel.Convert(src.At(x, y)))
		}
	}
	return dst
}

// boxBlurGray approximates a Gaussian blur with four box-blur passes
// (horizontal+vertical, twice) — much cheaper than a true Gaussian kernel
// and visually very close for this purpose (estimating a smooth background).
func boxBlurGray(src *image.Gray, radius int) *image.Gray {
	if radius < 1 {
		return src
	}
	tmp := boxBlurPass(src, radius, true)
	tmp = boxBlurPass(tmp, radius, false)
	tmp = boxBlurPass(tmp, radius, true)
	tmp = boxBlurPass(tmp, radius, false)
	return tmp
}

// boxBlurPass runs a sliding-window average along one axis in O(n) per
// row/column (add the incoming edge, drop the outgoing edge) rather than
// recomputing the window sum from scratch at every pixel.
func boxBlurPass(src *image.Gray, radius int, horizontal bool) *image.Gray {
	b := src.Bounds()
	dst := image.NewGray(b)
	w, h := b.Dx(), b.Dy()

	if horizontal {
		for y := 0; y < h; y++ {
			var sum, count int
			for k := -radius; k <= radius; k++ {
				xx := clampInt(k, 0, w-1)
				sum += int(src.GrayAt(b.Min.X+xx, b.Min.Y+y).Y)
				count++
			}
			for x := 0; x < w; x++ {
				dst.SetGray(b.Min.X+x, b.Min.Y+y, color.Gray{Y: uint8(sum / count)})
				outX := clampInt(x-radius, 0, w-1)
				inX := clampInt(x+radius+1, 0, w-1)
				sum -= int(src.GrayAt(b.Min.X+outX, b.Min.Y+y).Y)
				sum += int(src.GrayAt(b.Min.X+inX, b.Min.Y+y).Y)
			}
		}
	} else {
		for x := 0; x < w; x++ {
			var sum, count int
			for k := -radius; k <= radius; k++ {
				yy := clampInt(k, 0, h-1)
				sum += int(src.GrayAt(b.Min.X+x, b.Min.Y+yy).Y)
				count++
			}
			for y := 0; y < h; y++ {
				dst.SetGray(b.Min.X+x, b.Min.Y+y, color.Gray{Y: uint8(sum / count)})
				outY := clampInt(y-radius, 0, h-1)
				inY := clampInt(y+radius+1, 0, h-1)
				sum -= int(src.GrayAt(b.Min.X+x, b.Min.Y+outY).Y)
				sum += int(src.GrayAt(b.Min.X+x, b.Min.Y+inY).Y)
			}
		}
	}
	return dst
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// correctIllumination divides the image by a heavily-blurred estimate of
// its own lighting, cancelling out shadows and gradients — the step that
// matters most for hand-photographed receipts.
func correctIllumination(gray, background *image.Gray) *image.Gray {
	b := gray.Bounds()
	dst := image.NewGray(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			g := float64(gray.GrayAt(x, y).Y)
			bg := float64(background.GrayAt(x, y).Y)
			if bg < 1 {
				bg = 1
			}
			v := g / bg * 255
			dst.SetGray(x, y, color.Gray{Y: uint8(clampFloat(v, 0, 255))})
		}
	}
	return dst
}

// autocontrast stretches the histogram so the darkest/lightest clipPercent
// of pixels become pure black/white — restores full contrast after
// illumination correction compresses the range toward mid-gray.
func autocontrast(src *image.Gray, clipPercent float64) *image.Gray {
	b := src.Bounds()
	var hist [256]int
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			hist[src.GrayAt(x, y).Y]++
		}
	}
	total := b.Dx() * b.Dy()
	clip := int(float64(total) * clipPercent / 100)

	lo, hi := 0, 255
	sum := 0
	for i := 0; i < 256; i++ {
		sum += hist[i]
		if sum > clip {
			lo = i
			break
		}
	}
	sum = 0
	for i := 255; i >= 0; i-- {
		sum += hist[i]
		if sum > clip {
			hi = i
			break
		}
	}
	if hi <= lo {
		return src
	}

	dst := image.NewGray(b)
	scale := 255.0 / float64(hi-lo)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			v := (float64(src.GrayAt(x, y).Y) - float64(lo)) * scale
			dst.SetGray(x, y, color.Gray{Y: uint8(clampFloat(v, 0, 255))})
		}
	}
	return dst
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// upscale resizes by an integer factor with bilinear interpolation — more
// pixels per character measurably helps Tesseract on modest-resolution
// source photos.
func upscale(src *image.Gray, factor int) *image.Gray {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	nw, nh := w*factor, h*factor
	dst := image.NewGray(image.Rect(0, 0, nw, nh))
	for y := 0; y < nh; y++ {
		sy := float64(y) / float64(factor)
		y0 := int(sy)
		y1 := clampInt(y0+1, 0, h-1)
		fy := sy - float64(y0)
		for x := 0; x < nw; x++ {
			sx := float64(x) / float64(factor)
			x0 := int(sx)
			x1 := clampInt(x0+1, 0, w-1)
			fx := sx - float64(x0)

			p00 := float64(src.GrayAt(b.Min.X+x0, b.Min.Y+y0).Y)
			p10 := float64(src.GrayAt(b.Min.X+x1, b.Min.Y+y0).Y)
			p01 := float64(src.GrayAt(b.Min.X+x0, b.Min.Y+y1).Y)
			p11 := float64(src.GrayAt(b.Min.X+x1, b.Min.Y+y1).Y)

			top := p00*(1-fx) + p10*fx
			bot := p01*(1-fx) + p11*fx
			v := top*(1-fy) + bot*fy
			dst.SetGray(x, y, color.Gray{Y: uint8(clampFloat(v, 0, 255))})
		}
	}
	return dst
}
