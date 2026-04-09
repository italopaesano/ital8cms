/**
 * Unit tests for adminMedia/lib/filenameSanitizer.js
 *
 * Covers:
 *   - sanitize(): lowercase, spaces→_, remove special chars, collapse, truncate, extension preservation, fallback
 *   - resolveCollision(): no collision, _1 suffix, increment, max suffix edge case
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { sanitize, resolveCollision } = require('../../../plugins/adminMedia/lib/filenameSanitizer');

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'admedia-san-'));
}

// ══ sanitize() ═══════════════════════════════════════════════════════════════

describe('sanitize()', () => {

  describe('lowercase', () => {
    test('converts uppercase to lowercase', () => {
      expect(sanitize('MyPhoto.JPG')).toBe('myphoto.jpg');
    });

    test('converts mixed case', () => {
      expect(sanitize('CamelCaseName.PNG')).toBe('camelcasename.png');
    });
  });

  describe('spaces → underscores', () => {
    test('replaces single space with underscore', () => {
      expect(sanitize('my photo.jpg')).toBe('my_photo.jpg');
    });

    test('replaces multiple consecutive spaces with single underscore', () => {
      expect(sanitize('my   photo.jpg')).toBe('my_photo.jpg');
    });

    test('replaces tabs with underscore', () => {
      expect(sanitize('my\tphoto.jpg')).toBe('my_photo.jpg');
    });
  });

  describe('special character removal', () => {
    test('removes parentheses', () => {
      expect(sanitize('foto(2024).jpg')).toBe('foto2024.jpg');
    });

    test('removes exclamation marks', () => {
      expect(sanitize('foto!.jpg')).toBe('foto.jpg');
    });

    test('removes accented characters', () => {
      expect(sanitize('cafè.jpg')).toBe('caf.jpg');
    });

    test('preserves hyphens', () => {
      expect(sanitize('my-photo.jpg')).toBe('my-photo.jpg');
    });

    test('preserves underscores', () => {
      expect(sanitize('my_photo.jpg')).toBe('my_photo.jpg');
    });

    test('preserves digits', () => {
      expect(sanitize('photo2024.jpg')).toBe('photo2024.jpg');
    });

    test('removes slash characters (path.basename strips path components)', () => {
      // path.extname/basename treat '/' as separator → only the final component is kept
      expect(sanitize('path/to/file.jpg')).toBe('file.jpg');
    });

    test('removes backslash characters', () => {
      expect(sanitize('path\\file.jpg')).toBe('pathfile.jpg');
    });

    test('full realistic example: "Mia Foto (2024)!.jpg"', () => {
      expect(sanitize('Mia Foto (2024)!.jpg')).toBe('mia_foto_2024.jpg');
    });
  });

  describe('consecutive _ and - collapsing', () => {
    test('collapses multiple underscores', () => {
      expect(sanitize('my___photo.jpg')).toBe('my_photo.jpg');
    });

    test('collapses multiple hyphens', () => {
      expect(sanitize('my---photo.jpg')).toBe('my-photo.jpg');
    });
  });

  describe('leading/trailing trimming', () => {
    test('removes leading underscore', () => {
      expect(sanitize('_photo.jpg')).toBe('photo.jpg');
    });

    test('removes trailing underscore', () => {
      expect(sanitize('photo_.jpg')).toBe('photo.jpg');
    });

    test('removes leading hyphen', () => {
      expect(sanitize('-photo.jpg')).toBe('photo.jpg');
    });

    test('removes trailing hyphen', () => {
      expect(sanitize('photo-.jpg')).toBe('photo.jpg');
    });
  });

  describe('extension preservation', () => {
    test('preserves .jpg extension lowercased', () => {
      expect(sanitize('PHOTO.JPG')).toMatch(/\.jpg$/);
    });

    test('preserves .mp4 extension', () => {
      expect(sanitize('Video Clip.mp4')).toBe('video_clip.mp4');
    });

    test('preserves .flac extension', () => {
      expect(sanitize('My Track.FLAC')).toBe('my_track.flac');
    });

    test('handles double extension correctly (only last counts)', () => {
      // path.extname('file.tar.gz') returns '.gz'
      expect(sanitize('archive.tar.gz')).toBe('archivetar.gz');
    });
  });

  describe('truncation', () => {
    test('truncates very long base name to 200 chars (excluding extension)', () => {
      const longName = 'a'.repeat(300) + '.jpg';
      const result = sanitize(longName);
      const base = path.basename(result, '.jpg');
      expect(base.length).toBeLessThanOrEqual(200);
      expect(result).toMatch(/\.jpg$/);
    });

    test('short names are not truncated', () => {
      expect(sanitize('short.jpg')).toBe('short.jpg');
    });
  });

  describe('fallback for empty result', () => {
    test('returns "file.jpg" when name becomes empty after sanitization', () => {
      expect(sanitize('!!!(((}}}!.jpg')).toBe('file.jpg');
    });

    test('returns "file" with extension when only special chars remain', () => {
      const result = sanitize('!!!.png');
      expect(result).toBe('file.png');
    });
  });

  describe('edge cases', () => {
    test('handles filename with no extension', () => {
      const result = sanitize('README');
      expect(result).toBe('readme');
    });

    test('handles filename that is only an extension', () => {
      // '.gitignore' → ext is '' since path.extname('.gitignore') = ''
      const result = sanitize('.gitignore');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('already clean name passes through unchanged', () => {
      expect(sanitize('clean_photo_2024.jpg')).toBe('clean_photo_2024.jpg');
    });
  });
});

// ══ resolveCollision() ═══════════════════════════════════════════════════════

describe('resolveCollision()', () => {

  let dir;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('returns same name when file does not exist', () => {
    expect(resolveCollision(dir, 'photo.jpg')).toBe('photo.jpg');
  });

  test('returns _1 suffix when original name is taken', () => {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), '');
    expect(resolveCollision(dir, 'photo.jpg')).toBe('photo_1.jpg');
  });

  test('returns _2 when _1 is also taken', () => {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), '');
    fs.writeFileSync(path.join(dir, 'photo_1.jpg'), '');
    expect(resolveCollision(dir, 'photo.jpg')).toBe('photo_2.jpg');
  });

  test('skips to first available suffix', () => {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), '');
    fs.writeFileSync(path.join(dir, 'photo_1.jpg'), '');
    fs.writeFileSync(path.join(dir, 'photo_2.jpg'), '');
    expect(resolveCollision(dir, 'photo.jpg')).toBe('photo_3.jpg');
  });

  test('preserves extension in collision suffix', () => {
    fs.writeFileSync(path.join(dir, 'video.mp4'), '');
    const result = resolveCollision(dir, 'video.mp4');
    expect(result).toBe('video_1.mp4');
    expect(result).toMatch(/\.mp4$/);
  });

  test('works for files without extension', () => {
    fs.writeFileSync(path.join(dir, 'readme'), '');
    expect(resolveCollision(dir, 'readme')).toBe('readme_1');
  });

  test('works for audio files', () => {
    fs.writeFileSync(path.join(dir, 'track.mp3'), '');
    expect(resolveCollision(dir, 'track.mp3')).toBe('track_1.mp3');
  });

  test('returns same name when only suffix files exist (no original)', () => {
    fs.writeFileSync(path.join(dir, 'photo_1.jpg'), '');
    // Original not taken, so return it directly
    expect(resolveCollision(dir, 'photo.jpg')).toBe('photo.jpg');
  });
});
