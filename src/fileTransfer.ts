import { buildLayoutExport } from './transfer';
import type { LayoutDocument } from './types';

const sanitizeFileName = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || '未命名方案';

const dateStamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
};

/** 导出当前布局为可再次导入的 JSON 文件。 */
export const downloadLayoutFile = (document: LayoutDocument): string => {
  const payload = JSON.stringify(buildLayoutExport(document), null, 2);
  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const fileName = `${sanitizeFileName(document.title)}-布局-${dateStamp()}.json`;
  triggerDownload(blob, fileName);
  return fileName;
};

export const triggerDownload = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/** 通过隐藏文件选择器读取本地布局文件，取消选择时返回 null。 */
export const pickLayoutFile = (): Promise<{ name: string; text: string } | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => resolve({ name: file.name, text: '' });
      reader.readAsText(file);
    });
    // 用户未选择任何文件直接关闭选择器。
    window.addEventListener('focus', () => window.setTimeout(() => resolve(null), 0), { once: true });
    input.click();
  });
