import { ELEMENT_SPECS, findBoundsIssues } from './domain';
import type { ElementKind, ExpoElement, FieldSize, LayoutDocument } from './types';

export const CURRENT_FORMAT_VERSION = 1;
export const EXPORT_FORMAT = 'exposketch-layout';

const ENVELOPE_KEYS = ['format', 'formatVersion', 'exportedAt', 'app', 'document'];
const DOCUMENT_KEYS = ['version', 'title', 'field', 'elements'];
const FIELD_KEYS = ['width', 'height'];
const ELEMENT_KEYS = ['id', 'kind', 'name', 'x', 'y', 'width', 'height', 'rotation'];
const KNOWN_KINDS = Object.keys(ELEMENT_SPECS) as ElementKind[];

export type ImportIssueLevel = 'error' | 'warning' | 'info';

export interface ImportIssue {
  level: ImportIssueLevel;
  code: string;
  target: string;
  message: string;
}

export interface ImportReport {
  ok: boolean;
  fileName: string;
  sourceLabel: string;
  exportedAt: string | null;
  title: string | null;
  field: FieldSize | null;
  elementCount: number;
  issues: ImportIssue[];
  document: LayoutDocument | null;
}

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike => !!value && typeof value === 'object' && !Array.isArray(value);

const unknownKeys = (record: RecordLike, known: string[]) => Object.keys(record).filter((key) => !known.includes(key));

