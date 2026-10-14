import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';


export interface ClientView {
  id: number;
  clientId: string;
  name: string;
  enabled: boolean;
  displayOrder: number;
}

export interface ClientInput {
  clientId: string;
  name: string;
  enabled: boolean;
}

export interface SiteView {
  id: number;
  clientId: string;
  clientName: string;
  siteId: string;
  name: string;
  enabled: boolean;
  displayOrder: number;
}

export interface SiteInput {
  clientId: string;
  siteId: string;
  name: string;
  enabled: boolean;
}

export interface MeterConfigurationView {
  id: number;
  sitePk: number;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  edgeId: string;
  uniqueKey: string;
  name: string;
  instantaneousAlarmOnKw: number | null;
  instantaneousAlarmOffKw: number | null;
  quarterHourAlarmOnKw: number | null;
  quarterHourAlarmOffKw: number | null;
  enabled: boolean;
  displayOrder: number;
}

export interface MeterConfigurationInput {
  clientId: string;
  siteId: string;
  edgeId: string;
  uniqueKey: string;
  name: string;
  instantaneousAlarmOnKw: number | null;
  instantaneousAlarmOffKw: number | null;
  quarterHourAlarmOnKw: number | null;
  quarterHourAlarmOffKw: number | null;
  enabled: boolean;
}

export interface MeasurementSnapshotView {
  meterId: number;
  meterUniqueKey: string;
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
  lastUpdated: string;
}

export interface MeasurementView {
  id: number;
  meterId: number;
  measuredAt: string;
  meterMeasuredAt?: string | null;
  activePowerKw: number | null;
  activeEnergyImportKwh?: number | null;
  activeEnergyExportKwh?: number | null;
  currentQuarterPowerKw: number | null;
  voltageL1V?: number | null;
  voltageL2V?: number | null;
  voltageL3V?: number | null;
  currentL1A?: number | null;
  currentL2A?: number | null;
  currentL3A?: number | null;
  frequencyHz?: number | null;
}

export interface AlarmView {
  id: number;
  meterId: number;
  type: 'INSTANTANEOUS_POWER' | 'QUARTER_HOUR_POWER';
  startedAt: string;
  endedAt: string | null;
  startValue: number | null;
  maxValue: number | null;
  active: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledged: boolean;
}

export interface EdgeMqttHealthView {
  brokerUri: string;
  connected: boolean | null;
  publishSuccess: number | null;
  publishErrors: number | null;
}

export interface EdgeMeterHealthView {
  meterId: string;
  serialPortName: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'STARTING';
  lastStatusAt: string | null;
  consecutiveFailures: number | null;
  lastReadDurationMs: number | null;
  message: string | null;
}

export interface CommunicationStatusView {
  clientId: string;
  siteId: string;
  edgeId: string;
  meterUniqueKey: string | null;
  entityType: 'SERVER' | 'EDGE' | 'METER';
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'STARTING';
  observedAt: string;
}

export interface EdgeHealthView {
  clientId: string;
  siteId: string;
  edgeId: string;
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  timestamp: string;
  edgeStartedAt: string | null;
  uptimeSeconds: number | null;
  systemUptimeSeconds: number | null;
  cpuLoadPercent: number | null;
  cpuTemperatureC: number | null;
  memoryUsedPercent: number | null;
  memoryTotalBytes: number | null;
  memoryFreeBytes: number | null;
  diskUsedPercent: number | null;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  hostname: string | null;
  ipAddresses: string[];
  version: string | null;
  serialPorts: string[];
  mqttTargets: EdgeMqttHealthView[];
  meters: EdgeMeterHealthView[];
}

export interface EdgeMqttTargetConfig {
  enabled: boolean;
  serverIp: string;
  port: number;
  username: string;
  password?: string;
  passwordConfigured?: boolean;
  qos: number;
  retainStatus: boolean;
}

export interface EdgeMeterConfig {
  enabled: boolean;
  serialPortName: string;
  uniqueName: string;
  address: string;
  pollDelaySeconds: number;
}

