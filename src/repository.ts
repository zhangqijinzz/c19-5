import { createStarterDocument } from './domain';
import type { DocumentStorageService } from './storageService';
import { parseTransferFile } from './transfer';
import type { LayoutDocument } from './types';

export interface LayoutRepository {
  load(): Promise<LayoutDocument>;
  save(document: LayoutDocument): Promise<void>;
}

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private readonly storage: DocumentStorageService) {}

  async load(): Promise<LayoutDocument> {
    try {
      const saved = await this.storage.read();
      if (!saved) return createStarterDocument();
      // 本地数据与导入文件共用同一条解析/迁移链路；解析失败绝不抛出，回退到安全示例
      const parsed = parseTransferFile(JSON.stringify(saved));
      if (parsed.fatal || parsed.issues.some((issue) => issue.level === 'error')) {
        return createStarterDocument();
      }
      return parsed.document;
    } catch {
      return createStarterDocument();
    }
  }

  async save(document: LayoutDocument): Promise<void> {
    await this.storage.write(document);
  }
}
