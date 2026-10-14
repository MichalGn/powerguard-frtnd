import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface ToastMessage {
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<ToastMessage | null>(null);
  private timeoutId: number | null = null;

  showSuccess(message: string, duration = 3000): void {
    this.show('success', message, duration);
  }

  showError(message: string, duration = 4000): void {
    this.show('error', message, duration);
  }

  close(): void {
    if (this.timeoutId !== null) {
      window.clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.current.set(null);
  }

  private show(kind: ToastKind, message: string, duration: number): void {
    this.close();
    this.current.set({ kind, message });
    this.timeoutId = window.setTimeout(() => {
      this.current.set(null);
      this.timeoutId = null;
    }, duration);
  }
}