export interface EdgeConfigurationView {
  clientId: string;
  siteId: string;
  edgeId: string;
  timeZone: string;
  includeRawObis: boolean;
  mqttTargets: EdgeMqttTargetConfig[];
  meters: EdgeMeterConfig[];
}

export interface EdgeRawMeasurementView {
  clientId: string;
  siteId: string;
  edgeId: string;
  meterUniqueKey: string;
  receivedAt: string;
  measuredAt: string | null;
  meterTimestamp: string | null;
  meterInfo: {
    serialPortName?: string | null;
    protocol?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    negotiatedBaudRate?: number | null;
    [key: string]: unknown;
  };
  quality: {
    readDurationMs?: number | null;
    bccValid?: boolean | null;
    [key: string]: unknown;
  };
  rawObis: Record<string, unknown> | unknown[];
}

@Injectable({ providedIn: 'root' })
export class MeterService {
  private readonly http = inject(HttpClient);
  private readonly metersUrl = `${environment.apiUrl}meters`;
  private readonly measurementsUrl = `${environment.apiUrl}measurements`;
  private readonly alarmsUrl = `${environment.apiUrl}alarms`;
  private readonly systemUrl = `${environment.apiUrl}system`;
  private readonly sitesUrl = `${environment.apiUrl}sites`;
  private readonly clientsUrl = `${environment.apiUrl}clients`;

