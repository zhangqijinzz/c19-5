import { analyzeLayout } from './domain';
import type { Analysis, ElementKind, ExpoElement, FieldSize, LayoutDocument } from './types';

export const CURRENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1];

export type IssueLevel = 'error' | 'warning';
export type IssueCode =
  | 'file-format'
  | 'unsupported-version'
  | 'missing-field'
  | 'invalid-value'
  | 'unknown-kind'
  | 'unknown-field'
  | 'duplicate-id'
  | 'out-of-bounds'
  | 'field-resize';

export interface TransferIssue {
  level: IssueLevel;
  code: IssueCode;
  /** 受影响元素的下标（从 1 开始，便于用户对照文件），文件级问题为 null */
  elementIndex: number | null;
  /** 字段名，例如 elements[2].width；文件级问题为 null */
  field: string | null;
  message: string;
}

export interface ParsedTransfer {
  /** 迁移到当前版本、丢弃未知字段后的文档（可能仍包含越界元素，由用户决定如何处理） */
  document: LayoutDocument;
  sourceVersion: number;
  issues: TransferIssue[];
  /** 无法恢复成文档（JSON 损坏 / 结构完全不对） */
  fatal: string | null;
}

const ELEMENT_KINDS: ElementKind[] = ['booth', 'stage', 'seating', 'entrance'];
const ELEMENT_FIELDS = ['id', 'kind', 'name', 'x', 'y', 'width', 'height', 'rotation'];
const DOCUMENT_FIELDS = ['version', 'title', 'field', 'elements', 'exportedAt', 'app'];
const FIELD_FIELDS = ['width', 'height'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const round1 = (value: number) => Number(value.toFixed(2));

/**
 * 早先版本导出文件的迁移逻辑（无版本号或 version < 1 均视为早期内测版）。
 * 迁移只做「补默认值」，并对每处补齐逐条留痕；无法推断的内容（如场地尺寸）仍交由后续校验报错。
 */
const migrateToV1 = (raw: Record<string, unknown>, sourceVersion: number): { value: Record<string, unknown>; issues: TransferIssue[] } => {
  const issues: TransferIssue[] = [];
  if (sourceVersion < 1) {
    if (!('title' in raw)) {
      raw.title = '未命名方案（旧版本导入）';
      issues.push({ level: 'warning', code: 'missing-field', elementIndex: null, field: 'title', message: '早期版本文件缺少项目名称，已暂补为「未命名方案（旧版本导入）」，导入后可修改' });
    }
    if (Array.isArray(raw.elements)) {
      raw.elements.forEach((element, index) => {
        if (isRecord(element) && !('rotation' in element)) {
          element.rotation = 0;
          issues.push({ level: 'warning', code: 'missing-field', elementIndex: index + 1, field: `elements[${index}].rotation`, message: `第 ${index + 1} 个元素来自早期版本、缺少 rotation，已按 0° 处理` });
        }
      });
    }
  }
  return { value: raw, issues };
};

const parseElement = (raw: unknown, index: number, seenIds: Set<string>): { element: ExpoElement | null; issues: TransferIssue[] } => {
  const where = `elements[${index}]`;
  const oneBased = index + 1;
  const issues: TransferIssue[] = [];

  if (!isRecord(raw)) {
    return { element: null, issues: [{ level: 'error', code: 'invalid-value', elementIndex: oneBased, field: where, message: `第 ${oneBased} 个元素不是有效对象，已跳过` }] };
  }

  for (const key of Object.keys(raw)) {
    if (!ELEMENT_FIELDS.includes(key)) {
      issues.push({ level: 'warning', code: 'unknown-field', elementIndex: oneBased, field: `${where}.${key}`, message: `第 ${oneBased} 个元素含未知字段「${key}」，导入时将忽略` });
    }
  }

  const requireNumber = (key: 'x' | 'y' | 'width' | 'height' | 'rotation'): number | null => {
    if (!(key in raw)) {
      issues.push({ level: 'error', code: 'missing-field', elementIndex: oneBased, field: `${where}.${key}`, message: `第 ${oneBased} 个元素缺少必填字段「${key}」` });
      return null;
    }
    if (!isFiniteNumber(raw[key])) {
      issues.push({ level: 'error', code: 'invalid-value', elementIndex: oneBased, field: `${where}.${key}`, message: `第 ${oneBased} 个元素的「${key}」必须是数字` });
      return null;
    }
    return raw[key] as number;
  };

  const requireString = (key: 'id' | 'kind' | 'name'): string | null => {
    if (!(key in raw)) {
      issues.push({ level: 'error', code: 'missing-field', elementIndex: oneBased, field: `${where}.${key}`, message: `第 ${oneBased} 个元素缺少必填字段「${key}」` });
      return null;
    }
    if (typeof raw[key] !== 'string' || !(raw[key] as string).trim()) {
      issues.push({ level: 'error', code: 'invalid-value', elementIndex: oneBased, field: `${where}.${key}`, message: `第 ${oneBased} 个元素的「${key}」必须是非空文本` });
      return null;
    }
    return (raw[key] as string).trim();
  };

  const id = requireString('id');
  const kindRaw = requireString('kind');
  const name = requireString('name');
  const x = requireNumber('x');
  const y = requireNumber('y');
  const width = requireNumber('width');
  const height = requireNumber('height');
  const rotation = requireNumber('rotation');

  let kind: ElementKind | null = null;
  if (kindRaw) {
    if (ELEMENT_KINDS.includes(kindRaw as ElementKind)) {
      kind = kindRaw as ElementKind;
    } else {
      issues.push({ level: 'error', code: 'unknown-kind', elementIndex: oneBased, field: `${where}.kind`, message: `第 ${oneBased} 个元素的类型「${kindRaw}」当前版本无法识别` });
    }
  }

  if (width !== null && width <= 0) issues.push({ level: 'error', code: 'invalid-value', elementIndex: oneBased, field: `${where}.width`, message: `第 ${oneBased} 个元素的宽度必须大于 0` });
  if (height !== null && height <= 0) issues.push({ level: 'error', code: 'invalid-value', elementIndex: oneBased, field: `${where}.height`, message: `第 ${oneBased} 个元素的深度必须大于 0` });

  if (id && seenIds.has(id)) {
    issues.push({ level: 'warning', code: 'duplicate-id', elementIndex: oneBased, field: `${where}.id`, message: `元素 ID「${id}」在文件中重复，第 ${oneBased} 个元素将重新分配 ID` });
  } else if (id) {
    seenIds.add(id);
  }

  const anyMissing = id === null || kind === null || name === null || x === null || y === null || width === null || height === null || rotation === null
    || (width !== null && width <= 0) || (height !== null && height <= 0);
  if (anyMissing) return { element: null, issues };

  const normalizedRotation = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  const element: ExpoElement = {
    id: seenIds.has(id as string) && issues.some((issue) => issue.code === 'duplicate-id' && issue.elementIndex === oneBased)
      ? `imported-${kind}-${Date.now()}-${oneBased}`
      : (id as string),
    kind: kind as ElementKind,
    name: name as string,
    x: round1(x as number),
    y: round1(y as number),
    width: round1(width as number),
    height: round1(height as number),
    rotation: normalizedRotation,
  };
  return { element, issues };
};

/**
 * 解析并逐项校验导出文件。任何情况下都不抛异常：
 * 解析失败时通过 fatal 返回原因，保证调用方现有草稿不受影响。
 * 传入 currentField 时会额外比对文件场地与当前草稿场地的尺寸差异。
 */
export const parseTransferFile = (text: string, currentField?: FieldSize): ParsedTransfer => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { document: emptyDocument(), sourceVersion: 0, issues: [], fatal: '文件不是有效的 JSON，可能已损坏或并非 ExpoSketch 导出文件' };
  }
  if (!isRecord(raw)) {
    return { document: emptyDocument(), sourceVersion: 0, issues: [], fatal: '文件结构不正确：顶层必须是布局对象' };
  }

  const hasVersion = 'version' in raw;
  const sourceVersion = typeof raw.version === 'number' ? raw.version : 0;
  if (hasVersion && sourceVersion > CURRENT_SCHEMA_VERSION) {
    return { document: emptyDocument(), sourceVersion, issues: [{ level: 'error', code: 'unsupported-version', elementIndex: null, field: 'version', message: `文件版本 v${sourceVersion} 高于当前支持的最高版本 v${CURRENT_SCHEMA_VERSION}，请先升级应用` }], fatal: `不支持的文件版本 v${sourceVersion}` };
  }
  if (hasVersion && sourceVersion < 1) {
    return { document: emptyDocument(), sourceVersion, issues: [{ level: 'error', code: 'unsupported-version', elementIndex: null, field: 'version', message: `文件版本 v${sourceVersion} 不受支持` }], fatal: `不支持的文件版本 v${sourceVersion}` };
  }

  const migrationIssues: TransferIssue[] = [];
  if (!hasVersion) {
    migrationIssues.push({ level: 'warning', code: 'missing-field', elementIndex: null, field: 'version', message: '文件缺少版本号，已按早期内测版（v0）尝试迁移读取' });
  }

  const migrated = migrateToV1(raw, sourceVersion);
  const value = migrated.value;
  const issues = [...migrationIssues, ...migrated.issues];

  for (const key of Object.keys(value)) {
    if (!DOCUMENT_FIELDS.includes(key)) {
      issues.push({ level: 'warning', code: 'unknown-field', elementIndex: null, field: key, message: `文件含未知字段「${key}」，导入时将忽略` });
    }
  }

  if (!('title' in value)) {
    issues.push({ level: 'error', code: 'missing-field', elementIndex: null, field: 'title', message: '文件缺少项目名称（title）' });
  } else if (typeof value.title !== 'string' || !value.title.trim()) {
    issues.push({ level: 'error', code: 'invalid-value', elementIndex: null, field: 'title', message: '项目名称（title）必须是非空文本' });
  }

  const fieldIssues: TransferIssue[] = [];
  const field: FieldSize = { width: 0, height: 0 };
  const fieldRecord = isRecord(value.field) ? value.field : null;
  if (!fieldRecord) {
    fieldIssues.push({ level: 'error', code: 'missing-field', elementIndex: null, field: 'field', message: '文件缺少场地尺寸（field）' });
  } else {
    for (const key of Object.keys(fieldRecord)) {
      if (!FIELD_FIELDS.includes(key)) fieldIssues.push({ level: 'warning', code: 'unknown-field', elementIndex: null, field: `field.${key}`, message: `场地尺寸含未知字段「${key}」，将忽略` });
    }
    (['width', 'height'] as const).forEach((key) => {
      if (!(key in fieldRecord)) fieldIssues.push({ level: 'error', code: 'missing-field', elementIndex: null, field: `field.${key}`, message: `场地缺少「${key === 'width' ? '宽度' : '深度'}」` });
      else if (!isFiniteNumber(fieldRecord[key]) || (fieldRecord[key] as number) <= 0) fieldIssues.push({ level: 'error', code: 'invalid-value', elementIndex: null, field: `field.${key}`, message: `场地「${key === 'width' ? '宽度' : '深度'}」必须是大于 0 的数字` });
      else field[key] = round1(fieldRecord[key] as number);
    });
  }
  issues.push(...fieldIssues);

  if (!Array.isArray(value.elements)) {
    issues.push({ level: 'error', code: 'missing-field', elementIndex: null, field: 'elements', message: '文件缺少元素列表（elements）' });
    return { document: { version: CURRENT_SCHEMA_VERSION, title: typeof value.title === 'string' ? value.title : '未命名方案', field, elements: [] }, sourceVersion, issues, fatal: null };
  }

  const seenIds = new Set<string>();
  const elements: ExpoElement[] = [];
  value.elements.forEach((rawElement, index) => {
    const { element, issues: elementIssues } = parseElement(rawElement, index, seenIds);
    issues.push(...elementIssues);
    if (element) elements.push(element);
  });

  // 越界检查：以导入文件自身的场地尺寸为准
  if (field.width > 0 && field.height > 0) {
    elements.forEach((element, index) => {
      const box = boundsOf(element);
      const overflow = Math.max(0, -box.left, -box.top, box.right - field.width, box.bottom - field.height);
      if (overflow > 0) {
        issues.push({ level: 'warning', code: 'out-of-bounds', elementIndex: index + 1, field: `elements[${index}]`, message: `「${element.name}」超出场地边界约 ${overflow.toFixed(1)} m，导入后需调整位置或场地尺寸` });
      }
    });

    // 与当前草稿场地比对：覆盖导入会改变场地尺寸
    if (currentField && (currentField.width !== field.width || currentField.height !== field.height)) {
      issues.push({
        level: 'warning',
        code: 'field-resize',
        elementIndex: null,
        field: 'field',
        message: `文件场地 ${field.width}×${field.height} m 与当前草稿 ${currentField.width}×${currentField.height} m 不一致，覆盖导入后场地尺寸将一并改变`,
      });
    }
  }

  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '未命名方案';
  return { document: { version: CURRENT_SCHEMA_VERSION, title, field, elements }, sourceVersion, issues, fatal: null };
};

