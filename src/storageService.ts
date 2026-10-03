import type { LayoutDocument } from './types';

export interface DocumentStorageService {
  read(): Promise<LayoutDocument | null>;
  write(document: LayoutDocument): Promise<void>;
  listPlans(): Promise<string[]>;
  readPlan(id: string): Promise<LayoutDocument | null>;
  writePlan(id: string, document: LayoutDocument): Promise<void>;
  deletePlan(id: string): Promise<void>;
}

export const STORAGE_KEY = 'exposketch.document.v1';
export const PLAN_KEY_PREFIX = 'exposketch.plan.';

const canUseIndexedDb = () => typeof indexedDB !== 'undefined';

export class BrowserStorageService implements DocumentStorageService {
  async read(): Promise<LayoutDocument | null> {
    if (!canUseIndexedDb()) {
      return this.readLocal(STORAGE_KEY);
    }
    return this.withDatabase((store) => this.getKey<LayoutDocument>(store, STORAGE_KEY));
  }

  async write(document: LayoutDocument): Promise<void> {
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
      return;
    }
    await this.withDatabase((store) => this.putKey(store, document, STORAGE_KEY));
  }

  async listPlans(): Promise<string[]> {
    if (!canUseIndexedDb()) {
      return Object.keys(window.localStorage)
        .filter((key) => key.startsWith(PLAN_KEY_PREFIX))
        .map((key) => key.slice(PLAN_KEY_PREFIX.length));
    }
    return this.withDatabase((store) => new Promise<string[]>((resolve, reject) => {
      const request = store.getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[])
        .map((key) => String(key))
        .filter((key) => key.startsWith(PLAN_KEY_PREFIX))
        .map((key) => key.slice(PLAN_KEY_PREFIX.length)));
      request.onerror = () => reject(request.error ?? new Error('读取方案列表失败'));
    }));
  }

  async readPlan(id: string): Promise<LayoutDocument | null> {
    const key = PLAN_KEY_PREFIX + id;
    if (!canUseIndexedDb()) {
      return this.readLocal(key);
    }
    return this.withDatabase((store) => this.getKey<LayoutDocument>(store, key));
  }

  async writePlan(id: string, document: LayoutDocument): Promise<void> {
    const key = PLAN_KEY_PREFIX + id;
    if (!canUseIndexedDb()) {
      window.localStorage.setItem(key, JSON.stringify(document));
      return;
    }
    await this.withDatabase((store) => this.putKey(store, document, key));
  }

  async deletePlan(id: string): Promise<void> {
    const key = PLAN_KEY_PREFIX + id;
    if (!canUseIndexedDb()) {
      window.localStorage.removeItem(key);
      return;
    }
    await this.withDatabase((store) => new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('删除方案失败'));
    }));
  }

  private readLocal(key: string): LayoutDocument | null {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LayoutDocument;
    } catch {
      return null;
    }
  }

  private getKey<T>(store: IDBObjectStore, key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('读取布局失败'));
    });
  }

  private putKey(store: IDBObjectStore, value: unknown, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('保存布局失败'));
    });
  }

  private withDatabase<T>(run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('exposketch-db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onerror = () => reject(request.error ?? new Error('打开本地数据库失败'));
      request.onsuccess = () => {
        const transaction = request.result.transaction('documents', 'readwrite');
        run(transaction.objectStore('documents')).then(resolve).catch(reject);
        transaction.oncomplete = () => request.result.close();
      };
    });
  }
}
