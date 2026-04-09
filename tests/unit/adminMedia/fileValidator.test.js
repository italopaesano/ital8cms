/**
 * Unit tests for adminMedia/lib/fileValidator.js
 *
 * Covers:
 *   - ALLOWED export structure
 *   - getCategoryByExt(): known extensions, unknown extensions
 *   - validate(): extension rejection, size limits per category, magic bytes
 *     acceptance/rejection for each supported format
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { validate, getCategoryByExt, ALLOWED } = require('../../../plugins/adminMedia/lib/fileValidator');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'admedia-val-'));
}

/**
 * Creates a temp file with the given bytes at the start, padded to `totalSize`.
 */
function makeTmpFile(dir, filename, magicBytes, totalSize = magicBytes.length) {
  const buf = Buffer.alloc(totalSize, 0);
  Buffer.from(magicBytes).copy(buf);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

// ── Standard size limits (mirrors pluginConfig.json5) ─────────────────────────
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,   // 10 MB
  video: 500 * 1024 * 1024,  // 500 MB
  audio: 50 * 1024 * 1024,   // 50 MB
};

// ── Magic byte sequences ──────────────────────────────────────────────────────
const MAGIC = {
  jpeg:  [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01],
  png:   [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52],
  gif:   [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xFF, 0xFF, 0xFF],
  webp:  [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20],
  bmp:   [0x42, 0x4D, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x28, 0x00],
  avif:  [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00],
  mp4:   [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00],
  mov:   [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x00, 0x00],
  webm:  [0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81, 0x01, 0x42, 0xF2, 0x81],
  mp3:   [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  mp3ff: [0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  wav:   [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6D, 0x74, 0x20],
  ogg:   [0x4F, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  flac:  [0x66, 0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x10, 0x00, 0x10, 0x00, 0x00, 0x00, 0x0A, 0x00],
  aac:   [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00],
  // garbage bytes for spoofing tests
  garbage: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F],
};

// ══ ALLOWED export ════════════════════════════════════════════════════════════

describe('ALLOWED export', () => {
  test('has image, video, audio categories', () => {
    expect(ALLOWED).toHaveProperty('image');
    expect(ALLOWED).toHaveProperty('video');
    expect(ALLOWED).toHaveProperty('audio');
  });

  test('image category contains expected extensions', () => {
    expect(ALLOWED.image).toEqual(expect.arrayContaining(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp']));
  });

  test('video category contains expected extensions', () => {
    expect(ALLOWED.video).toEqual(expect.arrayContaining(['mp4', 'webm', 'mov']));
  });

  test('audio category contains expected extensions', () => {
    expect(ALLOWED.audio).toEqual(expect.arrayContaining(['mp3', 'wav', 'ogg', 'aac', 'flac']));
  });

  test('SVG is not in any category', () => {
    const allExts = [...ALLOWED.image, ...ALLOWED.video, ...ALLOWED.audio];
    expect(allExts).not.toContain('svg');
  });

  test('PDF is not in any category', () => {
    const allExts = [...ALLOWED.image, ...ALLOWED.video, ...ALLOWED.audio];
    expect(allExts).not.toContain('pdf');
  });
});

// ══ getCategoryByExt() ════════════════════════════════════════════════════════

describe('getCategoryByExt()', () => {
  describe('image extensions', () => {
    test.each(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'])('%s → "image"', (ext) => {
      expect(getCategoryByExt(ext)).toBe('image');
    });
  });

  describe('video extensions', () => {
    test.each(['mp4', 'webm', 'mov'])('%s → "video"', (ext) => {
      expect(getCategoryByExt(ext)).toBe('video');
    });
  });

  describe('audio extensions', () => {
    test.each(['mp3', 'wav', 'ogg', 'aac', 'flac'])('%s → "audio"', (ext) => {
      expect(getCategoryByExt(ext)).toBe('audio');
    });
  });

  describe('disallowed extensions', () => {
    test.each(['svg', 'pdf', 'exe', 'php', 'js', 'html', 'zip', 'tar', 'sh'])('%s → null', (ext) => {
      expect(getCategoryByExt(ext)).toBeNull();
    });
  });

  test('empty string returns null', () => {
    expect(getCategoryByExt('')).toBeNull();
  });
});

// ══ validate() ════════════════════════════════════════════════════════════════

describe('validate()', () => {

  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // ── Extension rejection ───────────────────────────────────────────────────

  describe('extension validation', () => {
    test('rejects SVG files', () => {
      const f = makeTmpFile(dir, 'icon.svg', MAGIC.garbage);
      const r = validate(f, 'icon.svg', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/svg/i);
    });

    test('rejects PDF files', () => {
      const f = makeTmpFile(dir, 'doc.pdf', MAGIC.garbage);
      const r = validate(f, 'doc.pdf', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/pdf/i);
    });

    test('rejects PHP files', () => {
      const f = makeTmpFile(dir, 'shell.php', MAGIC.garbage);
      const r = validate(f, 'shell.php', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
    });

    test('rejects EXE files', () => {
      const f = makeTmpFile(dir, 'virus.exe', MAGIC.garbage);
      const r = validate(f, 'virus.exe', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
    });

    test('rejects files with no extension', () => {
      const f = makeTmpFile(dir, 'noext', MAGIC.jpeg);
      const r = validate(f, 'noext', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
    });

    test('returns valid: false when extension unknown', () => {
      const f = makeTmpFile(dir, 'file.xyz', MAGIC.garbage);
      const r = validate(f, 'file.xyz', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
    });
  });

  // ── Size limit validation ─────────────────────────────────────────────────

  describe('size limit validation', () => {
    test('rejects image over 10 MB limit', () => {
      const overLimit = SIZE_LIMITS.image + 1;
      const f = makeTmpFile(dir, 'big.jpg', MAGIC.jpeg, 16);
      const r = validate(f, 'big.jpg', overLimit, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/too large/i);
      expect(r.error).toMatch(/image/i);
    });

    test('accepts image exactly at 10 MB limit', () => {
      const atLimit = SIZE_LIMITS.image;
      const f = makeTmpFile(dir, 'ok.jpg', MAGIC.jpeg, 16);
      const r = validate(f, 'ok.jpg', atLimit, SIZE_LIMITS);
      expect(r.valid).toBe(true);
    });

    test('rejects video over 500 MB limit', () => {
      const overLimit = SIZE_LIMITS.video + 1;
      const f = makeTmpFile(dir, 'big.mp4', MAGIC.mp4, 16);
      const r = validate(f, 'big.mp4', overLimit, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/too large/i);
      expect(r.error).toMatch(/video/i);
    });

    test('accepts video exactly at 500 MB limit', () => {
      const atLimit = SIZE_LIMITS.video;
      const f = makeTmpFile(dir, 'ok.mp4', MAGIC.mp4, 16);
      const r = validate(f, 'ok.mp4', atLimit, SIZE_LIMITS);
      expect(r.valid).toBe(true);
    });

    test('rejects audio over 50 MB limit', () => {
      const overLimit = SIZE_LIMITS.audio + 1;
      const f = makeTmpFile(dir, 'big.mp3', MAGIC.mp3, 16);
      const r = validate(f, 'big.mp3', overLimit, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/too large/i);
      expect(r.error).toMatch(/audio/i);
    });

    test('accepts audio exactly at 50 MB limit', () => {
      const atLimit = SIZE_LIMITS.audio;
      const f = makeTmpFile(dir, 'ok.mp3', MAGIC.mp3, 16);
      const r = validate(f, 'ok.mp3', atLimit, SIZE_LIMITS);
      expect(r.valid).toBe(true);
    });

    test('size error message includes file size in MB', () => {
      const overLimit = SIZE_LIMITS.image + 1;
      const f = makeTmpFile(dir, 'big.jpg', MAGIC.jpeg, 16);
      const r = validate(f, 'big.jpg', overLimit, SIZE_LIMITS);
      expect(r.error).toMatch(/MB/);
    });
  });

  // ── Magic bytes: acceptance ───────────────────────────────────────────────

  describe('magic bytes acceptance — images', () => {
    test('accepts valid JPEG (FF D8 FF)', () => {
      const f = makeTmpFile(dir, 'photo.jpg', MAGIC.jpeg, 16);
      expect(validate(f, 'photo.jpg', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid JPEG with .jpeg extension', () => {
      const f = makeTmpFile(dir, 'photo.jpeg', MAGIC.jpeg, 16);
      expect(validate(f, 'photo.jpeg', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid PNG (89 50 4E 47)', () => {
      const f = makeTmpFile(dir, 'image.png', MAGIC.png, 16);
      expect(validate(f, 'image.png', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid GIF (47 49 46 38)', () => {
      const f = makeTmpFile(dir, 'anim.gif', MAGIC.gif, 16);
      expect(validate(f, 'anim.gif', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid WebP (RIFF....WEBP)', () => {
      const f = makeTmpFile(dir, 'image.webp', MAGIC.webp, 16);
      expect(validate(f, 'image.webp', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid BMP (BM)', () => {
      const f = makeTmpFile(dir, 'image.bmp', MAGIC.bmp, 16);
      expect(validate(f, 'image.bmp', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });

    test('accepts valid AVIF (ftyp at offset 4)', () => {
      const f = makeTmpFile(dir, 'image.avif', MAGIC.avif, 16);
      expect(validate(f, 'image.avif', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'image' });
    });
  });

  describe('magic bytes acceptance — video', () => {
    test('accepts valid MP4 (ftyp at offset 4)', () => {
      const f = makeTmpFile(dir, 'video.mp4', MAGIC.mp4, 16);
      expect(validate(f, 'video.mp4', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'video' });
    });

    test('accepts valid MOV (ftyp at offset 4)', () => {
      const f = makeTmpFile(dir, 'clip.mov', MAGIC.mov, 16);
      expect(validate(f, 'clip.mov', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'video' });
    });

    test('accepts valid WebM (1A 45 DF A3)', () => {
      const f = makeTmpFile(dir, 'video.webm', MAGIC.webm, 16);
      expect(validate(f, 'video.webm', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'video' });
    });
  });

  describe('magic bytes acceptance — audio', () => {
    test('accepts valid MP3 with ID3 header (49 44 33)', () => {
      const f = makeTmpFile(dir, 'track.mp3', MAGIC.mp3, 16);
      expect(validate(f, 'track.mp3', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });

    test('accepts valid MP3 with frame sync (FF FB)', () => {
      const f = makeTmpFile(dir, 'track.mp3', MAGIC.mp3ff, 16);
      expect(validate(f, 'track.mp3', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });

    test('accepts valid WAV (RIFF....WAVE)', () => {
      const f = makeTmpFile(dir, 'sound.wav', MAGIC.wav, 16);
      expect(validate(f, 'sound.wav', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });

    test('accepts valid OGG (OggS)', () => {
      const f = makeTmpFile(dir, 'audio.ogg', MAGIC.ogg, 16);
      expect(validate(f, 'audio.ogg', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });

    test('accepts valid FLAC (fLaC)', () => {
      const f = makeTmpFile(dir, 'track.flac', MAGIC.flac, 16);
      expect(validate(f, 'track.flac', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });

    test('accepts valid AAC (ftyp at offset 4)', () => {
      const f = makeTmpFile(dir, 'track.aac', MAGIC.aac, 16);
      expect(validate(f, 'track.aac', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });
  });

  // ── Magic bytes: rejection (spoofing) ────────────────────────────────────

  describe('magic bytes rejection — spoofing attempts', () => {
    test('rejects file named .jpg but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.jpg', MAGIC.garbage, 16);
      const r = validate(f, 'fake.jpg', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/spoof|content|match/i);
    });

    test('rejects file named .png but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.png', MAGIC.garbage, 16);
      expect(validate(f, 'fake.png', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .gif but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.gif', MAGIC.garbage, 16);
      expect(validate(f, 'fake.gif', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .webp but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.webp', MAGIC.garbage, 16);
      expect(validate(f, 'fake.webp', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .bmp but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.bmp', MAGIC.garbage, 16);
      expect(validate(f, 'fake.bmp', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .mp4 but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.mp4', MAGIC.garbage, 16);
      expect(validate(f, 'fake.mp4', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .webm but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.webm', MAGIC.garbage, 16);
      expect(validate(f, 'fake.webm', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .mp3 but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.mp3', MAGIC.garbage, 16);
      expect(validate(f, 'fake.mp3', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .wav but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.wav', MAGIC.garbage, 16);
      expect(validate(f, 'fake.wav', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .ogg but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.ogg', MAGIC.garbage, 16);
      expect(validate(f, 'fake.ogg', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects file named .flac but with garbage magic bytes', () => {
      const f = makeTmpFile(dir, 'fake.flac', MAGIC.garbage, 16);
      expect(validate(f, 'fake.flac', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects JPEG bytes disguised as .png', () => {
      // JPEG magic bytes in a file claiming to be PNG
      const f = makeTmpFile(dir, 'fake.png', MAGIC.jpeg, 16);
      expect(validate(f, 'fake.png', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects PNG bytes disguised as .mp3', () => {
      const f = makeTmpFile(dir, 'fake.mp3', MAGIC.png, 16);
      expect(validate(f, 'fake.mp3', 100, SIZE_LIMITS).valid).toBe(false);
    });

    test('rejects MP4 bytes disguised as .jpg', () => {
      // MP4 has ftyp at offset 4; JPEG needs FF D8 FF at offset 0 → incompatible
      const f = makeTmpFile(dir, 'fake.jpg', MAGIC.mp4, 16);
      expect(validate(f, 'fake.jpg', 100, SIZE_LIMITS).valid).toBe(false);
    });
  });

  // ── Return value structure ─────────────────────────────────────────────────

  describe('return value structure', () => {
    test('valid result has { valid: true, category }', () => {
      const f = makeTmpFile(dir, 'photo.jpg', MAGIC.jpeg, 16);
      const r = validate(f, 'photo.jpg', 100, SIZE_LIMITS);
      expect(r).toHaveProperty('valid', true);
      expect(r).toHaveProperty('category', 'image');
      expect(r).not.toHaveProperty('error');
    });

    test('invalid result has { valid: false, error }', () => {
      const f = makeTmpFile(dir, 'file.svg', MAGIC.garbage);
      const r = validate(f, 'file.svg', 100, SIZE_LIMITS);
      expect(r).toHaveProperty('valid', false);
      expect(r).toHaveProperty('error');
      expect(typeof r.error).toBe('string');
      expect(r.error.length).toBeGreaterThan(0);
    });

    test('invalid result does not have category', () => {
      const f = makeTmpFile(dir, 'file.exe', MAGIC.garbage);
      const r = validate(f, 'file.exe', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.category).toBeUndefined();
    });

    test('video file returns category: "video"', () => {
      const f = makeTmpFile(dir, 'clip.mp4', MAGIC.mp4, 16);
      expect(validate(f, 'clip.mp4', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'video' });
    });

    test('audio file returns category: "audio"', () => {
      const f = makeTmpFile(dir, 'track.flac', MAGIC.flac, 16);
      expect(validate(f, 'track.flac', 100, SIZE_LIMITS)).toMatchObject({ valid: true, category: 'audio' });
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('returns error if temp file does not exist', () => {
      const r = validate('/nonexistent/path/file.jpg', 'file.jpg', 100, SIZE_LIMITS);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/read|content|validation/i);
    });

    test('uppercase extension in originalName is accepted (normalized internally)', () => {
      const f = makeTmpFile(dir, 'photo', MAGIC.jpeg, 16);
      // validate() uses path.extname(originalName) — uppercase .JPG → lowercased
      const r = validate(f, 'photo.JPG', 100, SIZE_LIMITS);
      expect(r.valid).toBe(true);
      expect(r.category).toBe('image');
    });

    test('size limit of 0 is treated as "no limit" (falsy skips size check)', () => {
      const limitsWithZeroImage = { ...SIZE_LIMITS, image: 0 };
      const f = makeTmpFile(dir, 'photo.jpg', MAGIC.jpeg, 16);
      // limit=0 is falsy → `if (limit && fileSize > limit)` skips the check
      const r = validate(f, 'photo.jpg', 999 * 1024 * 1024, limitsWithZeroImage);
      expect(r.valid).toBe(true);
    });

    test('no size limit for a category (undefined) allows any size', () => {
      const limitsWithoutVideo = { image: SIZE_LIMITS.image, audio: SIZE_LIMITS.audio };
      const f = makeTmpFile(dir, 'video.mp4', MAGIC.mp4, 16);
      // limit is undefined → no limit check → only extension+magic checked
      const r = validate(f, 'video.mp4', 999 * 1024 * 1024, limitsWithoutVideo);
      expect(r.valid).toBe(true);
    });
  });
});
