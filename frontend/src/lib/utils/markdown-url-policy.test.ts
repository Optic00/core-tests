import { describe, expect, it } from 'vitest';
import { isSafeMarkdownURL, markdownURLSchemes } from './markdown-url-policy';

/**
 * URL policy enforced on every link/image the Milkdown editor renders or
 * serializes (via the linkSanitizerPlugin). These tests were carried over
 * from the removed sanitizeMarkdownHtml DOMPurify pipeline.
 */
describe('isSafeMarkdownURL', () => {
  it('allows common navigation schemes and same-origin targets', () => {
    expect(isSafeMarkdownURL('https://example.com/page')).toBe(true);
    expect(isSafeMarkdownURL('http://example.com')).toBe(true);
    expect(isSafeMarkdownURL('mailto:user@example.com')).toBe(true);
    expect(isSafeMarkdownURL('tel:+123456789')).toBe(true);
    expect(isSafeMarkdownURL('/relative/path')).toBe(true);
    expect(isSafeMarkdownURL('#fragment')).toBe(true);
  });

  it('rejects dangerous schemes', () => {
    expect(isSafeMarkdownURL('javascript:alert(1)')).toBe(false);
    expect(isSafeMarkdownURL('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeMarkdownURL('vbscript:x')).toBe(false);
  });

  it('rejects protocol-relative and backslash-relative targets', () => {
    expect(isSafeMarkdownURL('//evil.example/path')).toBe(false);
    expect(isSafeMarkdownURL('\\evil.example/path')).toBe(false);
  });

  it('accepts only numeric page: links', () => {
    expect(isSafeMarkdownURL('page:185')).toBe(true);
    expect(isSafeMarkdownURL('page:javascript')).toBe(false);
    expect(isSafeMarkdownURL('page:')).toBe(false);
    expect(isSafeMarkdownURL('PAGE:12')).toBe(true);
  });

  it('handles empty and malformed values', () => {
    expect(isSafeMarkdownURL('')).toBe(false);
    expect(isSafeMarkdownURL('no scheme but has: colon')).toBe(false);
    expect(isSafeMarkdownURL('relative/path/no/colon')).toBe(true);
  });

  it('allows raster data images but rejects SVG data images', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(isSafeMarkdownURL(png, { image: true })).toBe(true);
    expect(isSafeMarkdownURL('data:image/svg+xml;base64,PHN2Zz4=', { image: true })).toBe(false);
    expect(isSafeMarkdownURL(png)).toBe(false);
  });

  it('only allows blob images when explicitly opted in', () => {
    const blob = 'blob:https://example.com/1234';
    expect(isSafeMarkdownURL(blob, { image: true, allowBlobImage: true })).toBe(true);
    expect(isSafeMarkdownURL(blob, { image: true })).toBe(false);
  });

  it('exposes the scheme allowlist used by DOMPurify consumers', () => {
    for (const scheme of ['http', 'https', 'mailto', 'tel', 'page', 'data']) {
      expect(markdownURLSchemes).toContain(scheme);
    }
  });
});
