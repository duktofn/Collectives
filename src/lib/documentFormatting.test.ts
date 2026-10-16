import { describe, expect, it } from 'vitest';
import { formatDocumentSource } from './documentFormatting';

describe('document formatting', () => {
  it('expands compact objects and arrays into readable indented lines', async () => {
    expect(await formatDocumentSource('{"a":1,"items":[2,3],"empty":{}}', 'compact.json')).toBe(
      '{\n  "a": 1,\n  "items": [\n    2,\n    3\n  ],\n  "empty": {}\n}\n'
    );
  });
  it('formats JSON without rounding numeric literals or changing string values', async () => {
    const original =
      '{"id":12345678901234567890123,"items":[true,"a  b",{"html":"<script>x</script>"}]}';
    const formatted = await formatDocumentSource(original, 'settings.json');
    expect(formatted).toContain('12345678901234567890123');
    expect(formatted).toContain('"a  b"');
    expect(formatted).toContain('\n');
    expect(JSON.parse(formatted)).toEqual(JSON.parse(original));
  });
  it('formats HTML as source and preserves inline text whitespace', async () => {
    const original =
      '<!doctype html><html><body><div><p>Hello <strong>world</strong>!</p><script>window.example = true;</script></div></body></html>';
    const formatted = await formatDocumentSource(original, 'index.html');
    expect(formatted).toContain('Hello <strong>world</strong>!');
    expect(formatted).toContain('<script>');
    expect(formatted).toContain('\n');
  });
  it('rejects malformed JSON without returning a rewritten document', async () => {
    await expect(formatDocumentSource('{"broken":', 'broken.json')).rejects.toThrow();
  });
});
