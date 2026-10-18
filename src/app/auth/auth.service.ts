import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment.development';
import { md5 } from './md5';

export type UserRole = 'ADMIN' | 'INSTALATOR' | 'USER';

export interface UserView {
  id: number;
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  phone?: string | null;
  role: UserRole;
  enabled: boolean;
  siteIds: number[];
}

export interface LoginResponse extends UserView {
  authenticated: boolean;
  token?: string;
}

export interface SelfEditInput {
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string;
}

export interface ManagedUserInput {
  username: string;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  phone?: string | null;
  password?: string;
  role: UserRole;
  enabled: boolean;
  siteIds: number[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly authUrl = `${environment.apiUrl}auth`;
  private readonly usersUrl = `${environment.apiUrl}users`;

  login(username: string, plainPassword: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.authUrl}/login`, {
      username,
      passwordMd5: md5(plainPassword),
    });
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.authUrl}/logout`, {}, { headers: this.authHeaders() });
  }

  me(): Observable<UserView> {
    return this.http.get<UserView>(`${this.usersUrl}/me`, { headers: this.authHeaders() });
  }

  updateMe(input: SelfEditInput): Observable<UserView> {
    return this.http.put<UserView>(`${this.usersUrl}/me`, {
      username: input.username,
      firstname: input.firstname ?? null,
      lastname: input.lastname ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordMd5: input.password ? md5(input.password) : null,
    }, { headers: this.authHeaders() });
  }

  listUsers(): Observable<UserView[]> {
    return this.http.get<UserView[]>(this.usersUrl, { headers: this.authHeaders() });
  }

  createUser(input: ManagedUserInput): Observable<UserView> {
    return this.http.post<UserView>(this.usersUrl, this.toManagedPayload(input, true), {
      headers: this.authHeaders(),
    });
  }

  updateUser(id: number, input: ManagedUserInput): Observable<UserView> {
    return this.http.put<UserView>(`${this.usersUrl}/${id}`, this.toManagedPayload(input, false), {
      headers: this.authHeaders(),
    });
  }

  deleteUser(id: number): Observable<void> {
    return this.http.delete<void>(`${this.usersUrl}/${id}`, { headers: this.authHeaders() });
  }

  private toManagedPayload(input: ManagedUserInput, passwordRequired: boolean): object {
    return {
      username: input.username,
      firstname: input.firstname ?? null,
      lastname: input.lastname ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordMd5: input.password ? md5(input.password) : (passwordRequired ? '' : null),
      role: input.role,
      enabled: input.enabled,
      siteIds: input.siteIds ?? [],
    };
  }

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('powerguard-token') || '';
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }
}
