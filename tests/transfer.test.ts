import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { buildLayoutExport, parseLayoutFile } from '../src/transfer';
import type { LayoutDocument } from '../src/types';

const parse = (value: unknown, currentField?: { width: number; height: number }) =>
  parseLayoutFile(JSON.stringify(value), 'test.json', currentField);

describe('layout file export/import round-trip', () => {
  it('exports the current document and imports it back unchanged', () => {
    const document = createStarterDocument();
    const report = parse(buildLayoutExport(document));
    expect(report.ok).toBe(true);
    expect(report.issues.filter((issue) => issue.level === 'error' || issue.level === 'warning')).toHaveLength(0);
    expect(report.document).toEqual(document);
  });

  it('reads legacy bare documents without an export envelope and migrates defaults', () => {
    const legacy = {
      version: 1,
      title: '旧版方案',
      field: { width: 20, height: 12 },
      elements: [{ id: 'b1', kind: 'booth', name: '老展位', x: 1, y: 1, width: 4, height: 3 }],
    };
    const report = parse(legacy);
    expect(report.ok).toBe(true);
    expect(report.sourceLabel).toContain('早期版本');
    const migration = report.issues.find((issue) => issue.code === 'legacy-migration');
    expect(migration?.message).toContain('旋转角度');
    expect(report.document?.elements[0].rotation).toBe(0);
  });

  it('lists unknown top-level, field and element fields as warnings but still imports', () => {
    const document = createStarterDocument();
    const wrapped = buildLayoutExport(document);
    (wrapped as unknown as Record<string, unknown>).experimental = true;
    (wrapped.document.field as unknown as Record<string, unknown>).unit = 'meter';
    (wrapped.document.elements[0] as unknown as Record<string, unknown>).owner = 'team-a';
    const report = parse(wrapped);
    expect(report.ok).toBe(true);
    const unknowns = report.issues.filter((issue) => issue.code === 'unknown-field');
    expect(unknowns.map((issue) => issue.message).join(' ')).toContain('experimental');
    expect(unknowns.map((issue) => issue.message).join(' ')).toContain('unit');
    expect(unknowns.map((issue) => issue.message).join(' ')).toContain('owner');
  });

  it('blocks import and returns no document when required content is missing', () => {
    const broken = { version: 1, field: { width: 20, height: 12 }, elements: [] };
    const report = parse(broken);
    expect(report.ok).toBe(false);
    expect(report.document).toBeNull();
    expect(report.issues.some((issue) => issue.level === 'error' && issue.message.includes('项目名称'))).toBe(true);
  });

  it('flags unknown element kinds and duplicated ids as errors', () => {
    const document = {
      title: 'x', field: { width: 20, height: 12 },
      elements: [
        { id: 'dup', kind: 'cafe', name: '咖啡', x: 1, y: 1, width: 3, height: 3, rotation: 0 },
        { id: 'dup', kind: 'booth', name: '展位', x: 5, y: 1, width: 3, height: 3, rotation: 0 },
      ],
    };
    const report = parse(document);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.level === 'error' && issue.code === 'unknown-kind')).toBe(true);
    expect(report.issues.some((issue) => issue.level === 'error' && issue.code === 'duplicate-id')).toBe(true);
  });

  it('reports elements outside the document field as warnings without blocking', () => {
    const document: LayoutDocument = {
      version: 1, title: '越界方案', field: { width: 10, height: 10 },
      elements: [{ id: 'b1', kind: 'booth', name: '出格展位', x: 8, y: 8, width: 4, height: 4, rotation: 0 }],
    };
    const report = parse(buildLayoutExport(document));
    expect(report.ok).toBe(true);
    const outOfBounds = report.issues.filter((issue) => issue.code === 'out-of-bounds');
    expect(outOfBounds).toHaveLength(1);
    expect(outOfBounds[0].message).toContain('出格展位');
    expect(report.document).toEqual(document);
  });

  it('notes the field size difference against the current draft', () => {
    const document = buildLayoutExport(createStarterDocument());
    const report = parse(document, { width: 40, height: 40 });
    expect(report.issues.some((issue) => issue.code === 'field-mismatch')).toBe(true);
  });

  it('coerces numeric strings carried by older exports and records an info note', () => {
    const legacy = {
      title: '文本数值', field: { width: '20', height: '12' },
      elements: [{ id: 'b1', kind: 'booth', name: '展位', x: '1', y: '1', width: '4', height: '3', rotation: '0' }],
    };
    const report = parse(legacy);
    expect(report.ok).toBe(true);
    expect(report.document?.field).toEqual({ width: 20, height: 12 });
    expect(report.issues.some((issue) => issue.code === 'type-coerced')).toBe(true);
  });

  it('fails safely on broken json without throwing', () => {
    const report = parseLayoutFile('{not-json', 'broken.json');
    expect(report.ok).toBe(false);
    expect(report.document).toBeNull();
    expect(report.issues[0].code).toBe('file-unreadable');
  });

  it('rejects zero or negative dimensions', () => {
    const document = {
      title: 'x', field: { width: 0, height: 12 },
      elements: [{ id: 'b1', kind: 'booth', name: '展位', x: 1, y: 1, width: 0, height: 3, rotation: 0 }],
    };
    const report = parse(document);
    expect(report.ok).toBe(false);
    expect(report.issues.filter((issue) => issue.level === 'error').length).toBeGreaterThanOrEqual(2);
  });
});
