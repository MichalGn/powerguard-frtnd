import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment.development';

export interface ApplicationSettingsView {
  companyName: string | null;
  installationName: string | null;
  address: string | null;
  nip: string | null;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}settings`;

  get(): Observable<ApplicationSettingsView> {
    return this.http.get<ApplicationSettingsView>(this.url);
  }

  update(value: ApplicationSettingsView): Observable<ApplicationSettingsView> {
    return this.http.put<ApplicationSettingsView>(this.url, value, { headers: this.authHeaders() });
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('powerguard-token') || '';
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
