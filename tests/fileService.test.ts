import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStarterDocument } from '../src/domain';
import { BrowserFileService } from '../src/fileService';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('BrowserFileService', () => {
  it('downloads the layout as a JSON file with a safe filename', () => {
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedName = this.download;
    });

    const service = new BrowserFileService();
    let clickedName = '';
    service.downloadLayout(createStarterDocument());

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickedName).toMatch(/^exposketch-.*\.json$/);
    expect(clickedName).toContain('.json');
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('reads the selected JSON file as text', async () => {
    const service = new BrowserFileService();
    const pickPromise = service.pickLayoutFile();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toContain('json');

    const file = new File(['{"version":1}'], 'plan.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await expect(pickPromise).resolves.toEqual({ name: 'plan.json', text: '{"version":1}' });
  });

  it('returns null when no file is chosen', async () => {
    const service = new BrowserFileService();
    const pickPromise = service.pickLayoutFile();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    await expect(pickPromise).resolves.toBeNull();
  });

  it('mounts a hidden iframe with the print document and calls print', async () => {
    const printSpy = vi.fn();
    const originalContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() {
        return {
          focus: () => {},
          print: printSpy,
          onbeforeprint: null,
          onafterprint: null,
        };
      },
    });

    try {
      const service = new BrowserFileService();
      service.printLayout(createStarterDocument());
      const frame = document.getElementById('exposketch-print-frame') as HTMLIFrameElement;
      expect(frame).toBeTruthy();
      expect(frame.getAttribute('aria-hidden')).toBe('true');
      frame.dispatchEvent(new Event('load'));
      expect(printSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (originalContentWindow) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalContentWindow);
    }
  });
});
