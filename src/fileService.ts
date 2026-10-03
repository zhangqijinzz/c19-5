import { buildPrintModel, serializeTransferFile, suggestTransferFileName } from './transfer';
import { buildPrintHtml } from './printLayout';
import type { LayoutDocument } from './types';

export interface PickedLayoutFile {
  name: string;
  text: string;
}

export interface FilePickerService {
  /** 打开文件选择框并读回用户选择的文件；取消选择时返回 null */
  pickLayoutFile(): Promise<PickedLayoutFile | null>;
}

export class BrowserFileService implements FilePickerService {
  downloadLayout(layout: LayoutDocument): void {
    const blob = new Blob([serializeTransferFile(layout)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = suggestTransferFileName(layout);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 给浏览器一点时间开始下载后再释放
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async pickLayoutFile(): Promise<PickedLayoutFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? { name: file.name, text: reader.result } : null);
        reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
        reader.readAsText(file);
      };
      input.oncancel = () => resolve(null);
      document.body.appendChild(input);
      input.click();
      setTimeout(() => input.remove(), 60_000);
    });
  }

  /** 在隐藏 iframe 中加载打印图纸并调起浏览器打印对话框 */
  printLayout(layout: LayoutDocument): void {
    const html = buildPrintHtml(buildPrintModel(layout));
    const existing = document.getElementById('exposketch-print-frame') as HTMLIFrameElement | null;
    existing?.remove();

    const frame = document.createElement('iframe');
    frame.id = 'exposketch-print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';

    const cleanup = () => {
      try { frame.remove(); } catch { /* 已移除时忽略 */ }
    };

    frame.onload = () => {
      const contentWindow = frame.contentWindow;
      if (!contentWindow) {
        cleanup();
        return;
      }
      contentWindow.onbeforeprint = () => {};
      contentWindow.onafterprint = cleanup;
      contentWindow.focus();
      contentWindow.print();
      // 某些浏览器不触发 afterprint，兜底稍后清理
      setTimeout(cleanup, 60_000);
    };

    document.body.appendChild(frame);
    frame.srcdoc = html;
  }
}