  listPublic(): Observable<MeterConfigurationView[]> { return this.http.get<MeterConfigurationView[]>(this.metersUrl, { headers: this.authHeaders() }); }
  listPublicClients(): Observable<ClientView[]> { return this.http.get<ClientView[]>(this.clientsUrl, { headers: this.authHeaders() }); }
  listAllClients(): Observable<ClientView[]> { return this.http.get<ClientView[]>(`${this.clientsUrl}/admin`, { headers: this.authHeaders() }); }
  createClient(input: ClientInput): Observable<ClientView> { return this.http.post<ClientView>(this.clientsUrl, input, { headers: this.authHeaders() }); }
  updateClient(clientId: string, input: ClientInput): Observable<ClientView> { return this.http.put<ClientView>(`${this.clientsUrl}/${encodeURIComponent(clientId)}`, input, { headers: this.authHeaders() }); }
  deleteClient(clientId: string): Observable<void> { return this.http.delete<void>(`${this.clientsUrl}/${encodeURIComponent(clientId)}`, { headers: this.authHeaders() }); }
  listPublicSites(): Observable<SiteView[]> { return this.http.get<SiteView[]>(this.sitesUrl, { headers: this.authHeaders() }); }
  listAssignableSites(): Observable<SiteView[]> { return this.http.get<SiteView[]>(`${this.sitesUrl}/assignable`, { headers: this.authHeaders() }); }
  listAllSites(): Observable<SiteView[]> { return this.http.get<SiteView[]>(`${this.sitesUrl}/admin`, { headers: this.authHeaders() }); }
  createSite(input: SiteInput): Observable<SiteView> { return this.http.post<SiteView>(this.sitesUrl, input, { headers: this.authHeaders() }); }
  updateSite(clientId: string, siteId: string, input: SiteInput): Observable<SiteView> { return this.http.put<SiteView>(`${this.sitesUrl}/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}`, input, { headers: this.authHeaders() }); }
  deleteSite(clientId: string, siteId: string): Observable<void> { return this.http.delete<void>(`${this.sitesUrl}/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}`, { headers: this.authHeaders() }); }
  listAll(): Observable<MeterConfigurationView[]> { return this.http.get<MeterConfigurationView[]>(`${this.metersUrl}/admin`, { headers: this.authHeaders() }); }
  create(input: MeterConfigurationInput): Observable<MeterConfigurationView> { return this.http.post<MeterConfigurationView>(this.metersUrl, input, { headers: this.authHeaders() }); }
  update(id: number, input: MeterConfigurationInput): Observable<MeterConfigurationView> { return this.http.put<MeterConfigurationView>(`${this.metersUrl}/${id}`, input, { headers: this.authHeaders() }); }
  moveUp(id: number): Observable<void> { return this.http.put<void>(`${this.metersUrl}/${id}/move-up`, null, { headers: this.authHeaders() }); }
  moveDown(id: number): Observable<void> { return this.http.put<void>(`${this.metersUrl}/${id}/move-down`, null, { headers: this.authHeaders() }); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.metersUrl}/${id}`, { headers: this.authHeaders() }); }
  latestMeasurement(meterId: number): Observable<MeasurementSnapshotView | null> { return this.http.get<MeasurementSnapshotView>(`${this.measurementsUrl}/latest/${meterId}`, { headers: this.authHeaders() }); }
  dayMeasurements(meterId: number, date: string): Observable<MeasurementView[]> { return this.http.get<MeasurementView[]>(`${this.measurementsUrl}/day/${meterId}`, { params: { date }, headers: this.authHeaders() }); }
  rangeMeasurements(meterId: number, from: string, to: string): Observable<MeasurementView[]> { return this.http.get<MeasurementView[]>(`${this.measurementsUrl}/range/${meterId}`, { params: { from, to }, headers: this.authHeaders() }); }
  dayAlarms(meterId: number, date: string): Observable<AlarmView[]> { return this.http.get<AlarmView[]>(`${this.alarmsUrl}/day/${meterId}`, { params: { date }, headers: this.authHeaders() }); }
  rangeAlarms(meterId: number, from: string, to: string): Observable<AlarmView[]> { return this.http.get<AlarmView[]>(`${this.alarmsUrl}/range/${meterId}`, { params: { from, to }, headers: this.authHeaders() }); }
  activeAlarms(meterId: number): Observable<AlarmView[]> { return this.http.get<AlarmView[]>(`${this.alarmsUrl}/active/${meterId}`, { headers: this.authHeaders() }); }
  acknowledgeAlarm(alarmId: number, acknowledgedBy: string): Observable<AlarmView> { const headers = this.authHeaders().set('Content-Type', 'text/plain'); return this.http.put<AlarmView>(`${this.alarmsUrl}/${alarmId}/acknowledge`, acknowledgedBy || 'dashboard', { headers }); }

  backendVersion(): Observable<{ backendVersion: string }> {
    return this.http.get<{ backendVersion: string }>(`${this.systemUrl}/version`);
  }

  edgeHealth(): Observable<EdgeHealthView[]> {
    return this.http.get<EdgeHealthView[]>(`${this.systemUrl}/edges`, { headers: this.authHeaders() });
  }
  communicationHistory(clientId: string, siteId: string, edgeId: string, meterId: string, from: string, to: string): Observable<CommunicationStatusView[]> {
    return this.http.get<CommunicationStatusView[]>(
      `${this.systemUrl}/communication/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}/${encodeURIComponent(edgeId)}`,
      { params: { meterId, from, to }, headers: this.authHeaders() }
    );
  }


  deleteEdgeHealth(clientId: string, siteId: string, edgeId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.systemUrl}/edges/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}/${encodeURIComponent(edgeId)}`,
      { headers: this.authHeaders() }
    );
  }

  edgeConfiguration(clientId: string, siteId: string, edgeId: string): Observable<EdgeConfigurationView> {
    return this.http.get<EdgeConfigurationView>(
      `${this.systemUrl}/edges/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}/${encodeURIComponent(edgeId)}/config`,
      { headers: this.authHeaders() }
    );
  }

  updateEdgeConfiguration(clientId: string, currentSiteId: string, currentEdgeId: string, input: EdgeConfigurationView): Observable<EdgeConfigurationView> {
    return this.http.put<EdgeConfigurationView>(
      `${this.systemUrl}/edges/${encodeURIComponent(clientId)}/${encodeURIComponent(currentSiteId)}/${encodeURIComponent(currentEdgeId)}/config`,
      input,
      { headers: this.authHeaders() }
    );
  }

  edgeRawMeasurements(clientId: string, siteId: string, edgeId: string): Observable<EdgeRawMeasurementView[]> {
    return this.http.get<EdgeRawMeasurementView[]>(
      `${this.systemUrl}/edges/${encodeURIComponent(clientId)}/${encodeURIComponent(siteId)}/${encodeURIComponent(edgeId)}/measurement-data`,
      { headers: this.authHeaders() }
    );
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('powerguard-token') || '';
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
