import { inject, Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';

export interface CitySuggestion {
  city: string;
  state: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class LocationService {
  private readonly supabase = inject(SupabaseService);

  suggestCities(term: string): Observable<CitySuggestion[]> {
    if (!term.trim()) return of([]);

    const query = this.supabase.db
      .from('churches')
      .select('city, state')
      .ilike('city', `${term.trim()}%`)
      .eq('is_active', true)
      .not('city', 'is', null)
      .not('state', 'is', null)
      .order('city')
      .limit(100);

    return from(query).pipe(
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
}
