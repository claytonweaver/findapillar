import { inject, Injectable } from '@angular/core';
import { Observable, from, map, shareReplay } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { Denomination } from '../models/denomination.model';

@Injectable({ providedIn: 'root' })
export class DenominationService {
  private readonly supabase = inject(SupabaseService);

  /** Flat list of all denominations — cached for session lifetime. */
  readonly denominations$: Observable<Denomination[]> = from(
    this.supabase.db
      .from('denominations')
      .select('*')
      .order('level')
      .order('name')
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as Denomination[];
      })
  ).pipe(shareReplay(1));

  /** Tree rooted at the given level (default: level 2 = Protestant/Catholic/Orthodox). */
  readonly denominationTree$: Observable<Denomination[]> = this.denominations$.pipe(
    map(flat => this.buildTree(flat)),
    shareReplay(1)
  );

  /** Given a set of selected denomination IDs, expand to include all descendant IDs. */
  expandToDescendants(flat: Denomination[], selectedIds: string[]): string[] {
    if (!selectedIds.length) return [];
    const all = new Set<string>(selectedIds);
    const addDescendants = (parentId: string) => {
      flat
        .filter(d => d.parent_id === parentId)
        .forEach(d => { all.add(d.id); addDescendants(d.id); });
    };
    selectedIds.forEach(id => addDescendants(id));
    return Array.from(all);
  }

  private buildTree(flat: Denomination[], parentId: string | null = null): Denomination[] {
    return flat
      .filter(d => d.parent_id === parentId)
      .map(d => ({ ...d, children: this.buildTree(flat, d.id) }));
  }
}
