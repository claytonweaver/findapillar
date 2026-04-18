import { inject, Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';

export interface CitySuggestion {
  city: string;
  state: string;
  zip?: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class LocationService {
  private readonly supabase = inject(SupabaseService);

  suggestCities(term: string): Observable<CitySuggestion[]> {
    const t = term.trim();
    if (!t) return of([]);
    return /^\d+$/.test(t) ? this.suggestByZip(t) : this.suggestByCity(t);
  }

  private suggestByCity(term: string): Observable<CitySuggestion[]> {
    return from(
      this.supabase.db
        .from('churches')
        .select('city, state')
        .ilike('city', `${term}%`)
        .eq('is_active', true)
        .not('city', 'is', null)
        .not('state', 'is', null)
        .order('city')
        .limit(100)
    ).pipe(
      map(({ data }) => {
        const seen = new Set<string>();
        const results: CitySuggestion[] = [];
        for (const row of data ?? []) {
          const key = `${row.city},${row.state}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({ city: row.city, state: row.state, label: `${row.city}, ${row.state}` });
          if (results.length >= 8) break;
        }
        return results;
      }),
      catchError(() => of([])),
    );
  }

  private suggestByZip(zip: string): Observable<CitySuggestion[]> {
    return from(
      this.supabase.db
        .from('churches')
        .select('city, state, zip')
        .like('zip', `${zip}%`)
        .eq('is_active', true)
        .not('zip', 'is', null)
        .order('zip')
        .limit(100)
    ).pipe(
      map(({ data }) => {
        const seen = new Set<string>();
        const results: CitySuggestion[] = [];
        for (const row of data ?? []) {
          if (!row.zip || seen.has(row.zip)) continue;
          seen.add(row.zip);
          const cityPart = row.city && row.state ? ` — ${row.city}, ${row.state}` : '';
          results.push({ city: row.city ?? '', state: row.state ?? '', zip: row.zip, label: `${row.zip}${cityPart}` });
          if (results.length >= 8) break;
        }
        return results;
      }),
      catchError(() => of([])),
    );
  }
}
