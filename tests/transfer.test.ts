import { describe, expect, it } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { buildPrintModel, parseTransferFile, serializeTransferFile, CURRENT_SCHEMA_VERSION } from '../src/transfer';
import { buildPrintHtml } from '../src/printLayout';
import type { LayoutDocument } from '../src/types';

describe('transfer file parsing', () => {
  it('round-trips a serialized document without issues', () => {
    const document = createStarterDocument();
    const parsed = parseTransferFile(serializeTransferFile(document));
    expect(parsed.fatal).toBeNull();
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.document).toEqual({ ...document, version: CURRENT_SCHEMA_VERSION });
  });

  it('never throws on broken JSON and reports a fatal reason', () => {
    const parsed = parseTransferFile('<<<not json>>>');
    expect(parsed.fatal).toContain('JSON');
    expect(parsed.document.elements).toEqual([]);
  });

  it('rejects files from a newer schema version', () => {
    const parsed = parseTransferFile(JSON.stringify({ version: 99, title: '未来版本', field: { width: 20, height: 20 }, elements: [] }));
    expect(parsed.fatal).toContain('版本');
    expect(parsed.issues[0].code).toBe('unsupported-version');
  });

  it('migrates an early-version file without version number or rotation on elements', () => {
    const parsed = parseTransferFile(JSON.stringify({
      title: '早期内测版',
      field: { width: 20, height: 12 },
      elements: [{ id: 'old-1', kind: 'booth', name: '老展位', x: 1, y: 1, width: 3, height: 2 }],
    }));
    expect(parsed.fatal).toBeNull();
    expect(parsed.sourceVersion).toBe(0);
    expect(parsed.document.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(parsed.document.elements[0].rotation).toBe(0);
    expect(parsed.issues.some((issue) => issue.field === 'version')).toBe(true);
    expect(parsed.issues.some((issue) => issue.field === 'elements[0].rotation')).toBe(true);
  });

  it('still flags missing rotation as an error for explicit v1 files', () => {
    const parsed = parseTransferFile(JSON.stringify({
      version: 1,
      title: '缺旋转字段',
      field: { width: 20, height: 12 },
      elements: [{ id: 'x-1', kind: 'booth', name: '展位', x: 1, y: 1, width: 3, height: 2 }],
    }));
    expect(parsed.issues.some((issue) => issue.code === 'missing-field' && issue.field === 'elements[0].rotation')).toBe(true);
    expect(parsed.document.elements).toHaveLength(0);
  });

  it('flags unknown top-level and element fields as warnings but still imports', () => {
    const parsed = parseTransferFile(JSON.stringify({
      version: 1,
      title: '带扩展字段',
      field: { width: 20, height: 12 },
      elements: [{ id: 'a', kind: 'booth', name: '甲', x: 1, y: 1, width: 3, height: 2, rotation: 0, owner: '王总' }],
      weather: '晴',
    }));
    expect(parsed.fatal).toBeNull();
    expect(parsed.document.elements).toHaveLength(1);
    const unknowns = parsed.issues.filter((issue) => issue.code === 'unknown-field');
    expect(unknowns.map((issue) => issue.field)).toContain('weather');
    expect(unknowns.some((issue) => issue.field === 'elements[0].owner')).toBe(true);
  });

  it('normalizes duplicate ids, bad rotation and out-of-range coordinates', () => {
    const parsed = parseTransferFile(JSON.stringify({
      version: 1,
      title: '重复 ID',
      field: { width: 20, height: 12 },
      elements: [
        { id: 'dup', kind: 'booth', name: '甲', x: 1, y: 1, width: 3, height: 2, rotation: 0 },
        { id: 'dup', kind: 'stage', name: '乙', x: 18, y: 10, width: 4, height: 3, rotation: 100 },
      ],
    }));
    expect(parsed.issues.some((issue) => issue.code === 'duplicate-id')).toBe(true);
    const [first, second] = parsed.document.elements;
    expect(first.id).toBe('dup');
    expect(second.id).not.toBe('dup');
    expect(second.rotation).toBe(90);
    expect(parsed.issues.some((issue) => issue.code === 'out-of-bounds')).toBe(true);
  });

  it('rejects non-positive field dimensions and element sizes', () => {
    const parsed = parseTransferFile(JSON.stringify({
      version: 1,
      title: '坏尺寸',
      field: { width: 0, height: 12 },
      elements: [{ id: 'a', kind: 'booth', name: '甲', x: 1, y: 1, width: -2, height: 2, rotation: 0 }],
    }));
    expect(parsed.issues.some((issue) => issue.field === 'field.width')).toBe(true);
    expect(parsed.issues.some((issue) => issue.field === 'elements[0].width')).toBe(true);
    expect(parsed.document.elements).toHaveLength(0);
  });

  it('strips envelope metadata and keeps only known data', () => {
    const parsed = parseTransferFile(JSON.stringify({
      app: 'exposketch',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      title: '带信封',
      field: { width: 18, height: 12 },
      elements: [],
    }));
    expect(parsed.fatal).toBeNull();
    expect(parsed.issues).toHaveLength(0);
  });

  it('warns when the imported field differs from the current draft', () => {
    const file = JSON.stringify({
      version: 1,
      title: '另一场地',
      field: { width: 40, height: 25 },
      elements: [{ id: 'a', kind: 'booth', name: '甲', x: 1, y: 1, width: 3, height: 2, rotation: 0 }],
    });
    const parsed = parseTransferFile(file, { width: 28, height: 18 });
    expect(parsed.issues.some((issue) => issue.code === 'field-resize')).toBe(true);
    // 不传当前场地时不产生该告警
    expect(parseTransferFile(file).issues.some((issue) => issue.code === 'field-resize')).toBe(false);
  });
});

describe('printable drawing', () => {
  it('includes project name, field size, legend and issue summary', () => {
    const document: LayoutDocument = {
      version: 1,
      title: '评审会专用方案',
      field: { width: 20, height: 12 },
      elements: [
        { id: 'e1', kind: 'entrance', name: '主入口', x: 1, y: 5, width: 2, height: 1.5, rotation: 0 },
        { id: 's1', kind: 'stage', name: '主舞台', x: 4, y: 4, width: 4, height: 3, rotation: 0 },
        { id: 'b1', kind: 'booth', name: '重叠展位', x: 5, y: 4.5, width: 4, height: 3, rotation: 0 },
      ],
    };
    const html = buildPrintHtml(buildPrintModel(document));
    expect(html).toContain('评审会专用方案');
    expect(html).toContain('20 × 12 m');
    expect(html).toContain('图例');
    expect(html).toContain('标准展位');
    expect(html).toContain('问题摘要');
    expect(html).toContain('重叠展位');
    expect(html).toContain('@page');
  });

  it('prints an all-clear summary when there are no issues', () => {
    const cleanDocument: LayoutDocument = {
      version: 1,
      title: '无问题方案',
      field: { width: 20, height: 12 },
      elements: [
        { id: 'e1', kind: 'entrance', name: '主入口', x: 1, y: 5, width: 2, height: 1.5, rotation: 0 },
        { id: 's1', kind: 'stage', name: '主舞台', x: 8, y: 4, width: 4, height: 3, rotation: 0 },
      ],
    };
    const html = buildPrintHtml(buildPrintModel(cleanDocument));
    expect(html).toContain('未发现重叠');
  });
});