const boundsOf = (element: ExpoElement) => {
  const quarterTurn = (((element.rotation % 180) + 180) % 180) !== 0;
  const width = quarterTurn ? element.height : element.width;
  const height = quarterTurn ? element.width : element.height;
  return { left: element.x, top: element.y, right: element.x + width, bottom: element.y + height };
};

const emptyDocument = (): LayoutDocument => ({ version: CURRENT_SCHEMA_VERSION, title: '', field: { width: 0, height: 0 }, elements: [] });

export interface TransferEnvelope {
  app: 'exposketch';
  version: number;
  exportedAt: string;
  title: string;
  field: FieldSize;
  elements: ExpoElement[];
}

export const serializeTransferFile = (document: LayoutDocument): string => {
  const envelope: TransferEnvelope = {
    app: 'exposketch',
    version: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    title: document.title,
    field: document.field,
    elements: document.elements,
  };
  return JSON.stringify(envelope, null, 2);
};

export const suggestTransferFileName = (document: LayoutDocument): string => {
  const safeTitle = document.title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || '未命名方案';
  const stamp = new Date().toISOString().slice(0, 10);
  return `exposketch-${safeTitle}-${stamp}.json`;
};

export interface PrintLegendItem { kind: ElementKind; label: string; icon: string; count: number; }

