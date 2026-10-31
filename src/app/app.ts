import { Component, OnDestroy, inject } from '@angular/core';
import { forkJoin, Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { AuthService, ManagedUserInput, UserRole, UserView } from './auth/auth.service';
import { ToastService } from './shared/toast/toast.service';
import { AlarmView, CommunicationStatusView, EdgeConfigurationView, EdgeHealthView, EdgeMeterConfig, EdgeMeterHealthView, EdgeMqttTargetConfig, EdgeRawMeasurementView, ClientInput, ClientView, MeterConfigurationInput, MeterConfigurationView, MeterService, MeasurementSnapshotView, MeasurementView, SiteInput, SiteView } from './meter/meter.service';
import { LiveMeasurementService, PowerguardLiveMessage } from './meter/live-measurement.service';
import { TranslationService, Language } from './shared/i18n/translation.service';
import { environment } from '../environments/environment.development';
import { POWERGUARD_FRONTEND_VERSION } from './build-info';
import { ApplicationSettingsView, SettingsService } from './settings/settings.service';

interface BarPoint {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  label: string;
  intervalLabel: string;
  current: boolean;
  projectedValue?: number;
  projectedY?: number;
  projectedHeight?: number;
  showLabel: boolean;
}

interface AxisTick {
  value: number;
  y: number;
}

interface LineHoverPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

interface CommunicationSegment {
  left: number;
  width: number;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'STARTING' | 'UNKNOWN' | 'FUTURE';
}

interface TimeStatusSegment {
  from: number;
  to: number;
  status: CommunicationSegment['status'];
}

interface RawObisRow {
  code: string;
  value: string;
  unit: string;
  raw: string;
}

interface MeterCard {
  id: string;
  meterId: number;
  name: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  edgeId: string;
  uniqueKey: string;
  chartView: 'power' | 'network' | 'alarms';
  detailsCollapsed: boolean;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE';
  currentPowerKw: number | null;
  currentQuarterPowerKw: number | null;
  voltageL1V: number | null;
  voltageL2V: number | null;
  voltageL3V: number | null;
  currentL1A: number | null;
  currentL2A: number | null;
  currentL3A: number | null;
  frequencyHz: number | null;
  dayMeasurements: MeasurementView[];
  voltageL1Points: string;
  voltageL2Points: string;
  voltageL3Points: string;
  currentL1Points: string;
  currentL2Points: string;
  currentL3Points: string;
  powerPoints: string;
  frequencyPoints: string;
  powerSegments: string[];
  voltageL1Segments: string[];
  voltageL2Segments: string[];
  voltageL3Segments: string[];
  currentL1Segments: string[];
  currentL2Segments: string[];
  currentL3Segments: string[];
  frequencySegments: string[];
  networkHover?: { chart: string; text: string; x: number };
  powerRange: string;
  voltageRange: string;
  currentRange: string;
  frequencyRange: string;
  serverCommunicationSegments: CommunicationSegment[];
  edgeCommunicationSegments: CommunicationSegment[];
  meterCommunicationSegments: CommunicationSegment[];
  communicationSamples: CommunicationStatusView[];
  quarterProgress: number;
  lastUpdated: string;
  lastReadingAt: string;
  maxKw: number;
  linePoints: string;
  lineSegments: string[];
  lineHoverPoints: LineHoverPoint[];
  chartZoomStartMs: number | null;
  chartZoomEndMs: number | null;
  chartPanActive: boolean;
  chartPanPointerId: number | null;
  chartPanStartClientX: number;
  chartPanStartMs: number;
  chartPanEndMs: number;
  bars: BarPoint[];
  yTicks: AxisTick[];
  history: Array<number | null>;
  completedQuarterPowers: Array<number | null>;
  quarterTargetKw: number;
  quarterIndex: number;
  limitKw: number | null;
  limitY: number;
  instantaneousAlarmOnKw: number | null;
  instantaneousAlarmOffKw: number | null;
  quarterHourAlarmOnKw: number | null;
  quarterHourAlarmOffKw: number | null;
  alarmHistory: AlarmView[];
  activeAlarms: AlarmView[];
  alarmAckBusy: boolean;
  showInstantPower: boolean;
  showQuarterBars: boolean;
  showLimit: boolean;
}

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  readonly frontendVersion = POWERGUARD_FRONTEND_VERSION;
  private readonly authService = inject(AuthService);
  readonly toast = inject(ToastService);
  private readonly meterService = inject(MeterService);
  private readonly liveMeasurements = inject(LiveMeasurementService);
  private readonly settingsService = inject(SettingsService);
  private readonly liveSubscription: Subscription;

  private readonly i18n = inject(TranslationService);

  // Language preference and translations are managed by TranslationService.
  get language(): Language { return this.i18n.language; }
  languageMenuOpen = false;
  soundMenuOpen = false;
  infoOpen = false;
  alarmVolume = this.loadAlarmVolume();
  private lastAudibleAlarmVolume = this.loadLastAudibleAlarmVolume();
  selectedDateFrom = this.toDateInputValue(new Date());
  selectedDateTo = this.toDateInputValue(new Date());
  selectedQuickRangeMinutes: 60 | 120 | 240 | 480 | 1440 | null = null;
  selectedClientId = localStorage.getItem('powerguard-client-id') || '';
  selectedSiteId = localStorage.getItem('powerguard-site-id') || '';
  readonly timeZoneOptions = this.buildTimeZoneOptions();
  backendVersion = '—';
  applicationSettings: ApplicationSettingsView = this.emptyApplicationSettings();
  settingsBusy = false;
  settingsError = '';
  settingsCompanyName = '';
  settingsInstallationName = '';
  settingsAddress = '';
  settingsNip = '';
  settingsEmail = '';
  settingsPhone = '';
  settingsContactPerson = '';

  loginOpen = false;
  loginUsername = '';
  loginPassword = '';
  loginBusy = false;
  loginError = '';
  authenticated = false; // A stored token is not authenticated until /users/me succeeds.
  private sessionValidated = false;
  authenticatedUsername = localStorage.getItem('powerguard-username') || '';
  authenticatedUserId = Number(localStorage.getItem('powerguard-user-id') || 0);
  authenticatedRole: UserRole = this.readStoredUserRole();
  authenticatedFirstname = localStorage.getItem('powerguard-firstname') || '';
  authenticatedLastname = localStorage.getItem('powerguard-lastname') || '';

  profileOpen = false;
  profileBusy = false;
  profileError = '';
  profileUsername = '';
  profileFirstname = '';
  profileLastname = '';
  profileEmail = '';
  profilePhone = '';
  profilePassword = '';
  profilePasswordConfirm = '';

  alarmEditorMeter: MeterConfigurationView | null = null;
  alarmEditorBusy = false;
  alarmEditorError = '';
  alarmInstantOn: number | null = null;
  alarmInstantOff: number | null = null;
  alarmQuarterOn: number | null = null;
  alarmQuarterOff: number | null = null;

  openDashboardAlarms(meter: MeterCard): void {
    if (this.authenticatedRole === 'USER') return;
    const config = this.configuredMeters.find(m => m.id === meter.meterId && m.clientId === meter.clientId && m.siteId === meter.siteId);
    if (!config) {
      this.toast.showError(this.language === 'pl' ? 'Nie znaleziono konfiguracji licznika. Odśwież stronę.' : 'Meter configuration is not available. Refresh the page.');
      this.loadConfiguredMeters();
      return;
    }
    this.alarmEditorMeter = config;
    this.alarmInstantOn = config.instantaneousAlarmOnKw;
    this.alarmInstantOff = config.instantaneousAlarmOffKw;
    this.alarmQuarterOn = config.quarterHourAlarmOnKw;
    this.alarmQuarterOff = config.quarterHourAlarmOffKw;
    this.alarmEditorError = '';
  }

  closeDashboardAlarms(): void {
    if (!this.alarmEditorBusy) this.alarmEditorMeter = null;
  }

  saveDashboardAlarms(): void {
    const meter = this.alarmEditorMeter;
    if (!meter || this.alarmEditorBusy || this.authenticatedRole === 'USER') return;
    const input = {
      instantaneousAlarmOnKw: this.normalizedAlarm(this.alarmInstantOn),
      instantaneousAlarmOffKw: this.normalizedAlarm(this.alarmInstantOff),
      quarterHourAlarmOnKw: this.normalizedAlarm(this.alarmQuarterOn),
      quarterHourAlarmOffKw: this.normalizedAlarm(this.alarmQuarterOff)
    };
    if (!this.validHysteresis(input.instantaneousAlarmOnKw, input.instantaneousAlarmOffKw)
      || !this.validHysteresis(input.quarterHourAlarmOnKw, input.quarterHourAlarmOffKw)) {
      this.alarmEditorError = this.t('hysteresisHint');
      return;
    }
    this.alarmEditorBusy = true;
    this.alarmEditorError = '';
    this.meterService.updateAlarmThresholds(meter.id, input).subscribe({
      next: () => {
        this.alarmEditorBusy = false;
        this.alarmEditorMeter = null;
        this.toast.showSuccess(this.t('meterSaved'));
        this.loadConfiguredMeters();
        this.loadPublicMeters();
      },
      error: error => {
        this.alarmEditorBusy = false;
        this.alarmEditorError = error?.error?.message || this.t('meterSaveFailed');
        this.toast.showError(this.alarmEditorError);
        if (error?.status === 401) this.clearAuthentication();
      }
    });
  }

  usersOpen = false;
  usersBusy = false;
  usersError = '';
  users: UserView[] = [];
  deviceAutoLoginEnabled = false;
  deviceAutoLoginBusy = false;
  deviceAutoLoginMessage = '';
  editingUserId: number | null = null;
  managedUsername = '';
  managedFirstname = '';
  managedLastname = '';
  managedEmail = '';
  managedPhone = '';
  managedPassword = '';
  managedPasswordConfirm = '';
  managedRole: UserRole = 'USER';
  managedEnabled = true;
  managedSiteIds: number[] = [];
  assignableSites: SiteView[] = [];


  clients: ClientView[] = [];
  adminClients: ClientView[] = [];
  clientsBusy = false;
  clientsError = '';
  editingClientId: string | null = null;
  clientFormId = '';
  clientFormName = '';
  clientFormEnabled = true;

  sites: SiteView[] = [];
  adminSites: SiteView[] = [];
  sitesBusy = false;
  sitesError = '';
  editingSiteId: string | null = null;
  siteFormClientId = '';
  siteFormId = '';
  siteFormName = '';
  siteFormEnabled = true;

  meters: MeterCard[] = [];
  configuredMeters: MeterConfigurationView[] = [];
  metersBusy = false;
  metersError = '';
  editingMeterId: number | null = null;
  meterClientId = 'local';
  meterSiteId = 'local';
  meterEdgeId = 'powerguard-edge';
  meterUniqueName = 'meter-001';
  meterName = '';
  meterInstantaneousAlarmOnKw: number | null = null;
  meterInstantaneousAlarmOffKw: number | null = null;
  meterQuarterHourAlarmOnKw: number | null = null;
  meterQuarterHourAlarmOffKw: number | null = null;
  meterEnabled = true;

  meterFilterClient = '';
  meterFilterSite = '';
  meterFilterEdge = '';
  meterFilterStatus: 'all' | 'enabled' | 'disabled' = 'all';
  meterFilterText = '';
  meterSortField: 'displayOrder' | 'siteId' | 'edgeId' | 'uniqueKey' | 'name' | 'instantaneousAlarmOnKw' | 'quarterHourAlarmOnKw' | 'enabled' = 'displayOrder';
  meterSortDirection: 'asc' | 'desc' = 'asc';
  adminView: 'dashboard' | 'health' | 'sites' | 'edgeConfiguration' | 'jsonData' | 'measurementData' | 'historyCleanup' | 'configuration' | 'settings' = 'dashboard';
  edgeHealth: EdgeHealthView[] = [];
  expandedEdgeKey: string | null = null;
  expandedMeterId: string | null = null;
  dashboardLayout: 'auto' | 'one' | 'two' = 'auto';

  private readDashboardLayout(): 'auto' | 'one' | 'two' {
    return 'auto';
  }

  setDashboardLayout(_layout: 'auto' | 'one' | 'two'): void {
    this.dashboardLayout = 'auto';
    localStorage.removeItem('powerguard-dashboard-layout');
  }

  selectedEdgeConfigKey = '';
  edgeConfiguration: EdgeConfigurationView | null = null;
  edgeConfigurationBusy = false;
  edgeConfigurationError = '';
  rawMeasurementData: EdgeRawMeasurementView[] = [];
  rawMeasurementDataBusy = false;
  rawMeasurementDataError = '';
  selectedRawMeterKey = '';
  private alarmAudio: HTMLAudioElement | null = null;

  now = new Date();
  // Live values come from the backend WebSocket. REST latest is initial/fallback data.
  private readonly timerId = window.setInterval(() => { if (this.sessionValidated) this.refreshMeasurements(); }, 30000);
  private readonly historyTimerId = window.setInterval(() => {
    if (this.sessionValidated && this.rangeIncludesToday()) this.meters.forEach(meter => this.loadRange(meter, true));
  }, 60000);
  private readonly clockTimerId = window.setInterval(() => this.tickClock(), 1000);
  private readonly alarmTimerId = window.setInterval(() => { if (this.sessionValidated) this.refreshAllActiveAlarms(); }, 4000);
  private readonly healthTimerId = window.setInterval(() => { if (this.authenticated) this.loadEdgeHealth(); }, 10000);
  private readonly rawMeasurementTimerId = window.setInterval(() => {
    if (this.authenticated && (this.adminView === 'measurementData' || this.adminView === 'jsonData')) this.loadRawMeasurementData(false);
  }, 3000);

  constructor() {
    console.info(`PowerGuard Frontend ${this.frontendVersion}`);
    this.liveSubscription = this.liveMeasurements.messages$.subscribe(message => this.applyLiveMessage(message));
    // WebSocket disabled until per-session site authorization is implemented.
    // 30-second authenticated REST refresh remains operational.
    // Load private tenant data only after /users/me validates the stored credential.
    this.loadBackendVersion();
    // Installation policy takes precedence over a previous browser session.
    // A temporary account-switch bypass is kept in sessionStorage, not localStorage.
    if (sessionStorage.getItem('powerguard-manual-account-switch') === '1') {
      this.clearAuthentication();
    } else {
      this.authService.getInstallationAutoLogin().subscribe({
        next: status => {
          if (status.enabled) {
            this.clearAuthentication();
            this.authService.exchangeInstallationAutoLogin().subscribe({
              next: response => {
                if (!response.authenticated || !response.token) return;
                localStorage.setItem('powerguard-token', response.token);
                this.installationDefaultSession = true;
                this.applyAuthenticatedUser(response);
                this.adminView = 'dashboard';
                this.activateDashboardSession(response.role);
              },
              error: () => this.clearAuthentication(),
            });
          } else {
            this.restoreExistingSession();
          }
        },
        error: () => this.restoreExistingSession(),
      });
    }
  }

  private restoreExistingSession(): void {
    // Ignore deprecated per-browser auto-login credentials.
    localStorage.removeItem('powerguard-device-token');
    localStorage.removeItem('powerguard-auto-user');
    if (!localStorage.getItem('powerguard-token')) return;
    this.authService.me().subscribe({
      next: user => { this.applyAuthenticatedUser(user); this.activateDashboardSession(user.role); },
      error: () => this.clearAuthentication(),
    });
  }

  private installationDefaultSession = false;
  autoLoginDefaultUserId = 0;
  autoLoginConfiguredUserId = 0;
  autoLoginConfigurationBusy = false;
  autoLoginConfigurationError = '';

  saveInstallationAutoLogin(): void {
    if ((this.authenticatedRole !== 'ADMIN' && this.authenticatedRole !== 'SERVICE') || this.autoLoginConfigurationBusy) return;
    this.autoLoginConfigurationBusy = true;
    this.autoLoginConfigurationError = '';
    this.authService.configureInstallationAutoLogin(this.autoLoginDefaultUserId || null).subscribe({
      next: result => {
        this.autoLoginConfiguredUserId = result.userId;
        this.autoLoginConfigurationBusy = false;
        this.toast.showSuccess(this.language === 'pl' ? 'Zapisano automatyczne logowanie.' : 'Automatic login saved.');
      },
      error: err => {
        this.autoLoginConfigurationBusy = false;
        this.autoLoginConfigurationError = err?.error?.message || 'Failed to save automatic login.';
      },
    });
  }

  /** Temporarily switch accounts without changing installation-wide default. */
  switchAccount(): void {
    sessionStorage.setItem('powerguard-manual-account-switch', '1');
    this.authService.logout().subscribe({error: () => undefined});
    this.clearAuthentication();
    this.openLogin();
  }

  t(key: string): string {
    if (key === 'quarterEnergy') return this.language === 'pl' ? 'Energia w kwadransie' : '15-minute energy';
    return this.i18n.t(key);
  }

  toggleLanguageMenu(): void {
    this.soundMenuOpen = false;
    this.infoOpen = false;
    this.languageMenuOpen = !this.languageMenuOpen;
  }

  toggleSoundMenu(): void {
    this.languageMenuOpen = false;
    this.infoOpen = false;
    this.soundMenuOpen = !this.soundMenuOpen;
  }

  openInfo(): void {
    this.soundMenuOpen = false;
    this.languageMenuOpen = false;
    this.infoOpen = true;
  }

  closeInfo(): void {
    this.infoOpen = false;
  }

  infoTitle(): string {
    return this.language === 'pl' ? 'Informacje' : 'Information';
  }

  frontendVersionLabel(): string {
    return this.language === 'pl' ? 'Wersja FE' : 'FE version';
  }

  backendVersionLabel(): string {
    return this.language === 'pl' ? 'Wersja BE' : 'BE version';
  }

  edgeVersionLabel(): string {
    return this.language === 'pl' ? 'Wersja Edge' : 'Edge version';
  }

  endUserLabel(): string {
    return this.language === 'pl' ? 'Użytkownik końcowy' : 'End user';
  }

  publicDashboardLabel(): string {
    return this.language === 'pl' ? 'Dostęp publiczny' : 'Public access';
  }

  signedInUserDisplay(): string {
    const fullName = `${this.authenticatedFirstname} ${this.authenticatedLastname}`.trim();
    return fullName || this.authenticatedUsername || this.publicDashboardLabel();
  }

  setAlarmVolume(value: number | string): void {
    const parsed = typeof value === 'number' ? value : Number(value);
    this.alarmVolume = Math.max(0, Math.min(100, Number.isFinite(parsed) ? parsed : 75));
    localStorage.setItem('powerguard-alarm-volume', String(this.alarmVolume));
    if (this.alarmVolume > 0) {
      this.lastAudibleAlarmVolume = this.alarmVolume;
      localStorage.setItem('powerguard-alarm-last-audible-volume', String(this.lastAudibleAlarmVolume));
    }
    if (this.alarmAudio) this.alarmAudio.volume = this.alarmVolume / 100;
  }

  changeAlarmVolume(delta: number): void {
    this.setAlarmVolume(this.alarmVolume + delta);
  }

  toggleAlarmMute(): void {
    if (this.alarmVolume > 0) {
      this.lastAudibleAlarmVolume = this.alarmVolume;
      localStorage.setItem('powerguard-alarm-last-audible-volume', String(this.lastAudibleAlarmVolume));
      this.setAlarmVolume(0);
    } else {
      this.setAlarmVolume(this.lastAudibleAlarmVolume > 0 ? this.lastAudibleAlarmVolume : 75);
    }
  }

  alarmMuteLabel(): string {
    if (this.alarmVolume > 0) return this.language === 'pl' ? 'Wycisz alarm' : 'Mute alarm';
    return this.language === 'pl' ? 'Włącz dźwięk alarmu' : 'Restore alarm sound';
  }

  testAlarmSound(): void {
    const testAudio = new Audio('alarm.wav');
    testAudio.volume = this.alarmVolume / 100;
    testAudio.play().catch(() => undefined);
    window.setTimeout(() => {
      testAudio.pause();
      testAudio.currentTime = 0;
    }, 1800);
  }

  soundLabel(): string {
    return this.language === 'pl' ? 'Głośność alarmu' : 'Alarm volume';
  }

  quieterLabel(): string {
    return this.language === 'pl' ? 'Ciszej' : 'Quieter';
  }

  louderLabel(): string {
    return this.language === 'pl' ? 'Głośniej' : 'Louder';
  }

  testSoundLabel(): string {
    return this.language === 'pl' ? 'Test dźwięku' : 'Test sound';
  }

  private loadAlarmVolume(): number {
    const saved = Number(localStorage.getItem('powerguard-alarm-volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 75;
  }


  private loadLastAudibleAlarmVolume(): number {
    const saved = Number(localStorage.getItem('powerguard-alarm-last-audible-volume'));
    if (Number.isFinite(saved) && saved > 0 && saved <= 100) return saved;
    const current = this.loadAlarmVolume();
    return current > 0 ? current : 75;
  }

  setLanguage(language: Language): void {
    this.languageMenuOpen = false;
    this.i18n.setLanguage(language);
  }


  statusLabel(status: 'ONLINE' | 'WARNING' | 'ALARM' | 'OFFLINE'): string {
    switch (status) {
      case 'ALARM':
        return this.language === 'pl' ? 'ALARM' : 'ALARM';
      case 'WARNING':
        return this.t('warning');
      case 'OFFLINE':
        return this.t('offline');
      default:
        return this.t('online');
    }
  }

  meterHeaderStatus(meter: MeterCard): 'ONLINE' | 'WARNING' | 'ALARM' | 'OFFLINE' {
    if (meter.status === 'OFFLINE') return 'OFFLINE';
    if (meter.activeAlarms.length > 0) return 'ALARM';
    if (meter.status === 'WARNING' || this.hasQuarterHourPredictionWarning(meter)) return 'WARNING';
    return 'ONLINE';
  }

  projectedQuarterFinalPowerKw(meter: MeterCard): number | null {
    if (meter.currentQuarterPowerKw == null || meter.currentPowerKw == null) return null;
    const remainingSeconds = Math.max(0, this.quarterSecondsRemaining(this.now));
    // currentQuarterPowerKw is accumulated quarter energy converted to kW-equivalent (energy * 4).
    // If the present instantaneous power is maintained, its remaining contribution is P * remaining/900.
    return meter.currentQuarterPowerKw + Math.max(0, meter.currentPowerKw) * (remainingSeconds / 900);
  }

  hasQuarterHourPredictionWarning(meter: MeterCard): boolean {
    if (meter.quarterHourAlarmOnKw == null || meter.activeAlarms.some(a => a.type === 'QUARTER_HOUR_POWER')) return false;
    const projected = this.projectedQuarterFinalPowerKw(meter);
    return projected != null && meter.currentQuarterPowerKw != null
      && meter.currentQuarterPowerKw < meter.quarterHourAlarmOnKw
      && projected >= meter.quarterHourAlarmOnKw;
  }

  onDateChanged(): void {
    this.selectedRangePreset = 'custom';
    this.selectedQuickRangeMinutes = null;
    if (this.selectedDateFrom > this.selectedDateTo) this.selectedDateTo = this.selectedDateFrom;
    const today = this.todayInputMax();
    if (this.selectedDateTo > today) this.selectedDateTo = today;
    if (this.selectedDateFrom > this.selectedDateTo) this.selectedDateFrom = this.selectedDateTo;
    const from = this.selectedDateFromAsLocalDate(), to = this.selectedDateToAsLocalDate();
    if (Math.round((to.getTime() - from.getTime()) / 86400000) > 29) {
      from.setDate(to.getDate() - 29);
      this.selectedDateFrom = this.toDateInputValue(from);
    }
    this.meters.forEach(meter => {
      meter.chartZoomStartMs = null;
      meter.chartZoomEndMs = null;
      this.loadRange(meter);
    });
  }

  selectedRangePreset = 'custom';

  selectRangePreset(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'today') {
      this.selectToday();
    } else if (value === '3d' || value === '7d' || value === '30d') {
      this.setRangeDays(Number(value.slice(0, -1)));
    } else if (value !== 'custom') {
      const minutes = Number(value);
      if ([60, 120, 240, 480, 1440].includes(minutes)) {
        this.setRangeMinutes(minutes as 60 | 120 | 240 | 480 | 1440);
      }
    }
  }

  setRangeMinutes(minutes: 60 | 120 | 240 | 480 | 1440): void {
    const now = new Date();
    const from = new Date(now.getTime() - minutes * 60_000);

    // Load every calendar day touched by the rolling range. This is required
    // for the 1d window and for shorter windows just after midnight.
    this.selectedDateFrom = this.toDateInputValue(from);
    this.selectedDateTo = this.toDateInputValue(now);

    this.onDateChanged();
    this.selectedQuickRangeMinutes = minutes;
    this.selectedRangePreset = String(minutes);
    this.updateRollingQuickRange();
  }

  private updateRollingQuickRange(nowMs = Date.now()): void {
    if (this.selectedQuickRangeMinutes == null) return;

    // Roll in discrete 15-minute steps, never continuously with each second.
    // At 11:58 end=12:00; at exactly 12:00 end=12:15.
    const quarterMs = 15 * 60_000;
    const end = (Math.floor(nowMs / quarterMs) + 1) * quarterMs;
    const start = end - this.selectedQuickRangeMinutes * 60_000;

    const fromDate = this.toDateInputValue(new Date(start));
    const toDate = this.toDateInputValue(new Date(nowMs));
    if (fromDate !== this.selectedDateFrom || toDate !== this.selectedDateTo) {
      this.selectedDateFrom = fromDate;
      this.selectedDateTo = toDate;
      this.meters.forEach(meter => this.loadRange(meter, true));
    }

    this.meters.forEach(meter => {
      meter.chartZoomStartMs = start;
      meter.chartZoomEndMs = end;
      this.rebuildMeter(meter, new Date(nowMs));
      this.rebuildAllCommunicationDiagnostics();
      this.rebuildNetworkCharts(meter);
    });
  }

  setRangeDays(days: number): void {
    this.selectedQuickRangeMinutes = null;
    this.selectedRangePreset = `${days}d`;
    const to = new Date(); to.setHours(12, 0, 0, 0);
    const from = new Date(to); from.setDate(from.getDate() - Math.max(1, days) + 1);
    this.selectedDateFrom = this.toDateInputValue(from);
    this.selectedDateTo = this.toDateInputValue(to);
    this.onDateChanged();
  }

  changeSelectedDay(offsetRanges: number): void {
    const from = this.selectedDateFromAsLocalDate();
    const to = this.selectedDateToAsLocalDate();
    const spanDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
    from.setDate(from.getDate() + offsetRanges * spanDays);
    to.setDate(to.getDate() + offsetRanges * spanDays);
    const today = new Date(); today.setHours(12,0,0,0);
    if (to > today) {
      const shiftDays = Math.ceil((to.getTime() - today.getTime()) / 86400000);
      from.setDate(from.getDate() - shiftDays);
      to.setDate(to.getDate() - shiftDays);
    }
    this.selectedDateFrom = this.toDateInputValue(from);
    this.selectedDateTo = this.toDateInputValue(to);
    this.onDateChanged();
  }

  isNextDayDisabled(): boolean {
    return this.isSameCalendarDay(this.selectedDateToAsLocalDate(), new Date());
  }

  selectToday(): void {
    // Always reset the rolling (1h/2h/...) chart window, even when both
    // calendar dates already say today. Otherwise the old zoom persists.
    const today = this.todayInputMax();
    this.selectedRangePreset = 'today';
    this.selectedQuickRangeMinutes = null;
    this.selectedDateFrom = today;
    this.selectedDateTo = today;
    this.meters.forEach(meter => {
      meter.chartZoomStartMs = null;
      meter.chartZoomEndMs = null;
      this.loadRange(meter);
    });
  }

  todayInputMax(): string {
    return this.toDateInputValue(new Date());
  }

  selectedDateAsDisplayDate(): string {
    return this.selectedDateFrom === this.selectedDateTo ? this.formatDate(this.selectedDateFromAsLocalDate()) : `${this.formatDate(this.selectedDateFromAsLocalDate())} – ${this.formatDate(this.selectedDateToAsLocalDate())}`;
  }

  openLogin(): void {
    this.loginError = '';
    this.loginOpen = true;
    window.setTimeout(() => {
      const element = document.getElementById('powerguard-login-username') as HTMLInputElement | null;
      element?.focus();
    });
  }

  closeLogin(): void {
    if (this.loginBusy) {
      return;
    }
    this.loginOpen = false;
    this.loginError = '';
    this.loginPassword = '';
  }

  submitLogin(): void {
    const username = this.loginUsername.trim();
    if (!username || !this.loginPassword || this.loginBusy) {
      return;
    }

    this.loginBusy = true;
    this.loginError = '';

    this.authService.login(username, this.loginPassword).subscribe({
      next: response => {
        if (!response?.authenticated) {
          this.loginBusy = false;
          this.loginPassword = '';
          this.loginError = this.t('loginFailed');
          return;
        }

        const token = response?.token;
        if (token) {
          localStorage.setItem('powerguard-token', String(token));
        }
        this.installationDefaultSession = false;
        this.applyAuthenticatedUser(response);
        this.adminView = 'dashboard';
        this.activateDashboardSession(response.role);
        // A manual login never changes the installation-wide default user.
        this.loginBusy = false;
        this.loginPassword = '';
        this.loginOpen = false;
      },
      error: error => {
        console.error('PowerGuard login failed', error);
        this.loginBusy = false;
        this.loginPassword = '';
        this.loginError = error?.error?.message || this.t('loginFailed');
      },
    });
  }

  private replaceAutomaticLoginAccountAfterManualLogin(): void {
    const previousToken = localStorage.getItem('powerguard-device-token');
    if (!previousToken || !this.authenticatedUserId) return;
    const username = this.authenticatedUsername;
    const userId = this.authenticatedUserId;
    // Fail closed: never keep silently restoring the previous user after
    // another account has explicitly logged in.
    localStorage.removeItem('powerguard-device-token');
    localStorage.removeItem('powerguard-auto-user');
    this.deviceAutoLoginEnabled = false;
    this.authService.provisionTrustedDevice(userId).subscribe({
      next: data => {
        if (this.authenticated && this.authenticatedUserId === userId &&
            this.authenticatedUsername === username) {
          localStorage.setItem('powerguard-device-token', data.deviceToken);
          localStorage.setItem('powerguard-auto-user', username);
          this.deviceAutoLoginEnabled = true;
        } else {
          this.authService.revokeTrustedDevice(data.deviceToken).subscribe({ error: () => undefined });
        }
        this.authService.revokeTrustedDevice(previousToken).subscribe({ error: () => undefined });
      },
      error: () => {
        this.authService.revokeTrustedDevice(previousToken).subscribe({ error: () => undefined });
        this.toast.showError(this.language === 'pl'
          ? 'Nie udało się przenieść automatycznego logowania na ostatnie konto.'
          : 'Could not update automatic login to the last signed-in account.');
      },
    });
  }

  private activateDashboardSession(role: UserRole): void {
    this.sessionValidated = true;
    this.authenticated = true;
    this.loadApplicationSettings();
    this.loadPublicClients();
    this.loadPublicSites();
    this.loadPublicMeters();
    if (role !== 'USER') this.loadConfiguredMeters();
    this.loadEdgeHealth();
    if (role === 'ADMIN' || role === 'SERVICE') { this.loadAdminClients(); this.loadAdminSites(); }
  }

  private restoreTrustedDevice(): void {
    const secret = localStorage.getItem('powerguard-device-token');
    if (!secret) return;
    this.authService.exchangeTrustedDevice(secret).subscribe({
      next: response => {
        if (!response.authenticated || !response.token) { localStorage.removeItem('powerguard-device-token'); localStorage.removeItem('powerguard-auto-user'); return; }
        localStorage.setItem('powerguard-token', response.token);
        this.applyAuthenticatedUser(response);
        this.adminView = 'dashboard';
        this.activateDashboardSession(response.role);
      },
      error: () => { localStorage.removeItem('powerguard-device-token'); localStorage.removeItem('powerguard-auto-user'); },
    });
  }

  logout(): void {
    const wasDefault = this.installationDefaultSession;
    this.authService.logout().subscribe({error: () => undefined});
    this.clearAuthentication();
    this.installationDefaultSession = false;
    this.adminView = 'dashboard';
    // Logout from the default account opens the login form to switch accounts.
    // Logout from a manually authenticated account returns to the configured default.
    if (wasDefault) {
      sessionStorage.setItem('powerguard-manual-account-switch', '1');
      this.openLogin();
      return;
    }
    sessionStorage.removeItem('powerguard-manual-account-switch');
    this.authService.getInstallationAutoLogin().subscribe({
      next: status => {
        if (!status.enabled) { this.openLogin(); return; }
        this.authService.exchangeInstallationAutoLogin().subscribe({
          next: response => {
            if (!response.authenticated || !response.token) { this.openLogin(); return; }
            localStorage.setItem('powerguard-token', response.token);
            this.installationDefaultSession = true;
            this.applyAuthenticatedUser(response);
            this.activateDashboardSession(response.role);
          },
          error: () => this.openLogin(),
        });
      },
      error: () => this.openLogin(),
    });
  }

  openProfile(): void {
    this.profileError = '';
    this.profilePassword = '';
    this.profilePasswordConfirm = '';
    this.deviceAutoLoginMessage = '';
    this.deviceAutoLoginEnabled = !!localStorage.getItem('powerguard-device-token');
    this.profileBusy = true;
    this.authService.me().subscribe({
      next: user => {
        this.applyAuthenticatedUser(user);
        this.profileUsername = user.username;
        this.profileFirstname = user.firstname || '';
        this.profileLastname = user.lastname || '';
        this.profileEmail = user.email || '';
        this.profilePhone = user.phone || '';
        this.profileOpen = true;
        this.profileBusy = false;
      },
      error: () => {
        this.profileBusy = false;
        this.clearAuthentication();
      },
    });
  }

  closeProfile(): void {
    if (this.profileBusy) return;
    this.profileOpen = false;
    this.profileError = '';
    this.profilePassword = '';
    this.profilePasswordConfirm = '';
  }

  saveProfile(): void {
    if (this.profileBusy || !this.profileUsername.trim()) return;
    if (this.profilePassword !== this.profilePasswordConfirm) {
      this.profileError = this.t('passwordsDoNotMatch');
      this.toast.showError(this.profileError);
      return;
    }
    this.profileBusy = true;
    this.profileError = '';
    this.authService.updateMe({
      username: this.profileUsername.trim(),
      firstname: this.profileFirstname.trim() || null,
      lastname: this.profileLastname.trim() || null,
      email: this.profileEmail.trim() || null,
      phone: this.profilePhone.trim() || null,
      password: this.profilePassword || undefined,
    }).subscribe({
      next: user => {
        this.applyAuthenticatedUser(user);
        this.profileUsername = user.username;
        this.profileFirstname = user.firstname || '';
        this.profileLastname = user.lastname || '';
        this.profileEmail = user.email || '';
        this.profilePhone = user.phone || '';
        this.profilePassword = '';
        this.profilePasswordConfirm = '';
        this.profileBusy = false;
        this.profileOpen = false;
        this.profileError = '';
        this.toast.showSuccess(this.t('profileUpdated'));
      },
      error: error => {
        this.profileBusy = false;
        this.profileError = error?.error?.message || this.t('profileUpdateFailed');
        this.toast.showError(this.profileError);
      },
    });
  }

  openUsers(): void {
    if (this.authenticatedRole !== 'ADMIN' && this.authenticatedRole !== 'SERVICE') return;
    this.usersOpen = true;
    this.deviceAutoLoginMessage = '';
    this.deviceAutoLoginEnabled = false;
    this.resetManagedUserEditor();
    if (this.authenticatedRole === 'ADMIN' || this.authenticatedRole === 'SERVICE') {
      this.authService.getInstallationAutoLoginConfiguration().subscribe({
        next: config => { this.autoLoginDefaultUserId = config.userId; this.autoLoginConfiguredUserId = config.userId; },
        error: () => { this.autoLoginConfigurationError = 'Failed to read automatic login configuration.'; },
      });
    }
    this.loadUsers();
    this.loadAssignableSites();
  }

  configureAutomaticLoginForThisBrowser(enabled: boolean): void {
    if (!this.authenticated || !this.authenticatedUserId || this.deviceAutoLoginBusy) return;
    this.deviceAutoLoginMessage = '';
    const existing = localStorage.getItem('powerguard-device-token');
    this.deviceAutoLoginBusy = true;
    if (!enabled) {
      if (!existing) {
        localStorage.removeItem('powerguard-auto-user');
        this.deviceAutoLoginEnabled = false;
        this.deviceAutoLoginBusy = false;
        return;
      }
      this.authService.revokeTrustedDevice(existing).subscribe({
        next: () => {
          localStorage.removeItem('powerguard-device-token');
          localStorage.removeItem('powerguard-auto-user');
          this.deviceAutoLoginEnabled = false;
          this.deviceAutoLoginBusy = false;
          this.deviceAutoLoginMessage = this.language === 'pl' ? 'Automatyczne logowanie wyłączone.' : 'Automatic login disabled.';
        },
        error: () => {
          this.deviceAutoLoginBusy = false;
          this.deviceAutoLoginMessage = this.language === 'pl' ? 'Nie udało się wyłączyć automatycznego logowania.' : 'Unable to disable automatic login.';
        },
      });
      return;
    }
    // Provision a credential exclusively for the currently authenticated user.
    this.authService.provisionTrustedDevice(this.authenticatedUserId).subscribe({
      next: data => {
        localStorage.setItem('powerguard-device-token', data.deviceToken);
        localStorage.setItem('powerguard-auto-user', this.authenticatedUsername);
        this.deviceAutoLoginEnabled = true;
        this.deviceAutoLoginBusy = false;
        this.deviceAutoLoginMessage = this.language === 'pl' ? 'Automatyczne logowanie włączone na tej przeglądarce.' : 'Automatic login enabled on this browser.';
        if (existing) this.authService.revokeTrustedDevice(existing).subscribe({ error: () => undefined });
      },
      error: () => {
        this.deviceAutoLoginBusy = false;
        this.deviceAutoLoginMessage = this.language === 'pl' ? 'Nie udało się włączyć automatycznego logowania.' : 'Unable to enable automatic login.';
      },
    });
  }

  closeUsers(): void {
    if (this.usersBusy) return;
    this.usersOpen = false;
    this.usersError = '';
    this.resetManagedUserEditor();
  }

  startAddUser(): void {
    this.resetManagedUserEditor();
  }

  startEditUser(user: UserView): void {
    this.editingUserId = user.id;
    this.managedUsername = user.username;
    this.managedFirstname = user.firstname || '';
    this.managedLastname = user.lastname || '';
    this.managedEmail = user.email || '';
    this.managedPhone = user.phone || '';
    this.managedPassword = '';
    this.managedPasswordConfirm = '';
    this.managedRole = user.role;
    this.managedEnabled = user.enabled;
    this.managedSiteIds = [...(user.siteIds || [])];
    this.usersError = '';
  }

  saveManagedUser(): void {
    if (this.usersBusy || !this.managedUsername.trim()) return;
    if (this.managedPassword !== this.managedPasswordConfirm) {
      this.usersError = this.t('passwordsDoNotMatch');
      return;
    }
    if (this.editingUserId === null && !this.managedPassword) {
      this.usersError = this.t('newPassword');
      return;
    }

    const input: ManagedUserInput = {
      username: this.managedUsername.trim(),
      firstname: this.managedFirstname.trim() || null,
      lastname: this.managedLastname.trim() || null,
      email: this.managedEmail.trim() || null,
      phone: this.managedPhone.trim() || null,
      password: this.managedPassword || undefined,
      role: this.managedRole,
      enabled: this.managedEnabled,
      siteIds: this.managedRole === 'ADMIN' ? [] : [...this.managedSiteIds],
    };

    this.usersBusy = true;
    this.usersError = '';
    const request = this.editingUserId === null
      ? this.authService.createUser(input)
      : this.authService.updateUser(this.editingUserId, input);
    const editedUserId = this.editingUserId;
    request.subscribe({
      next: user => {
        this.usersBusy = false;
        this.resetManagedUserEditor();

        if (editedUserId === this.authenticatedUserId) {
          this.applyAuthenticatedUser(user);
          if (!user.enabled) {
            this.clearAuthentication();
            return;
          }
          if (user.role !== 'ADMIN' && user.role !== 'SERVICE') {
            this.usersOpen = false;
            return;
          }
        }

        this.loadUsers();
      },
      error: error => {
        this.usersBusy = false;
        this.usersError = error?.error?.message || this.t('userSaveFailed');
      },
    });
  }

  deleteManagedUser(user: UserView): void {
    if (this.usersBusy || !window.confirm(this.t('confirmDeleteUser'))) return;
    this.usersBusy = true;
    this.usersError = '';
    this.authService.deleteUser(user.id).subscribe({
      next: () => {
        this.usersBusy = false;
        if (user.id === this.authenticatedUserId) {
          this.clearAuthentication();
          return;
        }
        this.loadUsers();
      },
      error: error => {
        this.usersBusy = false;
        this.usersError = error?.error?.message || this.t('userDeleteFailed');
      },
    });
  }

  get meterFilterClients(): string[] {
    return [...new Set(this.configuredMeters.map(m => m.clientId))]
      .sort((a, b) => this.clientDisplayName(a).localeCompare(this.clientDisplayName(b)));
  }

  get meterFilterSites(): string[] {
    const source = this.meterFilterClient
      ? this.configuredMeters.filter(m => m.clientId === this.meterFilterClient)
      : this.configuredMeters;
    return [...new Set(source.map(m => m.siteId))]
      .sort((a, b) => a.localeCompare(b));
  }

  get meterFilterEdges(): string[] {
    let source = this.configuredMeters;
    if (this.meterFilterClient) source = source.filter(m => m.clientId === this.meterFilterClient);
    if (this.meterFilterSite) source = source.filter(m => m.siteId === this.meterFilterSite);
    return [...new Set(source.map(m => m.edgeId))]
      .sort((a, b) => a.localeCompare(b));
  }

  get visibleConfiguredMeters(): MeterConfigurationView[] {
    const q = this.meterFilterText.trim().toLocaleLowerCase();
    const filtered = this.configuredMeters.filter(meter => {
      if (!q) return true;
      return [
        meter.clientId, meter.clientName,
        meter.siteId, meter.siteName,
        meter.edgeId,
        meter.uniqueKey,
        meter.name,
        meter.enabled ? this.t('enabled') : this.t('disabled'),
        meter.instantaneousAlarmOnKw,
        meter.instantaneousAlarmOffKw,
        meter.quarterHourAlarmOnKw,
        meter.quarterHourAlarmOffKw,
      ].some(value => String(value ?? '').toLocaleLowerCase().includes(q));
    });

    return [...filtered].sort((a, b) => {
      const field = this.meterSortField;
      let cmp = 0;
      if (field === 'displayOrder') {
        cmp = a.displayOrder - b.displayOrder || a.id - b.id;
      } else if (field === 'enabled') {
        cmp = Number(a.enabled) - Number(b.enabled);
      } else if (field === 'instantaneousAlarmOnKw' || field === 'quarterHourAlarmOnKw') {
        const av = a[field];
        const bv = b[field];
        cmp = av == null && bv == null ? 0
          : av == null ? 1
          : bv == null ? -1
          : av - bv;
      } else {
        cmp = String(a[field] ?? '').localeCompare(String(b[field] ?? ''), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }
      return this.meterSortDirection === 'asc' ? cmp : -cmp;
    });
  }

  setMeterSort(field: typeof this.meterSortField): void {
    if (this.meterSortField === field) {
      this.meterSortDirection = this.meterSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.meterSortField = field;
      this.meterSortDirection = 'asc';
    }
  }

  meterSortIndicator(field: typeof this.meterSortField): string {
    if (this.meterSortField !== field) return '↕';
    return this.meterSortDirection === 'asc' ? '↑' : '↓';
  }

  onMeterClientFilterChanged(): void {
    if (this.meterFilterSite && !this.meterFilterSites.includes(this.meterFilterSite)) this.meterFilterSite = '';
    if (this.meterFilterEdge && !this.meterFilterEdges.includes(this.meterFilterEdge)) this.meterFilterEdge = '';
  }

  onMeterSiteFilterChanged(): void {
    if (this.meterFilterEdge && !this.meterFilterEdges.includes(this.meterFilterEdge)) {
      this.meterFilterEdge = '';
    }
  }

  clearMeterFilters(): void {
    this.meterFilterClient = '';
    this.meterFilterSite = '';
    this.meterFilterEdge = '';
    this.meterFilterStatus = 'all';
    this.meterFilterText = '';
  }

  get meterFiltersActive(): boolean {
    return !!this.meterFilterClient
      || !!this.meterFilterSite
      || !!this.meterFilterEdge
      || this.meterFilterStatus !== 'all'
      || !!this.meterFilterText.trim();
  }

  canMoveMeterUp(meter: MeterConfigurationView): boolean {
    const index = this.configuredMeters.findIndex(m => m.id === meter.id);
    return this.meterSortField === 'displayOrder' && this.meterSortDirection === 'asc' && !this.meterFiltersActive && index > 0;
  }

  canMoveMeterDown(meter: MeterConfigurationView): boolean {
    const index = this.configuredMeters.findIndex(m => m.id === meter.id);
    return this.meterSortField === 'displayOrder' && this.meterSortDirection === 'asc' && !this.meterFiltersActive
      && index >= 0 && index < this.configuredMeters.length - 1;
  }

  meterEditorSites(): SiteView[] {
    const source = this.authenticatedRole === 'ADMIN' ? this.adminSites : this.sites;
    return source.filter(site => site.clientId === this.meterClientId);
  }

  meterEditorEdgeIds(): string[] {
    const clientId = this.meterClientId.trim();
    const siteId = this.meterSiteId.trim();
    if (!clientId || !siteId) return this.meterEdgeId.trim() ? [this.meterEdgeId.trim()] : [];

    const discovered = this.edgeHealth
      .filter(edge => edge.clientId === clientId && edge.siteId === siteId)
      .map(edge => edge.edgeId?.trim())
      .filter((id): id is string => !!id);

    // Also keep known configured Edge IDs available if an Edge is temporarily offline.
    const configured = this.configuredMeters
      .filter(meter => meter.clientId === clientId && meter.siteId === siteId)
      .map(meter => meter.edgeId?.trim())
      .filter((id): id is string => !!id);

    const result = [...new Set([...discovered, ...configured])]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const current = this.meterEdgeId.trim();
    if (current && !result.some(id => id.toLowerCase() === current.toLowerCase())
        && this.editingMeterId !== null) {
      result.unshift(current);
    }

    return result;
  }

  private syncMeterEditorEdgeId(): void {
    const options = this.meterEditorEdgeIds();
    if (!options.some(id => id === this.meterEdgeId)) {
      this.meterEdgeId = options[0] || '';
    }
    this.syncMeterEditorMeterId();
  }

  meterEditorMeterIds(): string[] {
    const clientId = this.meterClientId.trim();
    const siteId = this.meterSiteId.trim();
    const edgeId = this.meterEdgeId.trim();
    if (!clientId || !siteId || !edgeId) return this.meterUniqueName.trim() ? [this.meterUniqueName.trim()] : [];

    const edge = this.edgeHealth.find(item =>
      item.clientId === clientId && item.siteId === siteId && item.edgeId === edgeId
    );

    const discovered = edge?.meters
      .map(meter => meter.meterId?.trim())
      .filter((id): id is string => !!id) ?? [];

    const used = new Set(
      this.configuredMeters
        .filter(meter => meter.id !== this.editingMeterId
          && meter.clientId === clientId
          && meter.siteId === siteId
          && meter.edgeId === edgeId)
        .map(meter => meter.uniqueKey.trim().toLowerCase())
    );

    const result = [...new Set(discovered)]
      .filter(id => !used.has(id.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    // Preserve the currently edited value even if the Edge is temporarily offline
    // or the health snapshot does not contain it at this moment.
    const current = this.meterUniqueName.trim();
    if (current && !result.some(id => id.toLowerCase() === current.toLowerCase())
        && this.editingMeterId !== null) {
      result.unshift(current);
    }

    return result;
  }

  private syncMeterEditorMeterId(): void {
    const options = this.meterEditorMeterIds();
    if (options.some(id => id === this.meterUniqueName)) return;
    this.meterUniqueName = options[0] || '';
  }

  onMeterClientChanged(): void {
    const sites = this.meterEditorSites();
    if (!sites.some(site => site.siteId === this.meterSiteId)) this.meterSiteId = sites[0]?.siteId || '';
    this.syncMeterEditorEdgeId();
  }

  onMeterSiteChanged(): void {
    this.syncMeterEditorEdgeId();
  }

  onMeterEdgeChanged(): void {
    this.syncMeterEditorMeterId();
  }

  startAddMeter(): void {
    this.resetMeterEditor();
  }

  startEditMeter(meter: MeterConfigurationView): void {
    this.editingMeterId = meter.id;
    this.meterClientId = meter.clientId;
    this.meterSiteId = meter.siteId;
    this.meterEdgeId = meter.edgeId;
    this.meterUniqueName = meter.uniqueKey;
    this.meterName = meter.name;
    this.meterInstantaneousAlarmOnKw = meter.instantaneousAlarmOnKw;
    this.meterInstantaneousAlarmOffKw = meter.instantaneousAlarmOffKw;
    this.meterQuarterHourAlarmOnKw = meter.quarterHourAlarmOnKw;
    this.meterQuarterHourAlarmOffKw = meter.quarterHourAlarmOffKw;
    this.meterEnabled = meter.enabled;
    this.metersError = '';
  }

  private meterEditorInput(): MeterConfigurationInput | null {
    if (!this.isMeterFormValid()) {
      this.metersError = this.t('meterRequiredFields');
      return null;
    }

    const input: MeterConfigurationInput = {
      clientId: this.meterClientId.trim(),
      siteId: this.meterSiteId.trim(),
      edgeId: this.meterEdgeId.trim(),
      uniqueKey: this.meterUniqueName.trim(),
      name: this.meterName.trim(),
      instantaneousAlarmOnKw: this.normalizedAlarm(this.meterInstantaneousAlarmOnKw),
      instantaneousAlarmOffKw: this.normalizedAlarm(this.meterInstantaneousAlarmOffKw),
      quarterHourAlarmOnKw: this.normalizedAlarm(this.meterQuarterHourAlarmOnKw),
      quarterHourAlarmOffKw: this.normalizedAlarm(this.meterQuarterHourAlarmOffKw),
      enabled: this.meterEnabled,
    };

    if (!this.validHysteresis(input.instantaneousAlarmOnKw, input.instantaneousAlarmOffKw)
      || !this.validHysteresis(input.quarterHourAlarmOnKw, input.quarterHourAlarmOffKw)) {
      this.metersError = this.t('hysteresisHint');
      return null;
    }
    return input;
  }

  canCreateMeterFromEditor(): boolean {
    if (this.metersBusy || !this.meterClientId.trim() || !this.meterSiteId.trim()
      || !this.meterEdgeId.trim() || !this.meterUniqueName.trim() || !this.meterName.trim()) return false;

    const clientId = this.meterClientId.trim();
    const siteId = this.meterSiteId.trim();
    const edgeId = this.meterEdgeId.trim();
    const uniqueKey = this.meterUniqueName.trim().toLowerCase();

    return !this.configuredMeters.some(meter => meter.clientId === clientId
      && meter.siteId === siteId
      && meter.edgeId === edgeId
      && meter.uniqueKey.trim().toLowerCase() === uniqueKey);
  }

  createMeterFromEditor(): void {
    if (this.metersBusy) return;
    const input = this.meterEditorInput();
    if (!input) return;

    if (!this.canCreateMeterFromEditor()) {
      this.metersError = this.t('meterInvalidOrDuplicate');
      return;
    }
    this.saveMeterRequest(this.meterService.create(input));
  }

  updateMeterFromEditor(): void {
    if (this.metersBusy || this.editingMeterId === null) return;
    const input = this.meterEditorInput();
    if (!input) return;
    this.saveMeterRequest(this.meterService.update(this.editingMeterId, input));
  }

  private saveMeterRequest(request: ReturnType<MeterService['create']>): void {
    this.metersBusy = true;
    this.metersError = '';
    request.subscribe({
      next: () => {
        this.metersBusy = false;
        this.resetMeterEditor();
        this.toast.showSuccess(this.t('meterSaved'));
        this.loadConfiguredMeters();
        this.loadPublicMeters();
        this.loadApplicationSettings();
        this.loadBackendVersion();
      },
      error: error => {
        this.metersBusy = false;
        this.metersError = error?.status === 400
          ? this.t('meterInvalidOrDuplicate')
          : this.t('meterSaveFailed');
        this.toast.showError(this.metersError);
        if (error?.status === 401) this.clearAuthentication();
      },
    });
  }

  moveMeterUp(meter: MeterConfigurationView): void {
    if (this.metersBusy || !this.canMoveMeterUp(meter)) return;
    this.metersBusy = true;
    this.meterService.moveUp(meter.id).subscribe({
      next: () => { this.metersBusy = false; this.loadConfiguredMeters(); this.loadPublicMeters(); },
      error: () => { this.metersBusy = false; this.metersError = this.t('meterSaveFailed'); }
    });
  }

  moveMeterDown(meter: MeterConfigurationView): void {
    if (this.metersBusy || !this.canMoveMeterDown(meter)) return;
    this.metersBusy = true;
    this.meterService.moveDown(meter.id).subscribe({
      next: () => { this.metersBusy = false; this.loadConfiguredMeters(); this.loadPublicMeters(); },
      error: () => { this.metersBusy = false; this.metersError = this.t('meterSaveFailed'); }
    });
  }

  deleteMeter(meter: MeterConfigurationView): void {
    if (this.metersBusy || !window.confirm(this.t('confirmDeleteMeter'))) return;
    this.metersBusy = true;
    this.metersError = '';
    this.meterService.delete(meter.id).subscribe({
      next: () => {
        this.metersBusy = false;
        if (this.editingMeterId === meter.id) this.resetMeterEditor();
        this.loadConfiguredMeters();
        this.loadPublicMeters();
    this.loadApplicationSettings();
    this.loadBackendVersion();
      },
      error: error => {
        this.metersBusy = false;
        this.metersError = error?.error?.message || this.t('meterDeleteFailed');
        this.toast.showError(this.metersError);
        if (error?.status === 401) this.clearAuthentication();
      },
    });
  }

  private loadPublicClients(): void {
    this.meterService.listPublicClients().subscribe({
      next: clients => { this.clients = clients; this.ensureSelectedClientAndSite(); },
      error: () => { this.clients = []; this.ensureSelectedClientAndSite(); }
    });
  }

  private loadAdminClients(): void {
    if (!this.authenticated || this.authenticatedRole !== 'ADMIN') return;
    this.clientsBusy = true; this.clientsError = '';
    this.meterService.listAllClients().subscribe({
      next: clients => { this.adminClients = clients; this.clientsBusy = false; if (!this.siteFormClientId && clients.length) this.siteFormClientId = clients[0].clientId; },
      error: error => { this.clientsBusy = false; this.clientsError = error?.error?.message || this.t('clientSaveFailed'); }
    });
  }

  startAddClient(): void {
    this.editingClientId = null; this.clientFormId = ''; this.clientFormName = ''; this.clientFormEnabled = true; this.clientsError = '';
  }

  startEditClient(client: ClientView): void {
    this.editingClientId = client.clientId; this.clientFormId = client.clientId; this.clientFormName = client.name; this.clientFormEnabled = client.enabled; this.clientsError = '';
  }

  saveClient(): void {
    if (this.clientsBusy) return;
    const clientId = this.clientFormId.trim(); const name = this.clientFormName.trim();
    if (!clientId || !name) { this.clientsError = this.t('clientRequiredFields'); return; }
    const input: ClientInput = { clientId, name, enabled: this.clientFormEnabled };
    this.clientsBusy = true; this.clientsError = '';
    const request = this.editingClientId == null ? this.meterService.createClient(input) : this.meterService.updateClient(this.editingClientId, input);
    request.subscribe({
      next: () => { this.clientsBusy = false; this.startAddClient(); this.toast.showSuccess(this.t('savedShort')); this.loadAdminClients(); this.loadPublicClients(); },
      error: error => { this.clientsBusy = false; this.clientsError = error?.error?.message || this.t('clientSaveFailed'); }
    });
  }

  deleteClient(client: ClientView): void {
    if (this.clientsBusy || !window.confirm(this.t('confirmDeleteClient'))) return;
    this.clientsBusy = true; this.clientsError = '';
    this.meterService.deleteClient(client.clientId).subscribe({
      next: () => { this.clientsBusy = false; if (this.editingClientId === client.clientId) this.startAddClient(); this.loadAdminClients(); this.loadPublicClients(); },
      error: error => { this.clientsBusy = false; this.clientsError = error?.error?.message || this.t('clientDeleteFailed'); }
    });
  }

  private loadPublicSites(): void {
    this.meterService.listPublicSites().subscribe({
      next: sites => { this.sites = sites; this.ensureSelectedClientAndSite(); },
      error: () => { this.sites = []; this.ensureSelectedClientAndSite(); }
    });
  }

  private loadAdminSites(): void {
    if (!this.authenticated || this.authenticatedRole !== 'ADMIN') return;
    this.sitesBusy = true; this.sitesError = '';
    this.meterService.listAllSites().subscribe({
      next: sites => { this.adminSites = sites; this.sitesBusy = false; if (!this.siteFormClientId && this.adminClients.length) this.siteFormClientId = this.adminClients[0].clientId; },
      error: error => { this.sitesBusy = false; this.sitesError = error?.error?.message || this.t('siteSaveFailed'); }
    });
  }

  startAddSite(): void {
    this.editingSiteId = null; this.siteFormClientId = this.adminClients[0]?.clientId || ''; this.siteFormId = ''; this.siteFormName = ''; this.siteFormEnabled = true; this.sitesError = '';
  }

  startEditSite(site: SiteView): void {
    this.editingSiteId = site.siteId; this.siteFormClientId = site.clientId; this.siteFormId = site.siteId; this.siteFormName = site.name; this.siteFormEnabled = site.enabled; this.sitesError = '';
  }

  saveSite(): void {
    if (this.sitesBusy) return;
    const clientId = this.siteFormClientId.trim(); const siteId = this.siteFormId.trim(); const name = this.siteFormName.trim();
    if (!clientId || !siteId || !name) { this.sitesError = this.t('siteRequiredFields'); return; }
    const input: SiteInput = { clientId, siteId, name, enabled: this.siteFormEnabled };
    this.sitesBusy = true; this.sitesError = '';
    const request = this.editingSiteId == null ? this.meterService.createSite(input) : this.meterService.updateSite(clientId, this.editingSiteId, input);
    request.subscribe({
      next: () => { this.sitesBusy = false; this.startAddSite(); this.toast.showSuccess(this.t('savedShort')); this.loadAdminSites(); this.loadPublicSites(); },
      error: error => { this.sitesBusy = false; this.sitesError = error?.error?.message || this.t('siteSaveFailed'); }
    });
  }

  deleteSite(site: SiteView): void {
    if (this.sitesBusy || !window.confirm(this.t('confirmDeleteSite'))) return;
    this.sitesBusy = true; this.sitesError = '';
    this.meterService.deleteSite(site.clientId, site.siteId).subscribe({
      next: () => { this.sitesBusy = false; if (this.editingSiteId === site.siteId && this.siteFormClientId === site.clientId) this.startAddSite(); this.loadAdminSites(); this.loadPublicSites(); },
      error: error => { this.sitesBusy = false; this.sitesError = error?.error?.message || this.t('siteDeleteFailed'); }
    });
  }

  private loadConfiguredMeters(): void {
    if (!this.authenticated || this.authenticatedRole === 'USER') return;
    this.metersBusy = true;
    this.meterService.listAll().subscribe({
      next: meters => {
        this.configuredMeters = meters;
        if (this.editingMeterId === null) {
          this.meterUniqueName = this.nextUniqueKey();
        }
        this.metersBusy = false;
      },
      error: error => {
        this.metersBusy = false;
        this.metersError = error?.error?.message || this.t('meterSaveFailed');
        if (error?.status === 401) this.clearAuthentication();
      },
    });
  }

  private loadPublicMeters(): void {
    if (!this.sessionValidated) return;
    this.meterService.listPublic().subscribe({
      next: configured => {
        if (!this.sessionValidated) return;
        this.meters = configured.map(meter => this.createMeter(meter));
        this.ensureSelectedClientAndSite();
        this.refreshMeasurements();
        this.meters.forEach(meter => this.loadRange(meter));
      },
      error: () => {
        this.meters = [];
      },
    });
  }

  private refreshMeasurements(): void {
    if (!this.sessionValidated) return;
    this.meters.forEach(meter => {
      this.meterService.latestMeasurement(meter.meterId).subscribe({
        next: snapshot => {
          if (!this.sessionValidated) return;
          if (snapshot) this.applySnapshot(meter, snapshot);
          else this.markMeterOffline(meter);
        },
        error: error => {
          if (error?.status === 404) {
            this.markMeterOffline(meter);
          }
        },
      });
    });
  }

  private markMeterOffline(meter: MeterCard): void {
    meter.status = 'OFFLINE';
    meter.currentPowerKw = null;
    meter.currentQuarterPowerKw = null;
    meter.lastUpdated = '';
    meter.lastReadingAt = '';
  }

  private applySnapshot(meter: MeterCard, snapshot: MeasurementSnapshotView): void {
    meter.currentPowerKw = snapshot.currentPowerKw == null ? null : Number(snapshot.currentPowerKw);
    const snapshotNow = new Date();
    meter.currentQuarterPowerKw = this.isTimestampInCurrentQuarter(snapshot.lastUpdated, snapshotNow)
      ? (snapshot.currentQuarterPowerKw == null ? null : Number(snapshot.currentQuarterPowerKw))
      : 0;
    meter.quarterIndex = this.currentQuarterIndex(snapshotNow);
    meter.voltageL1V = this.numberOrNull(snapshot.voltageL1V);
    meter.voltageL2V = this.numberOrNull(snapshot.voltageL2V);
    meter.voltageL3V = this.numberOrNull(snapshot.voltageL3V);
    meter.currentL1A = this.numberOrNull(snapshot.currentL1A);
    meter.currentL2A = this.numberOrNull(snapshot.currentL2A);
    meter.currentL3A = this.numberOrNull(snapshot.currentL3A);
    meter.frequencyHz = this.numberOrNull(snapshot.frequencyHz);
    meter.lastReadingAt = snapshot.lastUpdated || '';
    meter.lastUpdated = snapshot.lastUpdated ? this.formatTime(new Date(snapshot.lastUpdated)) : '';
    meter.quarterProgress = this.currentQuarterProgress(new Date());
    meter.status = 'ONLINE';
    this.putCurrentQuarterIntoChart(meter);
    if (this.selectedQuickRangeMinutes != null) {
      this.updateRollingQuickRange();
    } else {
      this.rebuildMeter(meter, new Date());
    }
    this.refreshAlarmStatus(meter);
  }

  private applyLiveMessage(message: PowerguardLiveMessage): void {
    const meter = this.meters.find(m => (!message.clientId || m.clientId === message.clientId) && m.siteId === message.siteId && m.edgeId === message.edgeId && m.uniqueKey === message.meterUniqueKey);
    if (!meter) return;

    if (message.messageType === 'meter.status') {
      if (message.status === 'OFFLINE') meter.status = 'OFFLINE';
      else if (message.status === 'DEGRADED') meter.status = 'WARNING';
      else {
        meter.status = 'ONLINE';
        this.refreshAlarmStatus(meter);
      }
      return;
    }

    meter.currentPowerKw = message.currentPowerKw == null ? null : Number(message.currentPowerKw);
    const liveNow = new Date();
    const messageIsCurrentQuarter = this.isTimestampInCurrentQuarter(message.measuredAt, liveNow);
    meter.currentQuarterPowerKw = messageIsCurrentQuarter
      ? (message.currentQuarterPowerKw == null ? null : Number(message.currentQuarterPowerKw))
      : 0;
    meter.quarterIndex = this.currentQuarterIndex(liveNow);
    meter.voltageL1V = this.numberOrNull(message.voltageL1V);
    meter.voltageL2V = this.numberOrNull(message.voltageL2V);
    meter.voltageL3V = this.numberOrNull(message.voltageL3V);
    meter.currentL1A = this.numberOrNull(message.currentL1A);
    meter.currentL2A = this.numberOrNull(message.currentL2A);
    meter.currentL3A = this.numberOrNull(message.currentL3A);
    meter.frequencyHz = this.numberOrNull(message.frequencyHz);
    if (this.rangeIncludesToday()) {
      meter.dayMeasurements.push({ id: -Date.now(), meterId: meter.meterId, measuredAt: message.measuredAt, activePowerKw: message.currentPowerKw, activePowerSource: message.activePowerSource, activePowerQuality: message.activePowerQuality, activeEnergyImportKwh: message.activeEnergyImportKwh, activeEnergyExportKwh: message.activeEnergyExportKwh, currentQuarterPowerKw: messageIsCurrentQuarter ? message.currentQuarterPowerKw : null, voltageL1V: message.voltageL1V, voltageL2V: message.voltageL2V, voltageL3V: message.voltageL3V, currentL1A: message.currentL1A, currentL2A: message.currentL2A, currentL3A: message.currentL3A, frequencyHz: message.frequencyHz });
      // Do not trim by an arbitrary item count: at ~10 s cadence 1500 samples are only ~4 h,
      // which used to delete the morning part of today's chart after the first live WebSocket sample.
      // Keep all points belonging to the currently selected date range instead.
      const rangeStart = this.rangeStartMs();
      const rangeEnd = this.rangeEndExclusiveMs();
      meter.dayMeasurements = meter.dayMeasurements.filter(reading => {
        const ts = new Date(reading.measuredAt).getTime();
        return ts >= rangeStart && ts < rangeEnd;
      });
      this.rebuildNetworkCharts(meter);
    }
    meter.lastReadingAt = message.measuredAt || '';
    meter.lastUpdated = this.formatTime(new Date(message.measuredAt));
    meter.quarterProgress = this.currentQuarterProgress(new Date());
    meter.status = 'ONLINE';
    this.putCurrentQuarterIntoChart(meter);
    this.rebuildMeter(meter, new Date());
    this.refreshAlarmStatus(meter);
  }

  private putCurrentQuarterIntoChart(meter: MeterCard): void {
    if (!this.isSelectedToday() || meter.currentQuarterPowerKw == null) return;
    const now = new Date();
    const index = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
    if (index >= 0 && index < meter.completedQuarterPowers.length) {
      meter.completedQuarterPowers[index] = meter.currentQuarterPowerKw;
      meter.history[index] = meter.currentQuarterPowerKw;
    }
  }

  private resetMeterEditor(): void {
    this.editingMeterId = null;
    this.meterClientId = this.selectedClientId || this.publicDashboardClients[0]?.clientId || 'local';
    this.meterSiteId = this.selectedSiteId || this.publicDashboardSitesForSelectedClient[0]?.siteId || 'local';
    this.meterEdgeId = '';
    this.meterUniqueName = '';
    this.syncMeterEditorEdgeId();
    this.meterName = '';
    this.meterInstantaneousAlarmOnKw = null;
    this.meterInstantaneousAlarmOffKw = null;
    this.meterQuarterHourAlarmOnKw = null;
    this.meterQuarterHourAlarmOffKw = null;
    this.meterEnabled = true;
    this.metersError = '';
  }


  private nextUniqueKey(): string {
    const client = this.meterClientId.trim().toLowerCase();
    const site = this.meterSiteId.trim().toLowerCase();
    const edge = this.meterEdgeId.trim().toLowerCase();
    const used = new Set(this.configuredMeters.filter(m => m.clientId.toLowerCase() === client && m.siteId.toLowerCase() === site && m.edgeId.toLowerCase() === edge).map(m => m.uniqueKey.toLowerCase()));
    let index = 1;
    while (used.has(`meter-${String(index).padStart(3, '0')}`)) index++;
    return `meter-${String(index).padStart(3, '0')}`;
  }

  isMeterFormValid(): boolean {
    return this.meterClientId.trim().length > 0 && this.meterSiteId.trim().length > 0 && this.meterEdgeId.trim().length > 0 && this.meterUniqueName.trim().length > 0 && this.meterName.trim().length > 0;
  }

  private validHysteresis(on: number | null, off: number | null): boolean {
    if (on == null && off == null) return true;
    return on != null && off != null && on >= 0 && off >= 0 && off < on;
  }

  alarmTypeLabel(type: AlarmView['type']): string {
    return type === 'INSTANTANEOUS_POWER' ? this.t('alarmTypeInstant') : this.t('alarmTypeQuarter');
  }

  formatAlarmDate(value: string | null): string {
    if (!value) return this.t('alarmActive');
    return new Date(value).toLocaleTimeString(this.language === 'pl' ? 'pl-PL' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  formatAlarmPeriod(startedAt: string, endedAt: string | null): string {
    const start = new Date(startedAt);
    if (Number.isNaN(start.getTime())) return '—';

    const locale = this.language === 'pl' ? 'pl-PL' : 'en-GB';
    const dateFormatter = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const startDate = dateFormatter.format(start);
    const startTime = timeFormatter.format(start);

    if (!endedAt) {
      return `${startDate}, ${startTime} - ${this.t('alarmActive')}`;
    }

    const end = new Date(endedAt);
    if (Number.isNaN(end.getTime())) return `${startDate}, ${startTime} - ${this.t('alarmActive')}`;

    const endDate = dateFormatter.format(end);
    const endTime = timeFormatter.format(end);
    const sameDay = start.getFullYear() === end.getFullYear()
      && start.getMonth() === end.getMonth()
      && start.getDate() === end.getDate();

    return sameDay
      ? `${startDate}, ${startTime} - ${endTime}`
      : `${startDate}, ${startTime} - ${endDate}, ${endTime}`;
  }

  formatAlarmDuration(startedAt: string, endedAt: string | null): string {
    const startMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startMs)) return '—';

    const endMs = endedAt ? new Date(endedAt).getTime() : this.now.getTime();
    if (!Number.isFinite(endMs)) return '—';

    const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  alarmMaximumPower(alarm: AlarmView): number | null {
    const max = alarm.maxValue == null ? null : Number(alarm.maxValue);
    if (max != null && Number.isFinite(max)) return max;

    const start = alarm.startValue == null ? null : Number(alarm.startValue);
    return start != null && Number.isFinite(start) ? start : null;
  }

  private normalizedAlarm(value: number | null): number | null {
    return value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value);
  }

  roleLabel(role: UserRole): string {
    if (role === 'ADMIN') return this.t('admin');
    if (role === 'SERVICE') {
      return this.language === 'pl' ? 'Serwis' : 'Service';
    }
    return role === 'ADVANCED_USER' ? (this.language === 'pl' ? 'Użytkownik zaawansowany' : 'Advanced user') : this.t('user');
  }

  userSiteNames(user: UserView): string {
    const ids = user.siteIds || [];
    if (ids.length === 0) return '—';
    const allKnownSites = [...this.assignableSites, ...this.adminSites, ...this.sites];
    const names = ids.map(id => { const site = allKnownSites.find(s => s.id === id); return site ? `${site.clientName} / ${site.name}` : null; }).filter((name): name is string => !!name);
    return names.join(', ') || '—';
  }

  managedSiteSelectionSummary(): string {
    if (this.managedSiteIds.length === 0) return this.t('selectSites');
    const names = this.managedSiteIds
      .map(id => { const site = this.assignableSites.find(s => s.id === id); return site ? `${site.clientName} / ${site.name}` : undefined; })
      .filter((name): name is string => !!name);
    if (names.length <= 2) return names.join(', ');
    return this.language === 'pl' ? `Wybrano: ${names.length}` : `Selected: ${names.length}`;
  }

  private readStoredUserRole(): UserRole {
    const role = localStorage.getItem('powerguard-role');
    return role === 'ADMIN' || role === 'SERVICE' || role === 'ADVANCED_USER' ? role : 'USER';
  }

  private canEditSettings(): boolean {
    return this.authenticatedRole === 'ADMIN' || this.authenticatedRole === 'SERVICE';
  }

  private loadUsers(): void {
    this.usersBusy = true;
    this.authService.listUsers().subscribe({
      next: users => {
        this.users = users;
        this.deviceAutoLoginEnabled = !!localStorage.getItem('powerguard-device-token');
        this.usersBusy = false;
      },
      error: error => {
        this.usersBusy = false;
        this.usersError = error?.error?.message || this.t('userSaveFailed');
        if (error?.status === 401) this.clearAuthentication();
      },
    });
  }

  private loadAssignableSites(): void {
    this.meterService.listAssignableSites().subscribe({
      next: sites => { this.assignableSites = sites; },
      error: () => { this.assignableSites = []; },
    });
  }

  isManagedSiteSelected(siteId: number): boolean {
    return this.managedSiteIds.includes(siteId);
  }

  setManagedSiteSelected(siteId: number, selected: boolean): void {
    if (selected) {
      if (!this.managedSiteIds.includes(siteId)) this.managedSiteIds = [...this.managedSiteIds, siteId];
    } else {
      this.managedSiteIds = this.managedSiteIds.filter(id => id !== siteId);
    }
  }

  managedUserCanChooseRole(role: UserRole): boolean {
    return this.authenticatedRole === 'ADMIN' || role === 'USER' || role === 'ADVANCED_USER';
  }

  private resetManagedUserEditor(): void {
    this.editingUserId = null;
    this.managedUsername = '';
    this.managedFirstname = '';
    this.managedLastname = '';
    this.managedEmail = '';
    this.managedPhone = '';
    this.managedPassword = '';
    this.managedPasswordConfirm = '';
    this.managedRole = 'USER';
    this.managedEnabled = true;
    this.managedSiteIds = [];
  }

  private applyAuthenticatedUser(user: Partial<UserView>): void {
    if (user.id != null) {
      this.authenticatedUserId = Number(user.id);
      localStorage.setItem('powerguard-user-id', String(user.id));
    }
    if (user.username) {
      this.authenticatedUsername = user.username;
      localStorage.setItem('powerguard-username', user.username);
    }
    this.authenticatedFirstname = user.firstname || '';
    this.authenticatedLastname = user.lastname || '';
    localStorage.setItem('powerguard-firstname', this.authenticatedFirstname);
    localStorage.setItem('powerguard-lastname', this.authenticatedLastname);
    if (user.role === 'ADMIN' || user.role === 'SERVICE' || user.role === 'ADVANCED_USER' || user.role === 'USER') {
      this.authenticatedRole = user.role;
      localStorage.setItem('powerguard-role', user.role);
      if (user.role !== 'ADMIN' && (this.adminView === 'edgeConfiguration' || this.adminView === 'jsonData' || this.adminView === 'historyCleanup' || (this.adminView === 'measurementData' && user.role !== 'SERVICE') || this.adminView === 'sites')) {
        this.adminView = 'dashboard';
      }
      if ((user.role === 'ADVANCED_USER' || user.role === 'USER') && this.adminView !== 'dashboard') {
        this.adminView = 'dashboard';
      }
      if (this.adminView === 'settings' && !this.canEditSettings()) {
        this.adminView = 'dashboard';
      }
    }
  }

  private clearAuthentication(): void {
    ['powerguard-token', 'powerguard-user-id', 'powerguard-username',
      'powerguard-firstname', 'powerguard-lastname', 'powerguard-role']
      .forEach(key => localStorage.removeItem(key));
    this.sessionValidated = false;
    this.authenticated = false;
    this.meters = [];
    this.rangeLoadSequence.clear();
    this.stopAlarmSound();
    this.adminView = 'dashboard';
    this.authenticatedUserId = 0;
    this.authenticatedUsername = '';
    this.authenticatedFirstname = '';
    this.authenticatedLastname = '';
    this.authenticatedRole = 'USER';
    this.loginUsername = '';
    this.loginPassword = '';
    this.loginError = '';
    this.profileOpen = false;
    this.usersOpen = false;
    this.configuredMeters = [];
    this.adminClients = [];
    this.adminSites = [];
    this.assignableSites = [];
    this.resetMeterEditor();
  }


  private tickClock(): void {
    const now = new Date();
    this.now = now;

    // 1h / 2h / 4h / 8h / 1d are rolling live windows. The right edge advances by quarter
    // automatically, so the dashboard can be left open as a continuously moving view.
    if (this.selectedQuickRangeMinutes != null) {
      this.updateRollingQuickRange(now.getTime());
    }

    const currentQuarter = this.currentQuarterIndex(now);
    let quarterChanged = false;

    this.meters.forEach(meter => {
      if (meter.quarterIndex === currentQuarter) {
        meter.quarterProgress = this.currentQuarterProgress(now);
        return;
      }

      // Roll over all meter cards at the same clock boundary. Do not fabricate
      // a 0 kW reading in a new quarter before that meter has reported one.
      quarterChanged = true;
      meter.quarterIndex = currentQuarter;
      meter.currentQuarterPowerKw = null;
      meter.quarterProgress = 0;
      if (this.isSelectedToday()) {
        const index = now.getHours() * 4 + Math.floor(now.getMinutes() / 15);
        if (index >= 0 && index < meter.completedQuarterPowers.length) {
          meter.completedQuarterPowers[index] = null;
          meter.history[index] = null;
        }
      }
      this.rebuildMeter(meter, now);
    });

    // Synchronize completed quarter bars for both meters from persisted data.
    // Live telemetry will populate each new current-quarter bar independently.
    if (quarterChanged && this.rangeIncludesToday()) {
      this.meters.forEach(meter => this.loadRange(meter, true));
    }
  }

  private isTimestampInCurrentQuarter(value: string | null | undefined, now = new Date()): boolean {
    if (!value) return true;
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return true;
    return this.currentQuarterIndex(at) === this.currentQuarterIndex(now);
  }

  quarterSecondsRemaining(now = new Date()): number {
    const elapsed = (now.getMinutes() % 15) * 60 + now.getSeconds();
    return Math.max(0, 15 * 60 - elapsed);
  }

  quarterCountdown(now = new Date()): string {
    const total = this.quarterSecondsRemaining(now);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  quarterElapsedPercent(now = new Date()): number {
    return Math.round(this.currentQuarterProgress(now) * 100);
  }

  quarterEnergySoFarKwh(meter: MeterCard, now = new Date()): number {
    return meter.currentQuarterPowerKw == null ? 0 : Math.max(0, meter.currentQuarterPowerKw * 0.25);
  }

  lastReadingAgo(lastReadingAt: string): string {
    if (!lastReadingAt) return this.language === 'pl' ? 'brak odczytu' : 'no reading';
    const timestamp = new Date(lastReadingAt).getTime();
    if (!Number.isFinite(timestamp)) return this.language === 'pl' ? 'brak odczytu' : 'no reading';
    const seconds = Math.max(0, Math.floor((this.now.getTime() - timestamp) / 1000));
    if (seconds < 60) return this.language === 'pl' ? `${seconds}s.` : `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return this.language === 'pl' ? `${minutes} min` : `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return this.language === 'pl' ? `${hours} godz.` : `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return this.language === 'pl' ? `${days} d` : `${days} d ago`;
  }

  lastReadingLabel(): string {
    return this.language === 'pl' ? 'Ostatni odczyt' : 'Last reading';
  }

  lastReadingDisplay(lastReadingAt: string): string {
    if (!lastReadingAt) return this.language === 'pl' ? 'brak odczytu' : 'no reading';
    const value = new Date(lastReadingAt);
    if (Number.isNaN(value.getTime())) return this.language === 'pl' ? 'brak odczytu' : 'no reading';
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    const hh = String(value.getHours()).padStart(2, '0');
    const mi = String(value.getMinutes()).padStart(2, '0');
    const ss = String(value.getSeconds()).padStart(2, '0');
    const exact = this.language === 'pl'
      ? `${yyyy}.${mm}.${dd}, ${hh}:${mi}:${ss}`
      : `${yyyy}-${mm}-${dd}, ${hh}:${mi}:${ss}`;
    return `${exact} (${this.lastReadingAgo(lastReadingAt)})`;
  }

  lastReadingTitle(lastReadingAt: string): string {
    if (!lastReadingAt) return '';
    const value = new Date(lastReadingAt);
    if (Number.isNaN(value.getTime())) return '';
    return value.toLocaleString(this.language === 'pl' ? 'pl-PL' : 'en-GB');
  }

  formatPower(value: number | null): string {
    return value == null ? '—' : value.toFixed(1);
  }

  formatEnergySoFar(meter: MeterCard): string {
    return meter.currentQuarterPowerKw == null ? '—' : this.quarterEnergySoFarKwh(meter).toFixed(2);
  }

  quarterEnergyBudgetKwh(meter: MeterCard): number | null {
    return meter.limitKw == null ? null : Math.max(0, meter.limitKw * 0.25);
  }

  quarterEnergyUsagePercent(meter: MeterCard): number {
    if (meter.currentQuarterPowerKw == null) return 0;
    const budget = this.quarterEnergyBudgetKwh(meter);
    if (budget == null || budget <= 0) return 0;
    return Math.min(100, Math.max(0, this.quarterEnergySoFarKwh(meter, this.now) / budget * 100));
  }

  formatQuarterEnergyBudget(meter: MeterCard): string {
    const budget = this.quarterEnergyBudgetKwh(meter);
    return budget == null ? '—' : budget.toFixed(2);
  }

  formatQuarterLimit(meter: MeterCard): string {
    return meter.limitKw == null ? '—' : meter.limitKw.toFixed(1);
  }


  private meterQuarterProgressAtReading(meter: MeterCard): number {
    if (!meter.lastReadingAt) return 0;
    const at = new Date(meter.lastReadingAt);
    if (!Number.isFinite(at.getTime())) return 0;
    if (this.currentQuarterIndex(at) !== this.currentQuarterIndex(this.now)) return 0;
    return this.currentQuarterProgress(at);
  }

  formatElapsedQuarterAverage(meter: MeterCard): string {
    if (meter.currentQuarterPowerKw == null) return '—';
    // currentQuarterPowerKw = imported kWh since quarter start * 4.
    // Divide by elapsed fraction of 15 minutes to obtain the so-far average.
    // Suppress the first 30 seconds: a tiny denominator amplifies measurement noise.
    const progress = this.meterQuarterProgressAtReading(meter);
    if (progress < (30 / 900)) return '—';
    return (meter.currentQuarterPowerKw / progress).toFixed(1);
  }

  projectedQuarterPowerKw(meter: MeterCard): number | null {
    if (meter.currentQuarterPowerKw == null) return null;
    const progress = this.meterQuarterProgressAtReading(meter);
    if (progress < 30 / 900) return null;
    return meter.currentQuarterPowerKw / progress;
  }

  quarterRiskClass(meter: MeterCard): string {
    const projected = this.projectedQuarterPowerKw(meter);
    if (projected == null || meter.limitKw == null || meter.limitKw <= 0) return 'quarter-tank--green';
    const ratio = projected / meter.limitKw;
    // Color is based on projected quarter-average power, never on the kWh fill percentage.
    // Match the projected dashed bar: red at the alarm threshold, yellow from 90%.
    if (ratio >= 1) return 'quarter-tank--red';
    if (ratio >= 0.9) return 'quarter-tank--yellow';
    return 'quarter-tank--green';
  }

  xAxisTicks(meter: MeterCard): Array<{x:number,label:string}> {
    const left = 34, right = 1180;
    const start = this.meterChartStartMs(meter), end = this.meterChartEndMs(meter);
    const span = Math.max(1, end - start);
    return [0,1,2,3,4].map(i => {
      const ratio = i / 4;
      const at = new Date(start + span * ratio);
      let label: string;
      if (span <= 6 * 60 * 60 * 1000) {
        label = `${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
      } else if (span <= 24 * 60 * 60 * 1000) {
        label = `${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
      } else {
        label = `${String(at.getDate()).padStart(2,'0')}.${String(at.getMonth()+1).padStart(2,'0')}`;
      }
      return { x: left + ratio * (right-left), label };
    });
  }

  private meterChartStartMs(meter: MeterCard): number {
    return meter.chartZoomStartMs ?? this.rangeStartMs();
  }

  private meterChartEndMs(meter: MeterCard): number {
    return meter.chartZoomEndMs ?? this.rangeEndExclusiveMs();
  }

  onPowerChartWheel(event: WheelEvent, meter: MeterCard): void {
    this.selectedQuickRangeMinutes = null;
    // Match the Technius interaction: ordinary wheel keeps normal page scrolling,
    // Ctrl + wheel zooms the time axis around the mouse position.
    if (!event.ctrlKey) return;
    event.preventDefault();

    const fullStart = this.rangeStartMs();
    const fullEnd = this.rangeEndExclusiveMs();
    const fullSpan = Math.max(1, fullEnd - fullStart);

    const currentStart = this.meterChartStartMs(meter);
    const currentEnd = this.meterChartEndMs(meter);
    const currentSpan = Math.max(1, currentEnd - currentStart);

    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    const rawRatio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
    const plotRatio = Math.max(0, Math.min(1, (rawRatio - 34 / 1200) / ((1180 - 34) / 1200)));
    const anchor = currentStart + currentSpan * plotRatio;

    const zoomIn = event.deltaY < 0;
    const factor = zoomIn ? 0.75 : (1 / 0.75);
    const minSpan = Math.min(fullSpan, 5 * 60 * 1000);
    const nextSpan = Math.max(minSpan, Math.min(fullSpan, currentSpan * factor));

    if (!zoomIn && nextSpan >= fullSpan * 0.995) {
      meter.chartZoomStartMs = null;
      meter.chartZoomEndMs = null;
    } else {
      let nextStart = anchor - nextSpan * plotRatio;
      let nextEnd = nextStart + nextSpan;

      if (nextStart < fullStart) {
        nextStart = fullStart;
        nextEnd = nextStart + nextSpan;
      }
      if (nextEnd > fullEnd) {
        nextEnd = fullEnd;
        nextStart = nextEnd - nextSpan;
      }

      meter.chartZoomStartMs = Math.max(fullStart, nextStart);
      meter.chartZoomEndMs = Math.min(fullEnd, nextEnd);
    }

    this.rebuildMeter(meter, new Date());
    this.rebuildCommunicationDiagnostics(meter);
  }

  isPowerChartZoomed(meter: MeterCard): boolean {
    return meter.chartZoomStartMs != null && meter.chartZoomEndMs != null;
  }

  onPowerChartPointerDown(event: PointerEvent, meter: MeterCard): void {
    if (event.button !== 0 || !this.isPowerChartZoomed(meter)) return;

    const svg = event.currentTarget as SVGElement;
    meter.chartPanActive = true;
    meter.chartPanPointerId = event.pointerId;
    meter.chartPanStartClientX = event.clientX;
    meter.chartPanStartMs = this.meterChartStartMs(meter);
    meter.chartPanEndMs = this.meterChartEndMs(meter);

    try { svg.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  }

  onPowerChartPointerMove(event: PointerEvent, meter: MeterCard): void {
    if (!meter.chartPanActive || meter.chartPanPointerId !== event.pointerId) return;

    const svg = event.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;

    const plotWidthPx = rect.width * ((1180 - 34) / 1200);
    if (plotWidthPx <= 0) return;

    const span = Math.max(1, meter.chartPanEndMs - meter.chartPanStartMs);
    const dx = event.clientX - meter.chartPanStartClientX;
    const shiftMs = -(dx / plotWidthPx) * span;

    const fullStart = this.rangeStartMs();
    const fullEnd = this.rangeEndExclusiveMs();
    let nextStart = meter.chartPanStartMs + shiftMs;
    let nextEnd = meter.chartPanEndMs + shiftMs;

    if (nextStart < fullStart) {
      nextStart = fullStart;
      nextEnd = nextStart + span;
    }
    if (nextEnd > fullEnd) {
      nextEnd = fullEnd;
      nextStart = nextEnd - span;
    }

    meter.chartZoomStartMs = nextStart;
    meter.chartZoomEndMs = nextEnd;

    this.rebuildMeter(meter, new Date());
    this.rebuildCommunicationDiagnostics(meter);
    event.preventDefault();
  }

  onPowerChartPointerUp(event: PointerEvent, meter: MeterCard): void {
    if (!meter.chartPanActive) return;
    const svg = event.currentTarget as SVGElement;
    try {
      if (meter.chartPanPointerId != null) svg.releasePointerCapture(meter.chartPanPointerId);
    } catch {}
    meter.chartPanActive = false;
    meter.chartPanPointerId = null;
  }

  resetPowerChartZoom(meter: MeterCard): void {
    this.selectedQuickRangeMinutes = null;
    if (meter.chartZoomStartMs == null && meter.chartZoomEndMs == null) return;
    meter.chartZoomStartMs = null;
    meter.chartZoomEndMs = null;
    this.rebuildMeter(meter, new Date());
    this.rebuildCommunicationDiagnostics(meter);
  }

  networkYAxisTicks(range: string, unit: string): Array<{y: number; label: string}> {
    if (!range || range === '—') return [];
    const values = range.split('–').map(v => Number(v.trim()));
    if (values.length !== 2 || values.some(v => !Number.isFinite(v))) return [];
    const [min, max] = values;
    const pad = unit === 'V' || unit === 'A'
      ? Math.max((max-min)*0.08, Math.abs(max)*0.005, 0.1)
      : Math.max((max-min)*0.08, 0.02);
    const low = min-pad, high = max+pad;
    return [0,0.5,1].map(r => ({ y: 72-r*56, label: (low+(high-low)*r).toFixed(unit === 'V' ? 1 : 2) }));
  }

  onNetworkHover(event: MouseEvent, meter: MeterCard, chart: string): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.max(10, Math.min(710, (event.clientX-rect.left)*720/rect.width));
    const start = this.meterChartStartMs(meter);
    const at = start+(x-10)/700*(this.meterChartEndMs(meter)-start);
    const keys: Record<string, string[]> = {
      power: ['activePowerKw'], voltage: ['voltageL1V','voltageL2V','voltageL3V'],
      current: ['currentL1A','currentL2A','currentL3A'], frequency: ['frequencyHz']
    };
    const fields = keys[chart] || [];
    const rows = meter.dayMeasurements.filter(row => fields.some(key => Number.isFinite(Number((row as unknown as Record<string,unknown>)[key])) && (row as unknown as Record<string,unknown>)[key] != null));
    if (!rows.length) { meter.networkHover = undefined; return; }
    const closest = rows.reduce((best, row) => Math.abs(new Date(row.measuredAt).getTime()-at)<Math.abs(new Date(best.measuredAt).getTime()-at) ? row : best);
    const unit = chart === 'power' ? 'kW' : chart === 'voltage' ? 'V' : chart === 'current' ? 'A' : 'Hz';
    const valueText = fields.map((key,i) => {
      const val = (closest as unknown as Record<string,unknown>)[key];
      return typeof val === 'number' && Number.isFinite(val) ? `${fields.length>1?'L'+(i+1)+': ':''}${val.toFixed(2)} ${unit}` : '';
    }).filter(Boolean).join(' | ');
    const date = new Date(closest.measuredAt);
    meter.networkHover = { chart, x: Math.max(85,Math.min(630,x)), text: `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}  ${valueText}` };
  }

  networkXAxisTicks(meter: MeterCard): Array<{x:number,label:string}> {
    const left = 10, right = 710;
    const start = this.meterChartStartMs(meter), end = this.meterChartEndMs(meter);
    const span = Math.max(1, end - start);
    const spanDays = span / 86400000;
    return [0,1,2,3,4].map(i => {
      const ratio = i / 4;
      const at = new Date(start + span * ratio);
      const label = spanDays <= 1
        ? `${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`
        : `${String(at.getDate()).padStart(2,'0')}.${String(at.getMonth()+1).padStart(2,'0')}`;
      return { x: left + ratio * (right-left), label };
    });
  }

  quarterEnergyRemainingKwh(meter: MeterCard): number | null {
    if (meter.currentQuarterPowerKw == null) return null;
    const budget = this.quarterEnergyBudgetKwh(meter);
    if (budget == null) return null;
    return Math.max(0, budget - this.quarterEnergySoFarKwh(meter, this.now));
  }

  formatRemainingQuarterEnergy(meter: MeterCard): string {
    const value = this.quarterEnergyRemainingKwh(meter);
    return value == null ? '—' : value.toFixed(2);
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timerId);
    window.clearInterval(this.historyTimerId);
    window.clearInterval(this.clockTimerId);
    window.clearInterval(this.alarmTimerId);
    window.clearInterval(this.healthTimerId);
    window.clearInterval(this.rawMeasurementTimerId);
    this.stopAlarmSound();
    this.liveSubscription.unsubscribe();
    this.liveMeasurements.stop();
  }

  private createMeter(config: MeterConfigurationView): MeterCard {
    const limitKw = config.quarterHourAlarmOnKw;
    const meter: MeterCard = {
      id: `meter-${config.id}`,
      meterId: config.id,
      name: config.name,
      clientId: config.clientId,
      clientName: config.clientName,
      siteId: config.siteId,
      siteName: config.siteName,
      edgeId: config.edgeId,
      uniqueKey: config.uniqueKey,
      chartView: 'power',
      detailsCollapsed: true,
      status: 'OFFLINE',
      currentPowerKw: null,
      currentQuarterPowerKw: null,
      voltageL1V: null, voltageL2V: null, voltageL3V: null,
      currentL1A: null, currentL2A: null, currentL3A: null, frequencyHz: null,
      dayMeasurements: [],
      voltageL1Points: '', voltageL2Points: '', voltageL3Points: '',
      currentL1Points: '', currentL2Points: '', currentL3Points: '', powerPoints: '', frequencyPoints: '',
      powerSegments: [], voltageL1Segments: [], voltageL2Segments: [], voltageL3Segments: [],
      currentL1Segments: [], currentL2Segments: [], currentL3Segments: [], frequencySegments: [],
      serverCommunicationSegments: [], edgeCommunicationSegments: [], meterCommunicationSegments: [], communicationSamples: [],
      powerRange: '—', voltageRange: '—', currentRange: '—', frequencyRange: '—',
      quarterProgress: this.currentQuarterProgress(),
      lastUpdated: '',
      lastReadingAt: '',
      maxKw: this.niceMaximum(Math.max((limitKw ?? 0) * 1.2, 0.5)),
      linePoints: '',
      lineSegments: [],
      lineHoverPoints: [],
      chartZoomStartMs: null,
      chartZoomEndMs: null,
      chartPanActive: false,
      chartPanPointerId: null,
      chartPanStartClientX: 0,
      chartPanStartMs: 0,
      chartPanEndMs: 0,
      bars: [],
      yTicks: [],
      history: Array(96).fill(null),
      completedQuarterPowers: Array(96).fill(null),
      quarterTargetKw: 0,
      quarterIndex: this.currentQuarterIndex(),
      limitKw,
      limitY: 0,
      instantaneousAlarmOnKw: config.instantaneousAlarmOnKw,
      instantaneousAlarmOffKw: config.instantaneousAlarmOffKw,
      quarterHourAlarmOnKw: config.quarterHourAlarmOnKw,
      quarterHourAlarmOffKw: config.quarterHourAlarmOffKw,
      alarmHistory: [],
      activeAlarms: [],
      alarmAckBusy: false,
      showInstantPower: true,
      showQuarterBars: true,
      showLimit: true,
    };
    this.rebuildMeter(meter, new Date());
    return meter;
  }

  private selectedRangeDayCount(): number {
    const from = this.selectedDateFromAsLocalDate();
    const to = this.selectedDateToAsLocalDate();
    return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  }

  private readonly rangeLoadSequence = new Map<number, number>();

  private loadRangeMeasurementFallback(meter: MeterCard, sequence: number, preserveExistingOnEmpty: boolean): void {
    const days = this.selectedRangeDayCount();
    const isCurrentRequest = () => this.sessionValidated && this.rangeLoadSequence.get(meter.meterId) === sequence;
    const keepExisting = () => preserveExistingOnEmpty && meter.dayMeasurements.length > 0;

    // For short ranges, recover the complete chart from day endpoints if the sampled
    // range endpoint is unavailable or unexpectedly empty.
    if (days <= 7) {
      const requests = Array.from({ length: days }, (_, index) => {
        const d = this.selectedDateFromAsLocalDate();
        d.setDate(d.getDate() + index);
        return this.meterService.dayMeasurements(meter.meterId, this.toDateInputValue(d));
      });
      forkJoin(requests).subscribe({
        next: groups => {
          if (!isCurrentRequest()) return;
          const readings = groups.flat().sort((a,b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
          if (!readings.length && keepExisting()) {
            console.warn(`[PowerGuard] Empty measurement fallback for meter ${meter.meterId}; keeping ${meter.dayMeasurements.length} existing points.`);
            return;
          }
          this.applyDayMeasurements(meter, readings);
          if (this.selectedQuickRangeMinutes != null) this.updateRollingQuickRange();
          else this.rebuildMeter(meter, new Date());
        },
        error: error => {
          if (!isCurrentRequest()) return;
          if (keepExisting()) {
            console.warn(`[PowerGuard] Measurement fallback failed for meter ${meter.meterId}; keeping existing history.`, error);
            return;
          }
          meter.history = Array(96).fill(null);
          meter.completedQuarterPowers = Array(96).fill(null);
          meter.dayMeasurements = [];
          this.rebuildNetworkCharts(meter);
          this.rebuildMeter(meter, new Date());
        }
      });
      return;
    }

    // For long ranges, avoid downloading millions of raw rows. Fall back to the final
    // day so the chart does not disappear completely while preserving a light request.
    this.meterService.dayMeasurements(meter.meterId, this.selectedDateTo).subscribe({
      next: readings => {
        if (!isCurrentRequest()) return;
        if (!readings.length && keepExisting()) {
          console.warn(`[PowerGuard] Empty final-day measurement fallback for meter ${meter.meterId}; keeping existing history.`);
          return;
        }
        this.applyDayMeasurements(meter, readings);
        this.rebuildMeter(meter, new Date());
      },
      error: error => {
        if (!isCurrentRequest()) return;
        if (keepExisting()) {
          console.warn(`[PowerGuard] Final-day measurement fallback failed for meter ${meter.meterId}; keeping existing history.`, error);
          return;
        }
        meter.history = Array(96).fill(null);
        meter.completedQuarterPowers = Array(96).fill(null);
        meter.dayMeasurements = [];
        this.rebuildNetworkCharts(meter);
        this.rebuildMeter(meter, new Date());
      }
    });
  }

  private loadRange(meter: MeterCard, preserveExistingOnEmpty = false): void {
    if (!this.sessionValidated) return;
    const sequence = (this.rangeLoadSequence.get(meter.meterId) ?? 0) + 1;
    this.rangeLoadSequence.set(meter.meterId, sequence);
    const isCurrentRequest = () => this.sessionValidated && this.rangeLoadSequence.get(meter.meterId) === sequence;

    this.meterService.rangeMeasurements(meter.meterId, this.selectedDateFrom, this.selectedDateTo).subscribe({
      next: readings => {
        if (!isCurrentRequest()) return;
        if (readings.length) {
          this.applyDayMeasurements(meter, readings);
          this.rebuildMeter(meter, new Date());
        } else {
          console.warn(`[PowerGuard] Empty range response for meter ${meter.meterId}, ${this.selectedDateFrom}..${this.selectedDateTo}; trying day fallback.`);
          this.loadRangeMeasurementFallback(meter, sequence, preserveExistingOnEmpty);
        }
      },
      error: error => {
        if (!isCurrentRequest()) return;
        console.warn(`[PowerGuard] Range request failed for meter ${meter.meterId}; trying day fallback.`, error);
        this.loadRangeMeasurementFallback(meter, sequence, preserveExistingOnEmpty);
      },
    });
    this.meterService.rangeAlarms(meter.meterId, this.selectedDateFrom, this.selectedDateTo).subscribe({
      next: alarms => {
        meter.alarmHistory = alarms;
        if (this.rangeIncludesToday()) {
          meter.activeAlarms = alarms.filter(a => a.active);
          if (meter.activeAlarms.length) meter.status = 'WARNING';
          this.updateAlarmSound();
        }
      },
      error: () => meter.alarmHistory = [],
    });
    this.meterService.communicationHistory(meter.clientId, meter.siteId, meter.edgeId, meter.uniqueKey, this.selectedDateFrom, this.selectedDateTo).subscribe({
      next: samples => {
        meter.communicationSamples = samples;
        this.rebuildAllCommunicationDiagnostics();
        this.rebuildNetworkCharts(meter);
      },
      error: () => {
        meter.communicationSamples = [];
        this.rebuildAllCommunicationDiagnostics();
      },
    });
  }

  private refreshAlarmStatus(meter: MeterCard): void {
    if (!this.sessionValidated) return;
    const previousActiveIds = new Set(meter.activeAlarms.map(a => a.id));
    this.meterService.activeAlarms(meter.meterId).subscribe({
      next: alarms => {
        if (!this.sessionValidated) return;
        meter.activeAlarms = alarms;
        if (meter.currentPowerKw != null) meter.status = alarms.length ? 'WARNING' : 'ONLINE';
        this.syncActiveAlarmsIntoHistory(meter, alarms);
        const resolved = [...previousActiveIds].some(id => !alarms.some(a => a.id === id));
        if (resolved && this.rangeIncludesToday()) {
          this.meterService.rangeAlarms(meter.meterId, this.selectedDateFrom, this.selectedDateTo).subscribe({ next: history => meter.alarmHistory = history });
        }
        this.updateAlarmSound();
      },
    });
  }

  private refreshAllActiveAlarms(): void {
    if (!this.sessionValidated) return;
    this.meters.forEach(m => this.refreshAlarmStatus(m));
  }

  private syncActiveAlarmsIntoHistory(meter: MeterCard, alarms: AlarmView[]): void {
    const byId = new Map(meter.alarmHistory.map(a => [a.id, a]));
    alarms.forEach(a => byId.set(a.id, a));
    meter.alarmHistory = [...byId.values()].sort((a,b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  activeAlarmSummary(meter: MeterCard): string {
    const parts = meter.activeAlarms.map(a => {
      const label = this.alarmTypeLabel(a.type);
      const value = a.maxValue ?? a.startValue;
      const limit = a.type === 'INSTANTANEOUS_POWER' ? meter.instantaneousAlarmOnKw : meter.quarterHourAlarmOnKw;
      if (value == null || limit == null) return label;
      return `${label}: ${Number(value).toFixed(1)} kW > ${Number(limit).toFixed(1)} kW`;
    });
    return parts.join(' · ');
  }

  hasUnacknowledgedAlarm(meter: MeterCard): boolean { return meter.activeAlarms.some(a => !a.acknowledged); }
  hasAcknowledgedActiveAlarm(meter: MeterCard): boolean { return meter.activeAlarms.length > 0 && meter.activeAlarms.every(a => a.acknowledged); }

  hasActiveAlarmType(meter: MeterCard, type: AlarmView['type']): boolean {
    return meter.activeAlarms.some(a => a.type === type);
  }

  activeAlarmOfType(meter: MeterCard, type: AlarmView['type']): AlarmView | null {
    return meter.activeAlarms.find(a => a.type === type) ?? null;
  }

  hasUnacknowledgedAlarmType(meter: MeterCard, type: AlarmView['type']): boolean {
    return meter.activeAlarms.some(a => a.type === type && !a.acknowledged);
  }

  activeAlarmDisplayValue(meter: MeterCard, alarm: AlarmView): number | null {
    if (alarm.type === 'INSTANTANEOUS_POWER') return meter.currentPowerKw ?? alarm.maxValue ?? alarm.startValue;
    return meter.currentQuarterPowerKw ?? alarm.maxValue ?? alarm.startValue;
  }

  activeAlarmThreshold(meter: MeterCard, alarm: AlarmView): number | null {
    return alarm.type === 'INSTANTANEOUS_POWER' ? meter.instantaneousAlarmOnKw : meter.quarterHourAlarmOnKw;
  }

  acknowledgeAlarmType(meter: MeterCard, type: AlarmView['type']): void {
    const pending = meter.activeAlarms.filter(a => a.type === type && !a.acknowledged);
    if (!pending.length || meter.alarmAckBusy) return;

    meter.alarmAckBusy = true;
    forkJoin(pending.map(alarm =>
      this.meterService.acknowledgeAlarm(alarm.id, this.authenticatedUsername || 'dashboard')
    )).subscribe({
      next: updatedAlarms => {
        const byId = new Map(updatedAlarms.map(a => [a.id, a]));
        meter.activeAlarms = meter.activeAlarms.map(a => byId.get(a.id) ?? a);
        meter.alarmHistory = meter.alarmHistory.map(a => byId.get(a.id) ?? a);
        meter.alarmAckBusy = false;
        this.updateAlarmSound();
      },
      error: () => {
        meter.alarmAckBusy = false;
        this.toast.showError(this.language === 'pl'
          ? 'Nie udało się potwierdzić alarmu.'
          : 'Could not acknowledge the alarm.');
      }
    });
  }

  acknowledgeAllAlarms(meter: MeterCard): void {
    const pending = meter.activeAlarms.filter(a => !a.acknowledged);
    if (!pending.length || meter.alarmAckBusy) return;
    meter.alarmAckBusy = true;
    forkJoin(pending.map(alarm =>
      this.meterService.acknowledgeAlarm(alarm.id, this.authenticatedUsername || 'dashboard')
    )).subscribe({
      next: updatedAlarms => {
        const byId = new Map(updatedAlarms.map(a => [a.id, a]));
        meter.activeAlarms = meter.activeAlarms.map(a => byId.get(a.id) ?? a);
        meter.alarmHistory = meter.alarmHistory.map(a => byId.get(a.id) ?? a);
        meter.alarmAckBusy = false;
        this.updateAlarmSound();
        this.toast.showSuccess(this.language === 'pl' ? 'Alarm potwierdzony. Dźwięk wyłączony.' : 'Alarm acknowledged. Sound stopped.');
      },
      error: err => {
        meter.alarmAckBusy = false;
        this.toast.showError(this.language === 'pl'
          ? 'Nie udało się potwierdzić alarmu.'
          : 'Could not acknowledge the alarm.');
        console.error('[ALARM] Acknowledge failed', err);
      }
    });
  }

  unlockAlarmAudio(): void {
    if (this.alarmAudio) return;
    const audio = new Audio('alarm.wav');
    audio.loop = true;
    audio.volume = 0;
    this.alarmAudio = audio;
    audio.play().then(() => { audio.pause(); audio.currentTime = 0; audio.volume = this.alarmVolume / 100; }).catch(() => { audio.volume = this.alarmVolume / 100; });
  }

  private updateAlarmSound(): void {
    const shouldRing = this.meters.some(m => m.activeAlarms.some(a => !a.acknowledged));
    if (!shouldRing) { this.stopAlarmSound(); return; }
    if (!this.alarmAudio) {
      this.alarmAudio = new Audio('alarm.wav');
      this.alarmAudio.loop = true;
      this.alarmAudio.volume = this.alarmVolume / 100;
    }
    if (this.alarmAudio.paused) this.alarmAudio.play().catch(() => undefined);
  }

  private stopAlarmSound(): void {
    if (!this.alarmAudio) return;
    this.alarmAudio.pause();
    this.alarmAudio.currentTime = 0;
  }

  private emptyApplicationSettings(): ApplicationSettingsView {
    return { companyName: null, installationName: null, address: null, nip: null, email: null, phone: null, contactPerson: null };
  }

  private loadApplicationSettings(): void {
    this.settingsService.get().subscribe({
      next: value => { this.applicationSettings = value || this.emptyApplicationSettings(); this.copySettingsToEditor(); },
      error: () => { this.applicationSettings = this.emptyApplicationSettings(); },
    });
  }

  private loadBackendVersion(): void {
    this.meterService.backendVersion().subscribe({
      next: value => this.backendVersion = value?.backendVersion || '—',
      error: () => this.backendVersion = '—',
    });
  }

  private copySettingsToEditor(): void {
    const value = this.applicationSettings || this.emptyApplicationSettings();
    this.settingsCompanyName = value.companyName || '';
    this.settingsInstallationName = value.installationName || '';
    this.settingsAddress = value.address || '';
    this.settingsNip = value.nip || '';
    this.settingsEmail = value.email || '';
    this.settingsPhone = value.phone || '';
    this.settingsContactPerson = value.contactPerson || '';
    this.settingsError = '';
  }

  saveApplicationSettings(): void {
    if (!this.canEditSettings() || this.settingsBusy) return;
    this.settingsBusy = true;
    this.settingsError = '';
    const value: ApplicationSettingsView = {
      companyName: this.settingsCompanyName.trim() || null,
      installationName: this.settingsInstallationName.trim() || null,
      address: this.settingsAddress.trim() || null,
      nip: this.settingsNip.trim() || null,
      email: this.settingsEmail.trim() || null,
      phone: this.settingsPhone.trim() || null,
      contactPerson: this.settingsContactPerson.trim() || null,
    };
    this.settingsService.update(value).subscribe({
      next: updated => {
        this.applicationSettings = updated;
        this.copySettingsToEditor();
        this.settingsBusy = false;
        this.toast.showSuccess(this.t('settingsSaved'));
      },
      error: error => {
        this.settingsBusy = false;
        this.settingsError = error?.error?.message || this.t('settingsSaveFailed');
        this.toast.showError(this.settingsError);
      },
    });
  }

  resetApplicationSettingsEditor(): void {
    if (this.settingsBusy) return;
    this.copySettingsToEditor();
  }

  infoCompanyDisplay(): string {
    return this.applicationSettings.companyName || '-';
  }

  infoEdgeVersion(): string {
    const preferred = this.selectedEdgeHealth();
    if (preferred?.version?.trim()) return preferred.version.trim();
    const fallback = this.edgeHealth.find(edge => !!edge.version?.trim());
    return fallback?.version?.trim() || '';
  }

  hasInfoContactSection(): boolean {
    return !!(
      this.applicationSettings.contactPerson?.trim()
      || this.applicationSettings.email?.trim()
      || this.applicationSettings.phone?.trim()
    );
  }

  hasInfoEndUserSection(): boolean {
    return !!(
      this.applicationSettings.companyName?.trim()
      || this.applicationSettings.installationName?.trim()
      || this.applicationSettings.address?.trim()
      || this.applicationSettings.nip?.trim()
      || this.hasInfoContactSection()
    );
  }

  setAdminView(view: 'dashboard' | 'health' | 'sites' | 'edgeConfiguration' | 'jsonData' | 'measurementData' | 'historyCleanup' | 'configuration' | 'settings'): void {
    if ((this.authenticatedRole === 'USER' || this.authenticatedRole === 'ADVANCED_USER') && view !== 'dashboard') { this.adminView = 'dashboard'; return; }
    if ((view === 'edgeConfiguration' || view === 'jsonData' || view === 'historyCleanup') && this.authenticatedRole !== 'ADMIN') {
      this.adminView = 'dashboard';
      return;
    }
    if (view === 'measurementData' && this.authenticatedRole !== 'ADMIN' && this.authenticatedRole !== 'SERVICE') { this.adminView = 'dashboard'; return; }
    if (view === 'configuration' && this.authenticatedRole === 'ADVANCED_USER') { this.adminView = 'dashboard'; return; }
    if (view === 'sites' && this.authenticatedRole !== 'ADMIN') { this.adminView = 'dashboard'; return; }
    if ((view === 'measurementData' || view === 'jsonData') && !this.rawMeasurementTabVisible()) {
      this.adminView = 'edgeConfiguration';
      return;
    }
    if (view === 'settings' && !this.canEditSettings()) {
      this.adminView = 'dashboard';
      return;
    }

    this.adminView = view;
    if (view === 'health' || view === 'edgeConfiguration' || (view === 'measurementData' || view === 'jsonData')) this.loadEdgeHealth();
    if (view === 'sites') { this.loadAdminClients(); this.loadAdminSites(); }
    if (view === 'settings') this.copySettingsToEditor();
    if ((view === 'edgeConfiguration' || (view === 'measurementData' || view === 'jsonData')) && this.selectedEdgeConfigKey && this.authenticatedRole === 'ADMIN') this.loadSelectedEdgeConfiguration();
    if ((view === 'measurementData' || view === 'jsonData')) this.loadRawMeasurementData(true);
  }

  private loadEdgeHealth(): void {
    this.meterService.edgeHealth().subscribe({
      next: values => {
        this.edgeHealth = values;
        if (this.editingMeterId === null) this.syncMeterEditorEdgeId();
        const selectedStillExists = values.some(edge => this.edgeKey(edge) === this.selectedEdgeConfigKey);
        if (!selectedStillExists && values.length > 0) {
          const preferred = this.edgeConfiguration
            ? values.find(edge => edge.siteId === this.edgeConfiguration!.siteId && edge.edgeId === this.edgeConfiguration!.edgeId)
            : undefined;
          this.selectedEdgeConfigKey = this.edgeKey(preferred || values[0]);
          if (this.authenticatedRole === 'ADMIN') this.loadSelectedEdgeConfiguration();
        } else if (!this.selectedEdgeConfigKey && values.length > 0) {
          this.selectedEdgeConfigKey = this.edgeKey(values[0]);
          if (this.authenticatedRole === 'ADMIN') this.loadSelectedEdgeConfiguration();
        }
      },
      error: () => this.edgeHealth = []
    });
  }

  deleteEdgeHealth(edge: EdgeHealthView): void {
    if (this.authenticatedRole !== 'ADMIN' || edge.status !== 'OFFLINE') return;
    if (!window.confirm(this.t('confirmDeleteEdgeHealth'))) return;

    const key = this.edgeKey(edge);
    this.meterService.deleteEdgeHealth(edge.clientId, edge.siteId, edge.edgeId).subscribe({
      next: () => {
        this.edgeHealth = this.edgeHealth.filter(item => this.edgeKey(item) !== key);
        if (this.expandedEdgeKey === key) this.expandedEdgeKey = null;

        if (this.selectedEdgeConfigKey === key) {
          this.selectedEdgeConfigKey = this.edgeHealth.length ? this.edgeKey(this.edgeHealth[0]) : '';
          this.edgeConfiguration = null;
          this.edgeConfigurationError = '';
          if (this.adminView === 'edgeConfiguration' && this.selectedEdgeConfigKey) {
            this.loadSelectedEdgeConfiguration();
          }
        }

        this.toast.showSuccess(this.t('edgeHealthDeleted'));
      },
      error: () => this.toast.showError(this.t('deleteEdgeHealthFailed'))
    });
  }

  edgeKey(edge: EdgeHealthView): string {
    return `${edge.clientId}|||${edge.siteId}|||${edge.edgeId}`;
  }

  toggleEdgeDetails(edge: EdgeHealthView): void {
    const key = this.edgeKey(edge);
    this.expandedEdgeKey = this.expandedEdgeKey === key ? null : key;
  }

  edgeIsExpanded(edge: EdgeHealthView): boolean {
    return this.expandedEdgeKey === this.edgeKey(edge);
  }

  edgeIp(edge: EdgeHealthView): string {
    return edge.ipAddresses?.length ? edge.ipAddresses.join(', ') : '—';
  }

  edgeMqttConnected(edge: EdgeHealthView): boolean {
    return !!edge.mqttTargets?.some(target => target.connected);
  }

  selectedEdgeSerialPorts(edge: EdgeHealthView): string {
    const ports = [...new Set(
      (edge.meters || [])
        .map(meter => (meter.serialPortName || '').trim())
        .filter(port => !!port)
    )];
    return ports.length ? ports.join(', ') : '—';
  }

  edgeMeterSummary(edge: EdgeHealthView): string {
    const meters = edge.meters || [];
    const online = meters.filter(m => m.status === 'ONLINE').length;
    return `${online}/${meters.length}`;
  }

  formatBytes(value: number | null | undefined): string {
    if (value == null || value < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(value), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  onEdgeConfigSelectionChanged(): void {
    this.edgeConfiguration = null;
    this.edgeConfigurationError = '';
    this.loadSelectedEdgeConfiguration();
  }

  private selectedEdgeHealth(): EdgeHealthView | null {
    return this.edgeHealth.find(edge => this.edgeKey(edge) === this.selectedEdgeConfigKey) || null;
  }

  loadSelectedEdgeConfiguration(): void {
    const edge = this.selectedEdgeHealth();
    if (!edge) return;
    this.edgeConfigurationBusy = true;
    this.edgeConfigurationError = '';
    this.meterService.edgeConfiguration(edge.clientId, edge.siteId, edge.edgeId).subscribe({
      next: config => {
        this.edgeConfiguration = {
          ...config,
          mqttTargets: (config.mqttTargets || []).map(target => ({ ...target, password: '' })),
          meters: (config.meters || []).map(meter => ({
            meterType: 'UNCONFIGURED',
            ctPrimaryA: 1, ctSecondaryA: 1, vtPrimaryV: 1, vtSecondaryV: 1,
            ...meter,
            powerReadingMode: meter.powerReadingMode && ['DIRECT', 'IMPORT_EXPORT', 'VOLTAGE_CURRENT_PF'].includes(meter.powerReadingMode) ? meter.powerReadingMode : (meter.meterType === '1F' ? 'DIRECT' : meter.meterType === '3F' ? 'IMPORT_EXPORT' : 'UNCONFIGURED'),
            readingReference: 'SECONDARY' // Compatibility for older Edge versions; current Edge always scales.
          }))
        };
        this.edgeConfigurationBusy = false;
        if (!this.edgeConfiguration.includeRawObis && (this.adminView === 'measurementData' || this.adminView === 'jsonData')) {
          this.adminView = 'edgeConfiguration';
        }
        if (this.edgeConfiguration.includeRawObis) {
          const configuredKeys = this.edgeConfiguration.meters.map(m => m.uniqueName);
          if (!this.selectedRawMeterKey || !configuredKeys.includes(this.selectedRawMeterKey)) {
            this.selectedRawMeterKey = configuredKeys[0] || '';
          }
          if ((this.adminView === 'measurementData' || this.adminView === 'jsonData')) this.loadRawMeasurementData(true);
        }
      },
      error: () => {
        this.edgeConfiguration = null;
        this.edgeConfigurationError = this.t('edgeConfigurationUnavailable');
        this.edgeConfigurationBusy = false;
      }
    });
  }

  jsonDataLabel(): string { return this.language === 'pl' ? 'Dane JSON' : 'JSON data'; }

  selectedTelemetryJson(): string {
    const snapshot = this.selectedRawMeasurement();
    return snapshot ? JSON.stringify(snapshot.telemetry ?? snapshot, null, 2) : '';
  }

  async copyTelemetryJson(): Promise<void> {
    const json = this.selectedTelemetryJson();
    if (!json) return;
    try { await navigator.clipboard.writeText(json); }
    catch (error) { console.error('Cannot copy telemetry JSON', error); }
  }

  rawMeasurementTabVisible(): boolean {
    return this.authenticatedRole === 'SERVICE' || (this.authenticatedRole === 'ADMIN' && !!this.edgeConfiguration?.includeRawObis);
  }

  loadRawMeasurementData(showBusy = true): void {
    if (!this.rawMeasurementTabVisible()) {
      this.rawMeasurementData = [];
      return;
    }
    const edge = this.selectedEdgeHealth();
    if (!edge) return;
    if (showBusy) this.rawMeasurementDataBusy = true;
    this.rawMeasurementDataError = '';
    this.meterService.edgeRawMeasurements(edge.clientId, edge.siteId, edge.edgeId).subscribe({
      next: values => {
        this.rawMeasurementData = values || [];
        const validKeys = this.rawMeterKeys();
        if (!this.selectedRawMeterKey || !validKeys.includes(this.selectedRawMeterKey)) {
          this.selectedRawMeterKey = validKeys[0] || '';
        }
        this.rawMeasurementDataBusy = false;
      },
      error: () => {
        this.rawMeasurementDataError = this.t('measurementDataLoadError');
        this.rawMeasurementDataBusy = false;
      }
    });
  }

  selectedRawMeasurement(): EdgeRawMeasurementView | null {
    return this.rawMeasurementData.find(v => v.meterUniqueKey === this.selectedRawMeterKey) || null;
  }

  rawMeterKeys(): string[] {
    const configured = this.edgeConfiguration?.meters?.map(m => m.uniqueName).filter(Boolean) || [];
    const health = this.selectedEdgeHealth()?.meters?.map(m => m.meterId).filter(Boolean) || [];
    const received = this.rawMeasurementData.map(v => v.meterUniqueKey).filter(Boolean);
    return [...new Set([...configured, ...health, ...received])];
  }

  selectedRawMeterHealth(): EdgeMeterHealthView | null {
    return this.selectedEdgeHealth()?.meters?.find(m => m.meterId === this.selectedRawMeterKey) || null;
  }

  selectedRawMeterConfig(): EdgeMeterConfig | null {
    return this.edgeConfiguration?.meters?.find(m => m.uniqueName === this.selectedRawMeterKey) || null;
  }

  obisFilter = '';

  filteredRawObisRows(snapshot: EdgeRawMeasurementView | null): RawObisRow[] {
    const rows = this.rawObisRows(snapshot);
    const filter = this.obisFilter.trim().toLowerCase();
    if (!filter) return rows;
    return rows.filter(row => [row.code, row.value, row.unit, row.raw].some(value => value.toLowerCase().includes(filter)));
  }

  rawObisRows(snapshot: EdgeRawMeasurementView | null): RawObisRow[] {
    if (!snapshot?.rawObis) return [];
    const raw = snapshot.rawObis as any;
    if (Array.isArray(raw)) {
      return raw.map((entry: any, index: number) => ({
        code: String(entry?.obis ?? entry?.code ?? entry?.key ?? index),
        value: String(entry?.value ?? entry?.parsedValue ?? ''),
        unit: String(entry?.unit ?? ''),
        raw: String(entry?.raw ?? entry?.rawValue ?? entry?.value ?? '')
      }));
    }
    if (typeof raw === 'object') {
      return Object.entries(raw).map(([code, entry]: [string, any]) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          return {
            code,
            value: String(entry.value ?? entry.parsedValue ?? entry.text ?? ''),
            unit: String(entry.unit ?? ''),
            raw: String(entry.raw ?? entry.rawValue ?? entry.value ?? '')
          };
        }
        const value = entry == null ? '' : String(entry);
        return { code, value, unit: '', raw: `${code}(${value})` };
      });
    }
    return [];
  }

  rawSummaryValue(value: unknown): string {
    return value == null || value === '' ? '—' : String(value);
  }

  rawBccLabel(snapshot: EdgeRawMeasurementView | null): string {
    const value = snapshot?.quality?.bccValid;
    if (value == null) return '—';
    return value ? 'VALID' : 'INVALID';
  }

  rawDurationLabel(snapshot: EdgeRawMeasurementView | null): string {
    const ms = snapshot?.quality?.readDurationMs;
    if (ms == null || !Number.isFinite(Number(ms))) return '—';
    return `${(Number(ms) / 1000).toFixed(2)} s`;
  }

  rawFinishedAt(snapshot: EdgeRawMeasurementView | null): string {
    const value = snapshot?.measuredAt || snapshot?.receivedAt;
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(this.language === 'pl' ? 'pl-PL' : 'en-GB');
  }

  addMqttTarget(): void {
    if (!this.edgeConfiguration) return;
    this.edgeConfiguration.mqttTargets.push({
      enabled: true,
      serverIp: '127.0.0.1', port: 1883, username: 'powerGuard',
      password: '', qos: 1, retainStatus: true
    });
  }

  removeMqttTarget(index: number): void {
    if (!this.edgeConfiguration || this.edgeConfiguration.mqttTargets.length <= 1) return;
    this.edgeConfiguration.mqttTargets.splice(index, 1);
  }

  addEdgeMeter(): void {
    if (!this.edgeConfiguration) return;
    const ports = this.availableSerialPorts();
    this.edgeConfiguration.meters.push({
      enabled: true,
      serialPortName: ports.find(p => !this.edgeConfiguration!.meters.some(m => m.serialPortName === p)) || '',
      uniqueName: `meter-${this.edgeConfiguration.meters.length + 1}`,
      address: '',
      pollDelaySeconds: 1,
      meterType: 'UNCONFIGURED', powerReadingMode: 'UNCONFIGURED',
      readingReference: 'SECONDARY',
      ctPrimaryA: 1,
      ctSecondaryA: 1,
      vtPrimaryV: 1,
      vtSecondaryV: 1
    });
  }

  edgeTransformerRatio(meter: EdgeMeterConfig, kind: 'ct' | 'vt'): number {
    const primary = kind === 'ct' ? meter.ctPrimaryA : meter.vtPrimaryV;
    const secondary = kind === 'ct' ? meter.ctSecondaryA : meter.vtSecondaryV;
    return Number(primary ?? 1) / Number(secondary ?? 1);
  }

  updateEdgeTransformerRatio(meter: EdgeMeterConfig, kind: 'ct' | 'vt', value: number): void {
    const ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    // Preserve the existing secondary transformer rating (e.g., 5 A / 100 V).
    if (kind === 'ct') {
      const secondary = Number(meter.ctSecondaryA ?? 1);
      if (!(secondary > 0)) return;
      meter.ctPrimaryA = ratio * secondary;
    } else {
      const secondary = Number(meter.vtSecondaryV ?? 1);
      if (!(secondary > 0)) return;
      meter.vtPrimaryV = ratio * secondary;
    }
  }

  edgeMeterRatiosValid(meter: EdgeMeterConfig): boolean {
    return ['ctPrimaryA', 'ctSecondaryA', 'vtPrimaryV', 'vtSecondaryV'].every(key => {
      const v = Number((meter as any)[key] ?? 1);
      return Number.isFinite(v) && v > 0;
    });
  }

  removeEdgeMeter(index: number): void {
    if (!this.edgeConfiguration) return;
    this.edgeConfiguration.meters.splice(index, 1);
  }

  private buildTimeZoneOptions(): string[] {
    const intl = Intl as any;
    const zones: string[] = typeof intl.supportedValuesOf === 'function'
      ? intl.supportedValuesOf('timeZone')
      : ['Europe/Warsaw', 'UTC'];
    return zones.includes('Europe/Warsaw') ? zones : ['Europe/Warsaw', ...zones];
  }

  timeZoneSearchLabel(zone: string): string {
    const aliases: Record<string, string> = {
      'Europe/Warsaw': 'Poland / Polska',
      'Europe/London': 'United Kingdom / UK',
      'Europe/Berlin': 'Germany / Deutschland',
      'Europe/Paris': 'France',
      'Europe/Prague': 'Czechia / Czech Republic',
      'Europe/Bratislava': 'Slovakia',
      'Europe/Vilnius': 'Lithuania',
      'Europe/Riga': 'Latvia',
      'Europe/Tallinn': 'Estonia',
      'Europe/Kyiv': 'Ukraine'
    };
    return aliases[zone] ? `${aliases[zone]} — ${zone}` : zone;
  }

  availableSerialPorts(): string[] {
    return this.selectedEdgeHealth()?.serialPorts || [];
  }

  saveEdgeConfiguration(): void {
    const edge = this.selectedEdgeHealth();
    const config = this.edgeConfiguration;
    if (!edge || !config || this.edgeConfigurationBusy) return;
    if (config.meters.some(meter => !['DIRECT', 'IMPORT_EXPORT', 'VOLTAGE_CURRENT_PF'].includes(meter.powerReadingMode || ''))) {
      this.edgeConfigurationError = 'Select a power calculation method for every meter.';
      return;
    }
    if (config.meters.some(meter => !this.edgeMeterRatiosValid(meter))) {
      this.edgeConfigurationError = 'CT/VT transformer ratios must be positive numbers.';
      return;
    }
    this.edgeConfigurationBusy = true;
    this.edgeConfigurationError = '';
    const payload: EdgeConfigurationView = {
      ...config,
      clientId: config.clientId.trim(),
      siteId: config.siteId.trim(),
      edgeId: config.edgeId.trim(),
      timeZone: config.timeZone.trim(),
      mqttTargets: config.mqttTargets.map(target => {
        const copy: EdgeMqttTargetConfig = { ...target };
        if (!copy.password) delete copy.password;
        delete copy.passwordConfigured;
        return copy;
      }),
      meters: config.meters.map(meter => ({
        ...meter,
        // Keep the legacy meterType in Edge JSON for compatibility, but
        // derive it from the explicitly selected calculation method.
        meterType: meter.powerReadingMode === 'DIRECT' ? '1F' : '3F',
        readingReference: 'SECONDARY', // Legacy Edge compatibility; current Edge ignores this setting.
        serialPortName: meter.serialPortName.trim(),
        uniqueName: meter.uniqueName.trim(),
        address: meter.address?.trim() || ''
      }))
    };
    this.meterService.updateEdgeConfiguration(edge.clientId, edge.siteId, edge.edgeId, payload).subscribe({
      next: () => {
        this.edgeConfigurationBusy = false;
        this.toast.showSuccess(this.t('edgeConfigurationSaved'));
        // Edge configuration is owned by powerguard-edge.json, not by the backend database.
        // Refresh only Edge state after it has had time to apply and republish config/state.
        window.setTimeout(() => this.loadEdgeHealth(), 1800);
      },
      error: () => {
        this.edgeConfigurationBusy = false;
        this.edgeConfigurationError = this.t('edgeConfigurationSaveFailed');
      }
    });
  }

  formatHealthNumber(value: number | null | undefined, suffix = '%'): string {
    return value == null ? '—' : `${Number(value).toFixed(1)}${suffix}`;
  }

  formatUptime(seconds: number | null | undefined): string {
    if (seconds == null) return '—';
    const d=Math.floor(seconds/86400), h=Math.floor((seconds%86400)/3600), m=Math.floor((seconds%3600)/60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  }

  private applyDayMeasurements(meter: MeterCard, readings: MeasurementView[]): void {
    meter.dayMeasurements = readings;
    this.rebuildNetworkCharts(meter);
    this.rebuildAllCommunicationDiagnostics();
    const quarter = Array(96).fill(null) as Array<number | null>;
    const latestAt = Array(96).fill(-1) as number[];

    readings.forEach(reading => {
      if (reading.currentQuarterPowerKw == null) return;
      const at = new Date(reading.measuredAt);
      const index = at.getHours() * 4 + Math.floor(at.getMinutes() / 15);
      const time = at.getTime();
      if (index >= 0 && index < 96 && time >= latestAt[index]) {
        quarter[index] = Number(reading.currentQuarterPowerKw);
        latestAt[index] = time;
      }
    });

    meter.completedQuarterPowers = quarter;
    meter.history = [...quarter];
    this.putCurrentQuarterIntoChart(meter);
  }

  private rebuildMeter(meter: MeterCard, now: Date): void {
    const today = this.isSelectedToday();
    const currentIndex = today ? now.getHours() * 4 + Math.floor(now.getMinutes() / 15) : -1;
    meter.quarterProgress = today ? this.currentQuarterProgress(now) : 1;

    const chartStart = this.meterChartStartMs(meter);
    const chartEnd = this.meterChartEndMs(meter);
    const visibleMeasurements = meter.dayMeasurements.filter(r => {
      const at = new Date(r.measuredAt).getTime();
      return Number.isFinite(at) && at >= chartStart && at < chartEnd;
    });

    const values = visibleMeasurements.flatMap(r => [
      r.activePowerKw == null ? null : Number(r.activePowerKw),
      r.currentQuarterPowerKw == null ? null : Number(r.currentQuarterPowerKw)
    ]).filter((v): v is number => v !== null && Number.isFinite(v));
    if (this.rangeIncludesToday() && meter.currentPowerKw !== null) values.push(meter.currentPowerKw);
    if (this.rangeIncludesToday() && meter.currentQuarterPowerKw !== null) values.push(meter.currentQuarterPowerKw);
    if (meter.limitKw != null) values.push(meter.limitKw);
    const peak = Math.max(...values, 0.5);

    const limitScaleKw = meter.limitKw ?? 0;
    meter.maxKw = this.niceMaximum(Math.max(peak * 1.10, limitScaleKw * 1.05, 0.5));
    meter.yTicks = this.buildTicks(meter.maxKw, meter);
    meter.limitY = meter.limitKw == null ? 0 : this.valueToChartY(meter.limitKw, meter.maxKw, meter);
    meter.lineSegments = this.buildTimedLineSegments(visibleMeasurements, 'activePowerKw', meter.maxKw, chartStart, chartEnd, meter);
    meter.linePoints = meter.lineSegments.join(' ');
    meter.lineHoverPoints = this.buildTimedLineHoverPoints(visibleMeasurements, 'activePowerKw', meter.maxKw, chartStart, chartEnd, meter);
    meter.bars = this.buildTimedQuarterBars(visibleMeasurements, meter.maxKw, currentIndex, chartStart, chartEnd, meter);
  }

  get clientIds(): string[] {
    return [...new Set(this.meters.map(m => m.clientId))].sort((a, b) => a.localeCompare(b));
  }

  get siteIdentities(): Array<{clientId: string; siteId: string}> {
    const map = new Map<string, {clientId: string; siteId: string}>();
    this.meters.forEach(m => map.set(`${m.clientId}\n${m.siteId}`, { clientId: m.clientId, siteId: m.siteId }));
    return [...map.values()];
  }

  get publicDashboardClients(): ClientView[] {
    const used = new Set(this.clientIds);
    const mapped = this.clients.filter(client => client.enabled && used.has(client.clientId));
    const known = new Set(mapped.map(client => client.clientId));
    const fallback = this.clientIds.filter(id => !known.has(id)).map((id, index) => ({ id: -(index + 1), clientId: id, name: id, enabled: true, displayOrder: 10000 + index }));
    return [...mapped, ...fallback].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  get publicDashboardSites(): SiteView[] {
    const used = new Set(this.siteIdentities.map(x => `${x.clientId}\n${x.siteId}`));
    const mapped = this.sites.filter(site => site.enabled && used.has(`${site.clientId}\n${site.siteId}`));
    const known = new Set(mapped.map(site => `${site.clientId}\n${site.siteId}`));
    const fallback = this.siteIdentities.filter(x => !known.has(`${x.clientId}\n${x.siteId}`)).map((x, index) => ({ id: -(10000 + index), clientId: x.clientId, clientName: this.clientDisplayName(x.clientId), siteId: x.siteId, name: x.siteId, enabled: true, displayOrder: 10000 + index }));
    return [...mapped, ...fallback].sort((a, b) => a.clientId.localeCompare(b.clientId) || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  get publicDashboardSitesForSelectedClient(): SiteView[] {
    return this.publicDashboardSites.filter(site => site.clientId === this.selectedClientId);
  }

  clientDisplayName(clientId: string): string { return this.clients.find(c => c.clientId === clientId)?.name || clientId; }
  siteDisplayName(clientId: string, siteId: string): string { return this.sites.find(site => site.clientId === clientId && site.siteId === siteId)?.name || siteId; }
  get selectedClientDisplayName(): string { return this.clientDisplayName(this.selectedClientId); }
  get selectedSiteDisplayName(): string { return this.siteDisplayName(this.selectedClientId, this.selectedSiteId); }
  get hideDuplicateSingleSiteContext(): boolean {
    return this.publicDashboardClients.length === 1 && this.publicDashboardSitesForSelectedClient.length === 1
      && this.selectedClientDisplayName === this.selectedSiteDisplayName;
  }

  get visibleMeters(): MeterCard[] {
    return this.meters.filter(m => (!this.selectedClientId || m.clientId === this.selectedClientId) && (!this.selectedSiteId || m.siteId === this.selectedSiteId));
  }

  selectClient(clientId: string): void {
    this.selectedClientId = clientId;
    localStorage.setItem('powerguard-client-id', clientId);
    const sites = this.publicDashboardSitesForSelectedClient;
    if (!sites.some(s => s.siteId === this.selectedSiteId)) this.selectSite(sites[0]?.siteId || '');
  }

  selectSite(siteId: string): void {
    this.selectedSiteId = siteId;
    if (siteId) localStorage.setItem('powerguard-site-id', siteId); else localStorage.removeItem('powerguard-site-id');
  }

  setMeterChartView(meter: MeterCard, view: 'power' | 'network' | 'alarms'): void {
    if (meter.chartView === view) return;
    meter.chartView = view;
    // SVG plotting coordinates depend on the active layout and the available height.
    // Recalculate when coming back from Network Parameters / Alarm History.
    if (view === 'power') this.rebuildMeter(meter, new Date());
  }

  toggleMeterDetails(meter: MeterCard): void {
    meter.detailsCollapsed = !meter.detailsCollapsed;
    // Rebuild chart coordinates because focus mode uses a taller SVG geometry.
    this.rebuildMeter(meter, new Date());
  }

  powerChartViewHeight(meter: MeterCard): number {
    if (meter.chartView !== 'power') return 285;
    // The SVG viewBox must match its CSS-rendered height. Previously the
    // chart was rendered at 320px but retained 650-850 viewBox units,
    // flattening axis ticks and all text vertically (preserveAspectRatio=none).
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 720;
    if (this.isMeterExpanded(meter)) return narrow ? 285 : 320;
    return narrow ? 285 : 320;
  }

  powerChartViewBox(meter: MeterCard): string {
    return `0 0 1200 ${this.powerChartViewHeight(meter)}`;
  }

  powerChartBottom(meter: MeterCard): number {
    return this.powerChartViewHeight(meter) - 41;
  }

  powerChartXAxisLabelY(meter: MeterCard): number {
    return this.powerChartViewHeight(meter) - 15;
  }


  toggleMeterExpanded(meter: MeterCard): void {
    this.expandedMeterId = this.expandedMeterId === meter.id ? null : meter.id;
    // Expanded and normal single-row layouts use different chart geometry.
    this.rebuildMeter(meter, new Date());
  }

  isMeterExpanded(meter: MeterCard): boolean { return this.expandedMeterId === meter.id; }

  // The two export header rows deliberately distinguish stored measurements from
  // additional OBIS registers. Missing registers remain blank, never zero.
  private meterExportRows(meter: MeterCard): { headers: string[]; obis: string[]; rows: string[][] } | null {
    const readings = [...meter.dayMeasurements]
      .filter(r => !!r.measuredAt)
      .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
    if (!readings.length) {
      this.toast.showError(this.language === 'pl' ? 'Brak danych do eksportu dla wybranego okresu.' : 'No data to export for the selected period.');
      return null;
    }

    const pl = this.language === 'pl';
    type ExportColumn = { pl: string; en: string; obis: string; read: (r: MeasurementView) => string };
    const num = (v: number | null | undefined) => this.csvNumber(v);
    const unavailable = (_r: MeasurementView) => '';
    const columns: ExportColumn[] = [
      { pl: 'Czas', en: 'Timestamp', obis: '-', read: r => this.csvDate(r.measuredAt) },
      { pl: 'Czas licznika', en: 'Meter timestamp', obis: '0.9.1 / 0.9.2', read: r => this.csvDate(r.meterMeasuredAt) },
      { pl: 'Stan licznika pobór (+A) [kWh]', en: 'Import active energy (+A) [kWh]', obis: '1.8.0', read: r => num(r.activeEnergyImportKwh) },
      { pl: 'Stan licznika oddawanie (-A) [kWh]', en: 'Export active energy (-A) [kWh]', obis: '2.8.0', read: r => num(r.activeEnergyExportKwh) },
      { pl: 'Moc czynna bieżąca [kW]', en: 'Current active power [kW]', obis: '16.7.0 / 1.7.0-2.7.0', read: r => num(r.activePowerKw) },
      { pl: 'Źródło mocy', en: 'Power source', obis: 'SOURCE (OBIS)', read: r => r.activePowerSource || '' },
      { pl: 'Jakość mocy', en: 'Power quality', obis: 'QUALITY (MEASURED / DERIVED / ESTIMATED)', read: r => r.activePowerQuality || '' },
      { pl: 'Bieżąca moc 15-min [kW]', en: 'Current 15-min power [kW]', obis: 'wyliczona / calculated (1.8.0)', read: r => num(r.currentQuarterPowerKw) },
    ];

    // OBIS table supplied by the user: one column per register. The values
    // of the uncollected registers require changes in Edge + backend + DB.
    const groups = [
      { label: '+A', pl: 'energia czynna pobrana', en: 'import active', prefix: 1 },
      { label: '-A', pl: 'energia czynna oddana', en: 'export active', prefix: 2 },
      { label: '+Ri', pl: 'bierna indukcyjna pobrana', en: 'reactive inductive import', prefix: 5 },
      { label: '+Rc', pl: 'bierna pojemnościowa pobrana', en: 'reactive capacitive import', prefix: 6 },
      { label: '-Ri', pl: 'bierna indukcyjna oddana', en: 'reactive inductive export', prefix: 7 },
      { label: '-Rc', pl: 'bierna pojemnościowa oddana', en: 'reactive capacitive export', prefix: 8 }
    ];
    const electricalColumns: ExportColumn[] = [
      { pl: 'Napięcie L1 [V]', en: 'Voltage L1 [V]', obis: '32.7.0', read: r => num(r.voltageL1V) },
      { pl: 'Napięcie L2 [V]', en: 'Voltage L2 [V]', obis: '52.7.0', read: r => num(r.voltageL2V) },
      { pl: 'Napięcie L3 [V]', en: 'Voltage L3 [V]', obis: '72.7.0', read: r => num(r.voltageL3V) },
      { pl: 'Prąd L1 [A]', en: 'Current L1 [A]', obis: '31.7.0', read: r => num(r.currentL1A) },
      { pl: 'Prąd L2 [A]', en: 'Current L2 [A]', obis: '51.7.0', read: r => num(r.currentL2A) },
      { pl: 'Prąd L3 [A]', en: 'Current L3 [A]', obis: '71.7.0', read: r => num(r.currentL3A) },
      { pl: 'Częstotliwość [Hz]', en: 'Frequency [Hz]', obis: '14.7.0', read: r => num(r.frequencyHz) }
    ];
    const types = [
      { suffix: '2.0', pl: 'Pmax skumulowana', en: 'accumulated max demand', unit: 'kW' },
      { suffix: '4.0', pl: 'czas Pmax / Pśr bieżąca', en: 'max demand time / current demand', unit: 'min' },
      { suffix: '5.0', pl: 'ostatnia moc Pśr', en: 'last demand', unit: 'kW' },
      { suffix: '6.0', pl: 'Pmax', en: 'maximum demand', unit: 'kW' },
      { suffix: '8.T', pl: 'energia taryfowa', en: 'tariff energy', unit: 'kWh' },
      { suffix: '8.0', pl: 'energia całkowita', en: 'total energy', unit: 'kWh' }
    ];
    // 1.8.0 and 2.8.0 are already shown in the original export fields.
    // We still include them in the full OBIS matrix for faithful table layout.
    for (const type of types) {
      for (const group of groups) {
        const obis = `${group.prefix}.${type.suffix}`;
        const unit = group.prefix >= 5 && type.suffix.startsWith('8.') ? 'kvarh' : type.unit;
        columns.push({
          pl: `${type.pl} (${group.label}) [${unit}]`,
          en: `${type.en} (${group.label}) [${unit}]`,
          obis,
          read: obis === '1.8.0' ? r => num(r.activeEnergyImportKwh)
            : obis === '2.8.0' ? r => num(r.activeEnergyExportKwh) : unavailable
        });
      }
    }

    // Keep electrical quality measurements at the end in both CSV and XLS.
    columns.push(...electricalColumns);

    return {
      headers: columns.map(c => pl ? c.pl : c.en),
      obis: columns.map(c => c.obis),
      rows: readings.map(r => columns.map(c => c.read(r)))
    };
  }

  cleanupMeterId: number | null = null;
  cleanupFrom = '';
  cleanupTo = '';
  cleanupConfirmation = '';
  cleanupBusy = false;
  cleanupMessage = '';

  deleteHistoricalMeasurements(): void {
    if (this.authenticatedRole !== 'ADMIN' || this.cleanupBusy || !this.cleanupMeterId ||
        this.cleanupConfirmation !== 'DELETE' || !this.cleanupFrom || !this.cleanupTo) return;
    if (!window.confirm(`Permanently delete readings for meter ${this.cleanupMeterId} from ${this.cleanupFrom} to ${this.cleanupTo}?`)) return;
    this.cleanupBusy = true;
    this.cleanupMessage = '';
    this.meterService.deleteMeasurementHistory(this.cleanupMeterId, this.cleanupFrom, this.cleanupTo).subscribe({
      next: result => { this.cleanupBusy = false; this.cleanupConfirmation = ''; this.cleanupMessage = `Deleted ${result.deleted} readings.`; },
      error: error => { this.cleanupBusy = false; this.cleanupMessage = error?.error?.message || 'Deletion failed.'; }
    });
  }

  exportMeterCsv(meter: MeterCard): void {
    const data = this.meterExportRows(meter);
    if (!data) return;
    const escape = (value: string): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const content = [data.headers, data.obis, ...data.rows]
      .map(row => row.map(v => escape(v)).join(';')).join('\r\n');
    this.downloadMeterExport(meter, new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' }), 'csv');
  }

  exportMeterXls(meter: MeterCard): void {
    const data = this.meterExportRows(meter);
    if (!data) return;
    // Excel opens this legacy .xls export as HTML, and may ignore UTF-8 metadata.
    // Encode all non-ASCII characters as numeric HTML entities to avoid mojibake
    // (e.g. U+2212 rendering as âˆ’ or U+2014 as â€”).
    const escapeHtml = (value: string): string => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/[^\x00-\x7F]/g, char => `&#${char.codePointAt(0)};`);
    const headerCells = data.headers.map(v => `<th>${escapeHtml(v)}</th>`).join('');
    const obisCells = data.obis.map(v => `<th class="obis-code" style="mso-number-format:&#34;\\@&#34;">${escapeHtml(v)}</th>`).join('');
    const bodyRows = data.rows.map(row => `<tr>${row.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('');
    const workbook = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>th{background:#dceaf7;border:1px solid #c3d3e2;padding:5px;white-space:nowrap}th.obis-code{background:#edf4fa;font-weight:600;text-align:center;mso-number-format:"\\@"}td{border:1px solid #e3e8ee;padding:3px}table{border-collapse:collapse}</style></head><body><table><thead><tr>${headerCells}</tr><tr>${obisCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
    // Excel-compatible HTML .xls (not a native binary Excel workbook).
    this.downloadMeterExport(meter, new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' }), 'xls');
  }

  private downloadMeterExport(meter: MeterCard, blob: Blob, extension: 'csv' | 'xls'): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = meter.name.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'meter';
    link.href = url;
    link.download = `${safeName}_${this.selectedDateFrom}_${this.selectedDateTo}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private csvDate(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(this.language === 'pl' ? 'pl-PL' : 'en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  private csvNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(Number(value))) return '';
    return Number(value).toLocaleString(this.language === 'pl' ? 'pl-PL' : 'en-GB', {
      useGrouping: false, maximumFractionDigits: 6
    });
  }

  formatNetworkValue(value: number | null, digits = 1): string { return value == null ? '—' : value.toFixed(digits); }
  hasPhaseData(meter: MeterCard, kind: 'voltage'|'current', phase: 1|2|3): boolean {
    if (kind === 'voltage') {
      const live = phase === 1 ? meter.voltageL1V : phase === 2 ? meter.voltageL2V : meter.voltageL3V;
      const segments = phase === 1 ? meter.voltageL1Segments : phase === 2 ? meter.voltageL2Segments : meter.voltageL3Segments;
      return live != null || segments.length > 0;
    }
    const live = phase === 1 ? meter.currentL1A : phase === 2 ? meter.currentL2A : meter.currentL3A;
    const segments = phase === 1 ? meter.currentL1Segments : phase === 2 ? meter.currentL2Segments : meter.currentL3Segments;
    return live != null || segments.length > 0;
  }

  noVoltageData(meter: MeterCard): boolean { return !this.hasPhaseData(meter,'voltage',1) && !this.hasPhaseData(meter,'voltage',2) && !this.hasPhaseData(meter,'voltage',3); }
  noCurrentData(meter: MeterCard): boolean { return !this.hasPhaseData(meter,'current',1) && !this.hasPhaseData(meter,'current',2) && !this.hasPhaseData(meter,'current',3); }
  noFrequencyData(meter: MeterCard): boolean { return meter.frequencyHz == null && meter.frequencySegments.length === 0; }


  private ensureSelectedClientAndSite(): void {
    const clients = this.publicDashboardClients;
    if (!clients.length) { this.selectedClientId = ''; this.selectedSiteId = ''; return; }
    if (!clients.some(c => c.clientId === this.selectedClientId)) this.selectClient(clients[0].clientId);
    const sites = this.publicDashboardSitesForSelectedClient;
    if (!sites.length) { this.selectSite(''); return; }
    if (!sites.some(s => s.siteId === this.selectedSiteId)) this.selectSite(sites[0].siteId);
  }

  private numberOrNull(value: number | null | undefined): number | null {
    return value == null || Number.isNaN(Number(value)) ? null : Number(value);
  }

  private rebuildNetworkCharts(meter: MeterCard): void {
    const r = meter.dayMeasurements;

    const p = this.networkSingle(r, 'activePowerKw', meter);
    meter.powerSegments = p[0];
    meter.powerPoints = p[0].join(' ');
    meter.powerRange = p[1];

    const v = this.networkTriplet(r, 'voltageL1V', 'voltageL2V', 'voltageL3V', meter);
    meter.voltageL1Segments = v[0];
    meter.voltageL2Segments = v[1];
    meter.voltageL3Segments = v[2];
    meter.voltageL1Points = v[0].join(' ');
    meter.voltageL2Points = v[1].join(' ');
    meter.voltageL3Points = v[2].join(' ');
    meter.voltageRange = v[3];

    const c = this.networkTriplet(r, 'currentL1A', 'currentL2A', 'currentL3A', meter);
    meter.currentL1Segments = c[0];
    meter.currentL2Segments = c[1];
    meter.currentL3Segments = c[2];
    meter.currentL1Points = c[0].join(' ');
    meter.currentL2Points = c[1].join(' ');
    meter.currentL3Points = c[2].join(' ');
    meter.currentRange = c[3];

    const f = this.networkSingle(r, 'frequencyHz', meter);
    meter.frequencySegments = f[0];
    meter.frequencyPoints = f[0].join(' ');
    meter.frequencyRange = f[1];
  }

  private networkTriplet(
    readings: MeasurementView[],
    a: keyof MeasurementView,
    b: keyof MeasurementView,
    c: keyof MeasurementView,
    meter: MeterCard
  ): [string[],string[],string[],string] {
    const all = readings.flatMap(x => [x[a], x[b], x[c]]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!all.length) return [[], [], [], '—'];

    const min = Math.min(...all), max = Math.max(...all), pad = Math.max((max-min)*0.08, Math.abs(max)*0.005, 0.1);
    return [
      this.networkPointSegments(readings,a,min-pad,max+pad,meter),
      this.networkPointSegments(readings,b,min-pad,max+pad,meter),
      this.networkPointSegments(readings,c,min-pad,max+pad,meter),
      `${min.toFixed(1)}–${max.toFixed(1)}`
    ];
  }

  private networkSingle(readings: MeasurementView[], key: keyof MeasurementView, meter: MeterCard): [string[],string] {
    const values = readings.map(x => x[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) return [[], '—'];

    const min=Math.min(...values), max=Math.max(...values), pad=Math.max((max-min)*0.08,0.02);
    return [this.networkPointSegments(readings,key,min-pad,max+pad,meter), `${min.toFixed(2)}–${max.toFixed(2)}`];
  }

  private networkPointSegments(
    readings: MeasurementView[],
    key: keyof MeasurementView,
    min: number,
    max: number,
    meter: MeterCard
  ): string[] {
    const usable = readings
      .filter(x => typeof x[key] === 'number' && Number.isFinite(Number(x[key])))
      .sort((a,b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
    if (!usable.length) return [];

    const startMs = this.meterChartStartMs(meter);
    const endMs = this.meterChartEndMs(meter);
    const span = Math.max(1, endMs - startMs);
    const range = Math.max(max-min,0.0001);

    const gapLimit = this.evidenceTimeoutMs(
      usable.map(r => new Date(r.measuredAt).getTime()),
      60_000, 30_000, 180_000
    );

    let serverTimeline: TimeStatusSegment[] = [];
    const serverSamples = meter.communicationSamples.filter(s => s.entityType === 'SERVER');
    if (serverSamples.length) {
      const heartbeat = this.buildServerHeartbeatTimeline(serverSamples);
      const measurementEvidence = this.buildMeasurementEvidenceTimeline(meter.dayMeasurements);
      serverTimeline = this.addOnlineEvidence(heartbeat, measurementEvidence);
    }

    const serverOfflineBetween = (from: number, to: number): boolean =>
      serverTimeline.some(s => s.status === 'OFFLINE' && s.to > from && s.from < to);

    const groups: MeasurementView[][] = [];
    let current: MeasurementView[] = [];
    let previousAt: number | null = null;

    usable.forEach(row => {
      const at = new Date(row.measuredAt).getTime();
      const mustBreak = previousAt != null &&
        ((at - previousAt) > gapLimit || serverOfflineBetween(previousAt, at));

      if (mustBreak && current.length) {
        groups.push(current);
        current = [];
      }
      current.push(row);
      previousAt = at;
    });
    if (current.length) groups.push(current);

    return groups.map(group => {
      const sampled = group.length > 300
        ? group.filter((_,i) => i % Math.ceil(group.length/300) === 0 || i === group.length-1)
        : group;

      return sampled.map(x => {
        const px = 10 + ((new Date(x.measuredAt).getTime() - startMs) / span) * 700;
        const py = 72 - ((Number(x[key]) - min) / range) * 56;
        return `${Math.max(10, Math.min(710, px)).toFixed(1)},${Math.max(16, Math.min(72, py)).toFixed(1)}`;
      }).join(' ');
    }).filter(Boolean);
  }

  private buildTimedLineSegments(readings: MeasurementView[], key: keyof MeasurementView, maxKw: number, start: number, end: number, meter: MeterCard): string[] {
    const left = 34, right = 1180, top = 24, bottom = this.powerChartBottom(meter);
    const span = Math.max(1, end - start);
    const usable = readings
      .filter(r => typeof r[key] === 'number' && Number.isFinite(Number(r[key])))
      .sort((a,b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
    if (!usable.length) return [];

    const gapLimit = this.evidenceTimeoutMs(usable.map(r => new Date(r.measuredAt).getTime()), 60_000, 30_000, 180_000);
    const groups: MeasurementView[][] = [];
    let current: MeasurementView[] = [];
    let previousAt: number | null = null;
    usable.forEach(r => {
      const at = new Date(r.measuredAt).getTime();
      if (previousAt != null && at - previousAt > gapLimit && current.length) {
        groups.push(current);
        current = [];
      }
      current.push(r);
      previousAt = at;
    });
    if (current.length) groups.push(current);

    return groups.map(group => {
      const sampled = group.length > 900 ? group.filter((_,i) => i % Math.ceil(group.length / 900) === 0 || i === group.length - 1) : group;
      return sampled.map(r => {
        const x = left + ((new Date(r.measuredAt).getTime() - start) / span) * (right-left);
        const y = bottom - (Math.max(0, Number(r[key])) / maxKw) * (bottom-top);
        return `${Math.max(left,Math.min(right,x)).toFixed(1)},${Math.max(top,Math.min(bottom,y)).toFixed(1)}`;
      }).join(' ');
    }).filter(points => points.length > 0);
  }

  private buildTimedLineHoverPoints(readings: MeasurementView[], key: keyof MeasurementView, maxKw: number, start: number, end: number, meter: MeterCard): LineHoverPoint[] {
    const left = 34, right = 1180, top = 24, bottom = this.powerChartBottom(meter);
    const span = Math.max(1, end - start);
    const usable = readings
      .filter(r => typeof r[key] === 'number' && Number.isFinite(Number(r[key])))
      .sort((a,b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());

    const sampled = usable.length > 900
      ? usable.filter((_,i) => i % Math.ceil(usable.length / 900) === 0 || i === usable.length - 1)
      : usable;

    return sampled.map(r => {
      const atMs = new Date(r.measuredAt).getTime();
      const value = Number(r[key]);
      const x = left + ((atMs - start) / span) * (right-left);
      const y = bottom - (Math.max(0, value) / maxKw) * (bottom-top);
      const at = new Date(atMs);
      const label = `${String(at.getDate()).padStart(2,'0')}.${String(at.getMonth()+1).padStart(2,'0')}.${at.getFullYear()} ${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}:${String(at.getSeconds()).padStart(2,'0')}`;
      return {
        x: Math.max(left, Math.min(right, x)),
        y: Math.max(top, Math.min(bottom, y)),
        value,
        label
      };
    });
  }

  private buildTimedQuarterBars(readings: MeasurementView[], maxKw: number, currentIndex: number, start: number, end: number, meter: MeterCard): BarPoint[] {
    const left = 34, right = 1180, top = 24, bottom = this.powerChartBottom(meter);
    const span = Math.max(1,end-start);
    const buckets = new Map<number, {value:number; at:number}>();
    readings.forEach(r => {
      if (r.currentQuarterPowerKw == null) return;
      const at = new Date(r.measuredAt).getTime();
      if (!Number.isFinite(at)) return;
      const bucket = Math.floor(at / 900000) * 900000;
      const previous = buckets.get(bucket);
      if (!previous || at >= previous.at) buckets.set(bucket, { value:Number(r.currentQuarterPowerKw), at });
    });
    const quarterMs = 900_000;
    const currentBucket = Math.floor(this.now.getTime() / quarterMs) * quarterMs;
    const showCurrent = this.selectedQuickRangeMinutes != null && this.rangeIncludesToday()
      && currentBucket >= start && currentBucket + quarterMs <= end;
    if (showCurrent) {
      // At the new boundary show an empty current-quarter bar immediately;
      // it grows from live accumulated energy as measurements arrive.
      const liveValue = meter.currentQuarterPowerKw;
      buckets.set(currentBucket, {
        value: liveValue != null && Number.isFinite(liveValue) ? Math.max(0, liveValue) : 0,
        at: this.now.getTime()
      });
    }
    const bucketWidth = Math.max(1.2, ((15*60*1000)/span) * (right-left) - 0.5);
    return [...buckets.entries()].sort((a,b)=>a[0]-b[0]).map(([bucket,v]) => {
      const x = left + ((bucket-start)/span)*(right-left);
      const isCurrent = showCurrent && bucket === currentBucket;
      const h = Math.max(isCurrent ? 1.5 : 0, (v.value/maxKw)*(bottom-top));
      const d = new Date(bucket), d2 = new Date(bucket+900000);
      const label=(x:Date)=>`${String(x.getDate()).padStart(2,'0')}.${String(x.getMonth()+1).padStart(2,'0')} ${String(x.getHours()).padStart(2,'0')}:${String(x.getMinutes()).padStart(2,'0')}`;
      const current = isCurrent || (this.selectedQuickRangeMinutes == null && this.isSelectedToday() && bucket === currentBucket);
    // This dashed outline is a provisional elapsed-time average, not accumulated demand.
    // Hide early noise and avoid drawing beyond the plot if the projection exceeds its scale.
    const progress = this.meterQuarterProgressAtReading(meter);
    const projectedValue = current && meter.currentQuarterPowerKw != null && progress >= (30 / 900)
      ? Math.max(0, meter.currentQuarterPowerKw / progress) : undefined;
    const projectedHeight = projectedValue === undefined ? undefined : Math.min(bottom-top, projectedValue / maxKw * (bottom-top));
    return { x, y:bottom-h, width:bucketWidth, height:h, value:v.value, label:label(d), intervalLabel:`${label(d)}–${String(d2.getHours()).padStart(2,'0')}:${String(d2.getMinutes()).padStart(2,'0')}`, current, projectedValue, projectedY: projectedHeight === undefined ? undefined : bottom-projectedHeight, projectedHeight, showLabel:false };
    });
  }

  communicationStatusLabel(status: CommunicationSegment['status']): string {
    const pl = this.language === 'pl';
    if (status === 'ONLINE') return pl ? 'Działa' : 'Online';
    if (status === 'DEGRADED' || status === 'STARTING') return pl ? 'Zakłócenia' : 'Degraded';
    if (status === 'OFFLINE') return pl ? 'Brak komunikacji' : 'Offline';
    if (status === 'FUTURE') return pl ? 'Przyszłość' : 'Future';
    return pl ? 'Brak danych' : 'No data';
  }

  private rebuildCommunicationDiagnostics(meter: MeterCard): void {
    // Infrastructure diagnostics are shared:
    // - PowerGuard Server is common to every meter card.
    // - PowerGuard-Edge is common to every meter attached to that same Edge.
    // Only the meter row is meter-specific.
    //
    // This is important when, for example, m23 is online and m24 is offline:
    // m23 proves that the Server and that Edge are working, so m24 must show
    // Server=ONLINE, Edge=ONLINE, Meter=OFFLINE for the same time interval.

    const sameEdgeMeters = this.meters.filter(candidate =>
      candidate.clientId === meter.clientId &&
      candidate.siteId === meter.siteId &&
      candidate.edgeId === meter.edgeId
    );

    // Any measurement received by this backend is positive evidence that the
    // PowerGuard Server was alive at that moment.
    const allServerMeasurements = this.meters.flatMap(candidate => candidate.dayMeasurements || []);
    const serverMeasurementEvidence = this.buildMeasurementEvidenceTimeline(allServerMeasurements);

    // Server heartbeat/history may be returned together with any meter's
    // communication history. Merge it from every card so an offline meter does
    // not lose the shared server state.
    const sharedServerSamples = this.meters.flatMap(candidate =>
      (candidate.communicationSamples || []).filter(sample => sample.entityType === 'SERVER')
    );
    const serverHeartbeatRaw = this.buildServerHeartbeatTimeline(sharedServerSamples);
    const serverRaw = this.addOnlineEvidence(serverHeartbeatRaw, serverMeasurementEvidence);

    // The Edge state is shared only between meters attached to this exact Edge.
    // A measurement from any sibling meter proves that the Edge path was alive.
    const edgeMeasurements = sameEdgeMeters.flatMap(candidate => candidate.dayMeasurements || []);
    const edgeMeasurementEvidence = this.buildMeasurementEvidenceTimeline(edgeMeasurements);

    const sharedEdgeSamples = sameEdgeMeters.flatMap(candidate =>
      (candidate.communicationSamples || []).filter(sample => sample.entityType === 'EDGE')
    );
    const edgeStatusRaw = this.buildStatusEvidenceTimeline(sharedEdgeSamples, 120_000);
    const edgeRaw = this.addOnlineEvidence(edgeStatusRaw, edgeMeasurementEvidence);
    const edgeVisible = this.maskByServerAvailability(edgeRaw, serverRaw);

    // The final row remains meter-specific. When Server and Edge are online but
    // this meter has no readings, buildMeasurementEvidenceTimeline returns
    // OFFLINE, which is exactly the desired red meter row.
    const meterRaw = this.buildMeasurementEvidenceTimeline(meter.dayMeasurements || []);
    const meterVisible = this.maskByEdgeAndServerAvailability(meterRaw, edgeVisible, serverRaw);

    meter.serverCommunicationSegments = this.toCommunicationSegments(serverRaw, meter);
    meter.edgeCommunicationSegments = this.toCommunicationSegments(edgeVisible, meter);
    meter.meterCommunicationSegments = this.toCommunicationSegments(meterVisible, meter);
  }

  private rebuildAllCommunicationDiagnostics(): void {
    this.meters.forEach(candidate => this.rebuildCommunicationDiagnostics(candidate));
  }

  private addOnlineEvidence(base: TimeStatusSegment[], evidence: TimeStatusSegment[]): TimeStatusSegment[] {
    return this.combineTimelines(base, evidence, (baseStatus, evidenceStatus) => {
      // Actual measurements are stronger evidence than a missing heartbeat/status row.
      if (evidenceStatus === 'ONLINE') return 'ONLINE';

      // Preserve the explicit future area.
      if (baseStatus === 'FUTURE' || evidenceStatus === 'FUTURE') return 'FUTURE';

      // Otherwise keep the original diagnostic state.
      return baseStatus;
    });
  }

  private buildServerHeartbeatTimeline(samples: CommunicationStatusView[]): TimeStatusSegment[] {
    const start = this.rangeStartMs();
    const end = this.rangeEndExclusiveMs();
    const observedEnd = this.rangeIncludesToday() ? Math.min(end, Date.now()) : end;
    const times = samples.map(s => new Date(s.observedAt).getTime()).filter(Number.isFinite).sort((a,b)=>a-b);
    const timeout = 90_000; // heartbeat every 30 s; three missed heartbeats = server unavailable
    return this.buildHeartbeatTimeline(times, start, observedEnd, end, timeout);
  }

  private buildStatusEvidenceTimeline(samples: CommunicationStatusView[], fallbackTimeout: number): TimeStatusSegment[] {
    const start = this.rangeStartMs();
    const end = this.rangeEndExclusiveMs();
    const observedEnd = this.rangeIncludesToday() ? Math.min(end, Date.now()) : end;
    const ordered = [...samples]
      .map(s => ({ sample:s, at:new Date(s.observedAt).getTime() }))
      .filter(x => Number.isFinite(x.at) && x.at >= start && x.at < observedEnd)
      .sort((a,b)=>a.at-b.at);
    if (!ordered.length) return this.withFutureUnknown([{from:start,to:observedEnd,status:'UNKNOWN'}], observedEnd, end);

    const timeout = this.evidenceTimeoutMs(ordered.map(x=>x.at), fallbackTimeout, 45_000, 300_000);
    const raw: TimeStatusSegment[] = [];
    if (ordered[0].at > start) raw.push({from:start,to:ordered[0].at,status:'UNKNOWN'});

    ordered.forEach((entry,index) => {
      const nextAt = index + 1 < ordered.length ? Math.min(observedEnd, ordered[index+1].at) : observedEnd;
      if (nextAt <= entry.at) return;
      const status = this.normalizeCommunicationStatus(entry.sample.status);
      if (status === 'OFFLINE') {
        raw.push({from:entry.at,to:nextAt,status:'OFFLINE'});
        return;
      }
      const validUntil = Math.min(nextAt, entry.at + timeout);
      if (validUntil > entry.at) raw.push({from:entry.at,to:validUntil,status});
      if (nextAt > validUntil) raw.push({from:validUntil,to:nextAt,status:'OFFLINE'});
    });
    return this.withFutureUnknown(this.mergeTimeSegments(raw), observedEnd, end);
  }

  private buildMeasurementEvidenceTimeline(readings: MeasurementView[]): TimeStatusSegment[] {
    const start = this.rangeStartMs();
    const end = this.rangeEndExclusiveMs();
    const observedEnd = this.rangeIncludesToday() ? Math.min(end, Date.now()) : end;
    const times = readings.map(r => new Date(r.measuredAt).getTime())
      .filter(at => Number.isFinite(at) && at >= start && at < observedEnd)
      .sort((a,b)=>a-b);
    if (!times.length) return this.withFutureUnknown([{from:start,to:observedEnd,status:'OFFLINE'}], observedEnd, end);
    const timeout = this.evidenceTimeoutMs(times, 60_000, 30_000, 180_000);
    return this.buildHeartbeatTimeline(times, start, observedEnd, end, timeout);
  }

  private buildHeartbeatTimeline(times: number[], start: number, observedEnd: number, end: number, timeout: number): TimeStatusSegment[] {
    const inRange = times.filter(at => at >= start && at < observedEnd).sort((a,b)=>a-b);
    const raw: TimeStatusSegment[] = [];
    if (!inRange.length) return this.withFutureUnknown([{from:start,to:observedEnd,status:'UNKNOWN'}], observedEnd, end);
    if (inRange[0] > start) raw.push({from:start,to:inRange[0],status:'UNKNOWN'});
    inRange.forEach((at,index) => {
      const nextAt = index + 1 < inRange.length ? Math.min(observedEnd,inRange[index+1]) : observedEnd;
      const validUntil = Math.min(nextAt, at + timeout);
      if (validUntil > at) raw.push({from:at,to:validUntil,status:'ONLINE'});
      if (nextAt > validUntil) raw.push({from:validUntil,to:nextAt,status:'OFFLINE'});
    });
    return this.withFutureUnknown(this.mergeTimeSegments(raw), observedEnd, end);
  }

  private maskByServerAvailability(source: TimeStatusSegment[], server: TimeStatusSegment[]): TimeStatusSegment[] {
    return this.combineTimelines(source, server, (status, serverStatus) =>
      serverStatus === 'FUTURE' ? 'FUTURE' : serverStatus === 'ONLINE' ? status : 'UNKNOWN');
  }

  private maskByEdgeAndServerAvailability(source: TimeStatusSegment[], edge: TimeStatusSegment[], server: TimeStatusSegment[]): TimeStatusSegment[] {
    const serverMasked = this.maskByServerAvailability(source, server);
    return this.combineTimelines(serverMasked, edge, (status, edgeStatus) =>
      edgeStatus === 'FUTURE' ? 'FUTURE' : (edgeStatus === 'ONLINE' || edgeStatus === 'DEGRADED' || edgeStatus === 'STARTING' ? status : 'UNKNOWN'));
  }

  private combineTimelines(a: TimeStatusSegment[], b: TimeStatusSegment[], fn: (a:CommunicationSegment['status'], b:CommunicationSegment['status']) => CommunicationSegment['status']): TimeStatusSegment[] {
    const boundaries = [...new Set([...a.flatMap(x=>[x.from,x.to]), ...b.flatMap(x=>[x.from,x.to])])].sort((x,y)=>x-y);
    const out: TimeStatusSegment[] = [];
    for (let i=0;i<boundaries.length-1;i++) {
      const from=boundaries[i], to=boundaries[i+1];
      if (to<=from) continue;
      const mid=from+(to-from)/2;
      const sa=a.find(x=>mid>=x.from&&mid<x.to)?.status ?? 'UNKNOWN';
      const sb=b.find(x=>mid>=x.from&&mid<x.to)?.status ?? 'UNKNOWN';
      out.push({from,to,status:fn(sa,sb)});
    }
    return this.mergeTimeSegments(out);
  }

  private evidenceTimeoutMs(times: number[], fallback: number, min: number, max: number): number {
    if (times.length < 2) return fallback;
    const gaps = times.slice(1).map((t,i)=>t-times[i]).filter(g=>g>0&&g<=max*2).sort((a,b)=>a-b);
    if (!gaps.length) return fallback;
    const median = gaps[Math.floor(gaps.length/2)];
    return Math.max(min, Math.min(max, median * 3));
  }

  private normalizeCommunicationStatus(status: string): CommunicationSegment['status'] {
    if (status === 'ONLINE') return 'ONLINE';
    if (status === 'OFFLINE') return 'OFFLINE';
    if (status === 'STARTING') return 'STARTING';
    return 'DEGRADED';
  }

  private withFutureUnknown(raw: TimeStatusSegment[], observedEnd: number, end: number): TimeStatusSegment[] {
    const out=[...raw];
    if (observedEnd < end) out.push({from:observedEnd,to:end,status:'FUTURE'});
    return this.mergeTimeSegments(out.filter(x=>x.to>x.from));
  }

  private mergeTimeSegments(input: TimeStatusSegment[]): TimeStatusSegment[] {
    const sorted=[...input].filter(x=>x.to>x.from).sort((a,b)=>a.from-b.from);
    const out: TimeStatusSegment[]=[];
    sorted.forEach(seg=>{
      const last=out[out.length-1];
      if(last && last.status===seg.status && Math.abs(last.to-seg.from)<2){ last.to=seg.to; }
      else out.push({...seg});
    });
    return out;
  }

  private toCommunicationSegments(raw: TimeStatusSegment[], meter: MeterCard): CommunicationSegment[] {
    const start = this.meterChartStartMs(meter);
    const end = this.meterChartEndMs(meter);
    const span = Math.max(1, end - start);
    return raw
      .map(x => ({...x, from: Math.max(start, x.from), to: Math.min(end, x.to)}))
      .filter(x => x.to > x.from)
      .map(x => ({
        left: Math.max(0, Math.min(100, ((x.from-start)/span)*100)),
        width: Math.max(0.08, Math.min(100, ((x.to-x.from)/span)*100)),
        status: x.status
      }));
  }

  private valueToChartY(value: number, maxKw: number, meter: MeterCard): number {
    const top = 24;
    const bottom = this.powerChartBottom(meter);
    const height = bottom - top;
    return bottom - (Math.max(0, value) / maxKw) * height;
  }

  private buildLinePoints(values: number[], maxKw: number): string {
    const left = 54;
    const right = 704;
    const top = 24;
    const bottom = 244;
    const width = right - left;
    const height = bottom - top;
    const denominator = 95;

    return values
      .map((value, index) => {
        const x = left + (index / denominator) * width;
        const y = bottom - (value / maxKw) * height;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  private buildBars(values: Array<number | null>, maxKw: number, currentIndex: number): BarPoint[] {
    const left = 54;
    const right = 704;
    const top = 24;
    const bottom = 244;
    const height = bottom - top;
    const count = 96;
    const gap = 1.2;
    const width = (right - left - gap * (count - 1)) / count;

    return values.flatMap((value, index) => {
      if (value === null) return [];
      const barHeight = Math.max(0, (value / maxKw) * height);
      const startMinutes = index * 15;
      const endMinutes = startMinutes + 15;
      const startHour = Math.floor(startMinutes / 60);
      const startMinute = startMinutes % 60;
      const endHour = Math.floor(endMinutes / 60);
      const endMinute = endMinutes % 60;
      const startLabel = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
      const endLabel = endMinutes === 24 * 60
        ? '24:00'
        : `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
      return [{
        x: left + index * (width + gap),
        y: bottom - barHeight,
        width,
        height: barHeight,
        value,
        label: startLabel,
        intervalLabel: `${startLabel}–${endLabel}`,
        current: index === currentIndex,
        showLabel: index % 12 === 0 || index === 95,
      }];
    });
  }

  private buildTicks(maxKw: number, meter: MeterCard): AxisTick[] {
    const step = this.niceStep(maxKw / 4);
    const ticks: AxisTick[] = [];
    for (let value = 0; value <= maxKw + step * 0.001; value += step) {
      const normalized = Number(value.toFixed(step < 1 ? 2 : step < 10 ? 1 : 0));
      ticks.push({ value: normalized, y: this.valueToChartY(normalized, maxKw, meter) });
    }
    if (!ticks.length || ticks[ticks.length - 1].value < maxKw) {
      ticks.push({ value: maxKw, y: this.valueToChartY(maxKw, maxKw, meter) });
    }
    return ticks;
  }

  private niceMaximum(value: number): number {
    const safe = Math.max(0.1, value);
    const step = this.niceStep(safe / 4);
    return Number((Math.ceil(safe / step) * step).toFixed(step < 1 ? 2 : step < 10 ? 1 : 0));
  }

  private niceStep(value: number): number {
    const safe = Math.max(0.01, value);
    const magnitude = Math.pow(10, Math.floor(Math.log10(safe)));
    const normalized = safe / magnitude;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return factor * magnitude;
  }

  private currentQuarterProgress(now = new Date()): number {
    const minuteInQuarter = now.getMinutes() % 15;
    const secondsInQuarter =
      minuteInQuarter * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
    return Math.min(1, Math.max(0, secondsInQuarter / (15 * 60)));
  }

  private currentQuarterIndex(now = new Date()): number {
    return Math.floor(now.getTime() / (15 * 60 * 1000));
  }

  private dateInputAsLocalDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  private selectedDateFromAsLocalDate(): Date { return this.dateInputAsLocalDate(this.selectedDateFrom); }
  private selectedDateToAsLocalDate(): Date { return this.dateInputAsLocalDate(this.selectedDateTo); }

  private rangeStartMs(): number {
    const d = this.selectedDateFromAsLocalDate(); d.setHours(0,0,0,0); return d.getTime();
  }

  private rangeEndExclusiveMs(): number {
    const d = this.selectedDateToAsLocalDate(); d.setHours(0,0,0,0); d.setDate(d.getDate()+1); return d.getTime();
  }

  rangeIncludesToday(): boolean {
    const now = new Date(); now.setHours(12,0,0,0);
    return now >= this.selectedDateFromAsLocalDate() && now <= this.selectedDateToAsLocalDate();
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  isSelectedToday(): boolean {
    return this.selectedDateFrom === this.todayInputMax() && this.selectedDateTo === this.todayInputMax();
  }

  private isSameCalendarDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }


  private formatTime(value: Date): string {
    return value.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatDate(value: Date): string {
    return value.toLocaleDateString(this.language === 'pl' ? 'pl-PL' : 'en-GB');
  }
}
