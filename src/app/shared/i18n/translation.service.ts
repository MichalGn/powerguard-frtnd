import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Language = 'en' | 'pl';

type TranslationDictionary = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly http = inject(HttpClient);
  private translations: TranslationDictionary = {};

  language: Language = localStorage.getItem('powerguard-language') === 'en' ? 'en' : 'pl';

  async initialize(): Promise<void> {
    await this.load(this.language);
  }

  t(key: string): string {
    return this.translations[key] ?? this.fallback(key);
  }

  private fallback(key: string): string {
    const pl: Record<string, string> = {
      client: 'Klient', clients: 'Klienci', clientsAndSites: 'Klienci i oddziały',
      clientId: 'Client ID', clientName: 'Nazwa klienta', selectClient: 'Wybierz klienta',
      noClients: 'Brak klientów.', addClient: 'Dodaj klienta', editClient: 'Edytuj klienta', deleteClient: 'Usuń klienta',
      clientRequiredFields: 'Client ID i nazwa klienta są wymagane.', clientSaveFailed: 'Nie udało się zapisać klienta.',
      clientDeleteFailed: 'Nie udało się usunąć klienta.', confirmDeleteClient: 'Usunąć klienta?',
      sites: 'Oddziały', site: 'Oddział', selectSite: 'Wybierz oddział', siteName: 'Nazwa oddziału',
      measurementData: 'Dane pomiarowe',
      addSite: 'Dodaj oddział', editSite: 'Edytuj oddział', deleteSite: 'Usuń oddział', noSites: 'Brak oddziałów.',
    };
    const en: Record<string, string> = {
      client: 'Client', clients: 'Clients', clientsAndSites: 'Clients and sites',
      clientId: 'Client ID', clientName: 'Client name', selectClient: 'Select client',
      noClients: 'No clients.', addClient: 'Add client', editClient: 'Edit client', deleteClient: 'Delete client',
      clientRequiredFields: 'Client ID and client name are required.', clientSaveFailed: 'Could not save client.',
      clientDeleteFailed: 'Could not delete client.', confirmDeleteClient: 'Delete client?',
      sites: 'Sites', site: 'Site', selectSite: 'Select site', siteName: 'Site name',
      measurementData: 'Measurement data',
      addSite: 'Add site', editSite: 'Edit site', deleteSite: 'Delete site', noSites: 'No sites.',
    };
    return (this.language === 'pl' ? pl : en)[key] ?? key;
  }

  async setLanguage(language: Language): Promise<void> {
    if (language === this.language) return;

    try {
      const translations = await this.fetch(language);
      this.translations = translations;
      this.language = language;
      localStorage.setItem('powerguard-language', language);
    } catch (error) {
      console.error(`[i18n] Could not load translations for ${language}.`, error);
    }
  }

  private async load(language: Language): Promise<void> {
    try {
      this.translations = await this.fetch(language);
    } catch (error) {
      console.error(`[i18n] Could not load translations for ${language}.`, error);
      this.translations = {};
    }
  }

  private fetch(language: Language): Promise<TranslationDictionary> {
    return firstValueFrom(
      this.http.get<TranslationDictionary>(`i18n/${language}.json`)
    );
  }
}
