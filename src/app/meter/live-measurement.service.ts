import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment.development';

export interface LiveMeasurementMessage {
  messageType: 'meter.live';
  meterId: number;
  clientId: string;
  siteId: string;
  edgeId: string;
  meterUniqueKey: string;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  measuredAt: string;
  currentPowerKw: number | null;
  currentQuarterPowerKw: number | null;
  activeEnergyImportKwh?: number | null;
  activeEnergyExportKwh?: number | null;
  voltageL1V?: number | null;
  voltageL2V?: number | null;
  voltageL3V?: number | null;
  currentL1A?: number | null;
  currentL2A?: number | null;
  currentL3A?: number | null;
  frequencyHz?: number | null;
}

export interface LiveStatusMessage {
  messageType: 'meter.status';
  meterId: number;
  clientId: string;
  siteId: string;
  edgeId: string;
  meterUniqueKey: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  timestamp: string;
}

export type PowerguardLiveMessage = LiveMeasurementMessage | LiveStatusMessage;

@Injectable({ providedIn: 'root' })
export class LiveMeasurementService {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private intentionallyStopped = false;
  private readonly subject = new Subject<PowerguardLiveMessage>();
  readonly messages$ = this.subject.asObservable();

  start(): void { if (this.socket || this.reconnectTimer !== null) return; this.intentionallyStopped = false; this.connect(); }
  stop(): void {
    this.intentionallyStopped = true;
    if (this.reconnectTimer !== null) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.socket) { this.socket.close(); this.socket = null; }
  }
  private connect(): void {
    try {
      const socket = new WebSocket(this.websocketUrl());
      this.socket = socket;
      socket.onmessage = event => {
        try {
          const parsed = JSON.parse(String(event.data)) as PowerguardLiveMessage;
          if (parsed?.messageType === 'meter.live' || parsed?.messageType === 'meter.status') this.subject.next(parsed);
        } catch (error) { console.warn('Invalid PowerGuard WebSocket message', error); }
      };
      socket.onclose = () => { if (this.socket === socket) this.socket = null; this.scheduleReconnect(); };
      socket.onerror = () => socket.close();
    } catch { this.socket = null; this.scheduleReconnect(); }
  }
  private scheduleReconnect(): void {
    if (this.intentionallyStopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 3000);
  }
  private websocketUrl(): string {
    return environment.apiUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/api\/?$/i, '/ws/measurements');
  }
}