export interface PrintSummary {
  total: number;
  overlaps: number;
  bounds: number;
  channels: number;
  pathDistance: number | null;
}

export interface PrintModel {
  title: string;
  field: FieldSize;
  area: number;
  exportedAt: string;
  elements: ExpoElement[];
  legend: PrintLegendItem[];
  summary: PrintSummary;
  analysis: Analysis;
}

export const buildPrintModel = (document: LayoutDocument): PrintModel => {
  const analysis = analyzeLayout(document);
  return {
    title: document.title,
    field: document.field,
    area: Number((document.field.width * document.field.height).toFixed(1)),
    exportedAt: new Date().toLocaleString('zh-CN'),
    elements: document.elements,
    legend: (['booth', 'stage', 'seating', 'entrance'] as ElementKind[]).map((kind) => ({
      kind,
      label: ({ booth: '标准展位', stage: '主舞台', seating: '观众座席', entrance: '入口' })[kind],
      icon: ({ booth: '▦', stage: '✦', seating: '▤', entrance: '↗' })[kind],
      count: document.elements.filter((element) => element.kind === kind).length,
    })),
    summary: {
      total: document.elements.length,
      overlaps: analysis.overlaps.length,
      bounds: analysis.bounds.length,
      channels: analysis.channels.length,
      pathDistance: analysis.path?.distance ?? null,
    },
    analysis,
  };
};