const targetLabel = (index: number, fallback: unknown) => {
  const name = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : `第 ${index + 1} 个元素`;
  return `元素 ${index + 1} · ${name}`;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * 解析并校验导出文件。任何情况下都不抛异常：文件损坏、结构错误都会以
 * error 级别的问题条目返回，document 为 null，调用方据此阻止导入。
 */
export const parseLayoutFile = (text: string, fileName = '导入文件', currentField?: FieldSize): ImportReport => {
  const issues: ImportIssue[] = [];
  const push = (level: ImportIssueLevel, code: string, target: string, message: string) =>
    issues.push({ level, code, target, message });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false, fileName, sourceLabel: '无法识别的文件', exportedAt: null,
      title: null, field: null, elementCount: 0, document: null,
      issues: [{ level: 'error', code: 'file-unreadable', target: fileName, message: '文件不是有效的 JSON，无法读取（可能已损坏或不是布局导出文件）' }],
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false, fileName, sourceLabel: '无法识别的文件', exportedAt: null,
      title: null, field: null, elementCount: 0, document: null,
      issues: [{ level: 'error', code: 'file-structure', target: fileName, message: '文件顶层结构无效，应包含场地与元素数据' }],
    };
  }

  // 兼容早期版本：既支持带导出封装的新文件，也支持直接导出 LayoutDocument 的裸文件。
  const isEnvelope = parsed.format === EXPORT_FORMAT;
  let payload: unknown = parsed;
  let exportedAt: string | null = null;
  let sourceLabel = '早期版本导出（无格式封装）';

  if (isEnvelope) {
    const version = toFiniteNumber(parsed.formatVersion);
    if (version === null) {
      push('warning', 'unknown-format-version', '文件头', '缺少 formatVersion 字段，按当前兼容规则读取');
    } else if (version > CURRENT_FORMAT_VERSION) {
      push('warning', 'unknown-format-version', '文件头', `文件来自更新版本（v${version}），将按 v${CURRENT_FORMAT_VERSION} 兼容规则读取，部分内容可能无法识别`);
    }
    if (typeof parsed.exportedAt === 'string') exportedAt = parsed.exportedAt;
    else push('info', 'missing-exported-at', '文件头', '缺少导出时间');
    if (typeof parsed.app !== 'string') push('info', 'unknown-field', '文件头', '缺少导出应用标识（app）');
    unknownKeys(parsed, ENVELOPE_KEYS).forEach((key) => push('warning', 'unknown-field', `文件头 · ${key}`, `存在不认识的字段「${key}」，导入时将忽略`));
    payload = parsed.document;
    sourceLabel = `ExpoSketch 导出文件（格式 v${version ?? '?'}）`;
    if (!isRecord(payload)) {
      push('error', 'missing-document', '文件头', '封装文件中缺少 document 布局数据');
      return { ok: false, fileName, sourceLabel, exportedAt, title: null, field: null, elementCount: 0, issues, document: null };
    }
  }

  const documentNode = payload as RecordLike;
  unknownKeys(documentNode, DOCUMENT_KEYS).forEach((key) => push('warning', 'unknown-field', `布局 · ${key}`, `存在不认识的字段「${key}」，导入时将忽略`));
  if (documentNode.version !== undefined && documentNode.version !== 1) {
    push('info', 'document-version', '布局', `文档版本为 ${String(documentNode.version)}，将迁移到当前版本 v1`);
  } else if (documentNode.version === undefined) {
    push('info', 'document-version', '布局', '缺少文档版本号，按 v1 读取');
  }

  // 标题（必填）
  let title: string | null = null;
  if (typeof documentNode.title !== 'string' || !documentNode.title.trim()) {
    push('error', 'missing-required', '布局 · 项目名称', '缺少必填内容：项目名称');
  } else {
    title = documentNode.title.trim();
  }

  // 场地尺寸（必填）
  let field: FieldSize | null = null;
  const fieldNode = documentNode.field;
  if (!isRecord(fieldNode)) {
    push('error', 'missing-required', '布局 · 场地', '缺少必填内容：场地尺寸');
  } else {
    unknownKeys(fieldNode, FIELD_KEYS).forEach((key) => push('warning', 'unknown-field', `场地 · ${key}`, `存在不认识的场地字段「${key}」，导入时将忽略`));
    const width = toFiniteNumber(fieldNode.width);
    const height = toFiniteNumber(fieldNode.height);
    const coerced: string[] = [];
    if (typeof fieldNode.width === 'string') coerced.push('宽度');
    if (typeof fieldNode.height === 'string') coerced.push('深度');
    coerced.forEach((label) => push('info', 'type-coerced', '场地', `${label}以文本形式存储，已自动转换为数值`));
    if (fieldNode.width === undefined) push('error', 'missing-required', '场地 · 宽度', '缺少必填内容：场地宽度');
    else if (width === null) push('error', 'invalid-value', '场地 · 宽度', `场地宽度无效（${String(fieldNode.width)}），应为数值`);
    else if (width <= 0) push('error', 'invalid-value', '场地 · 宽度', `场地宽度必须大于 0（当前 ${width}）`);
    if (fieldNode.height === undefined) push('error', 'missing-required', '场地 · 深度', '缺少必填内容：场地深度');
    else if (height === null) push('error', 'invalid-value', '场地 · 深度', `场地深度无效（${String(fieldNode.height)}），应为数值`);
    else if (height <= 0) push('error', 'invalid-value', '场地 · 深度', `场地深度必须大于 0（当前 ${height}）`);
    if (width !== null && height !== null && width > 0 && height > 0) field = { width: Number(width.toFixed(2)), height: Number(height.toFixed(2)) };
  }

  if (field && currentField && (field.width !== currentField.width || field.height !== currentField.height)) {
    push('info', 'field-mismatch', '布局 · 场地尺寸', `文件场地为 ${field.width} × ${field.height} m，当前草稿为 ${currentField.width} × ${currentField.height} m；导入后以文件中的尺寸为准`);
  }

  // 元素（必填数组）
  const elementsNode = documentNode.elements;
  const elements: ExpoElement[] = [];
  if (!Array.isArray(elementsNode)) {
    push('error', 'missing-required', '布局 · 元素', '缺少必填内容：elements 元素列表（应为数组）');
  } else {
    const seenIds = new Set<string>();
    elementsNode.forEach((rawElement, index) => {
      if (!isRecord(rawElement)) {
        push('error', 'invalid-element', `元素 ${index + 1}`, '该条目不是有效的元素对象，将跳过');
        return;
      }

      unknownKeys(rawElement, ELEMENT_KEYS).forEach((key) => push('warning', 'unknown-field', targetLabel(index, rawElement.name) + ` · ${key}`, `存在不认识的元素字段「${key}」，导入时将忽略`));

      let elementValid = true;
      const notes: ImportIssue[] = [];
      const readRequiredNumber = (key: 'x' | 'y' | 'width' | 'height', label: string): number | null => {
        if (rawElement[key] === undefined) {
          push('error', 'missing-required', targetLabel(index, rawElement.name) + ` · ${label}`, `缺少必填内容：${label}`);
          elementValid = false;
          return null;
        }
        const value = toFiniteNumber(rawElement[key]);
        if (value === null) {
          push('error', 'invalid-value', targetLabel(index, rawElement.name) + ` · ${label}`, `${label}无效（${String(rawElement[key])}），应为数值`);
          elementValid = false;
          return null;
        }
        if (typeof rawElement[key] === 'string') notes.push({ level: 'info', code: 'type-coerced', target: targetLabel(index, rawElement.name) + ` · ${label}`, message: `${label}以文本形式存储，已自动转换为数值` });
        if ((key === 'width' || key === 'height') && value <= 0) {
          push('error', 'invalid-value', targetLabel(index, rawElement.name) + ` · ${label}`, `${label}必须大于 0（当前 ${value}）`);
          elementValid = false;
        }
        return value;
      };

      const id = rawElement.id;
      if (typeof id !== 'string' || !id.trim()) {
        push('error', 'missing-required', targetLabel(index, rawElement.name) + ' · ID', '缺少必填内容：元素 ID');
        elementValid = false;
      } else if (seenIds.has(id)) {
        push('error', 'duplicate-id', targetLabel(index, rawElement.name), `元素 ID「${id}」重复，每个元素必须唯一`);
        elementValid = false;
      } else {
        seenIds.add(id);
      }

      const kind = rawElement.kind;
      if (kind === undefined) {
        push('error', 'missing-required', targetLabel(index, rawElement.name) + ' · 类型', '缺少必填内容：元素类型（kind）');
        elementValid = false;
      } else if (typeof kind !== 'string' || !KNOWN_KINDS.includes(kind as ElementKind)) {
        push('error', 'unknown-kind', targetLabel(index, rawElement.name) + ' · 类型', `不支持的元素类型「${String(kind)}」，可识别类型：${KNOWN_KINDS.map((item) => ELEMENT_SPECS[item].label).join('、')}`);
        elementValid = false;
      }

      let name = typeof rawElement.name === 'string' ? rawElement.name.trim() : '';
      if (rawElement.name === undefined) {
        name = `${ELEMENT_SPECS[(typeof kind === 'string' ? kind : 'booth') as ElementKind]?.label ?? '元素'} ${index + 1}`;
        notes.push({ level: 'info', code: 'legacy-migration', target: targetLabel(index, rawElement.id ?? index), message: `早期版本缺少元素名称，已补为「${name}」` });
      } else if (!name) {
        push('error', 'invalid-value', targetLabel(index, rawElement.id ?? index) + ' · 名称', '元素名称为空');
        elementValid = false;
      }

      const x = readRequiredNumber('x', 'X 坐标');
      const y = readRequiredNumber('y', 'Y 坐标');
      const width = readRequiredNumber('width', '宽度');
      const height = readRequiredNumber('height', '深度');

      let rotation = 0;
      if (rawElement.rotation === undefined) {
        notes.push({ level: 'info', code: 'legacy-migration', target: targetLabel(index, rawElement.id ?? index), message: '早期版本缺少旋转角度，已按 0° 处理' });
      } else {
        const parsedRotation = toFiniteNumber(rawElement.rotation);
        if (parsedRotation === null) {
          push('error', 'invalid-value', targetLabel(index, rawElement.id ?? index) + ' · 旋转', `旋转角度无效（${String(rawElement.rotation)}）`);
          elementValid = false;
        } else {
          rotation = parsedRotation;
        }
      }

      if (!elementValid) {
        return;
      }
      notes.forEach((note) => issues.push(note));
      elements.push({
        id: id as string,
        kind: kind as ElementKind,
        name,
        x: Number((x as number).toFixed(2)),
        y: Number((y as number).toFixed(2)),
        width: Number((width as number).toFixed(2)),
        height: Number((height as number).toFixed(2)),
        rotation,
      });
    });
  }

  // 越界检查（warning 不阻止导入，由用户决定如何处理）
  if (field) {
    findBoundsIssues(field, elements).forEach((issue) => {
      const element = elements.find((item) => item.id === issue.elementId);
      push('warning', 'out-of-bounds', `元素 · ${element?.name ?? issue.elementId}`, `「${element?.name ?? issue.elementId}」超出场地边界 ${issue.overflow} m，导入后需要重新调整位置`);
    });
  }

  const ok = issues.every((issue) => issue.level !== 'error');
  const document: LayoutDocument | null = ok && title && field
    ? { version: 1, title, field, elements }
    : null;

  return {
    ok,
    fileName,
    sourceLabel,
    exportedAt,
    title,
    field,
    elementCount: Array.isArray(elementsNode) ? elementsNode.length : 0,
    issues,
    document,
  };
};

export interface LayoutExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  app: 'ExpoSketch';
  exportedAt: string;
  document: LayoutDocument;
}

export const buildLayoutExport = (document: LayoutDocument): LayoutExportFile => ({
  format: EXPORT_FORMAT,
  formatVersion: CURRENT_FORMAT_VERSION,
  app: 'ExpoSketch',
  exportedAt: new Date().toISOString(),
  document,
});
