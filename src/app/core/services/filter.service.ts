import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ChurchFilters, DEFAULT_FILTERS } from '../models/filter.model';

@Injectable({ providedIn: 'root' })
export class FilterService {
  private readonly filtersSubject = new BehaviorSubject<ChurchFilters>(DEFAULT_FILTERS);

  /** Observable stream of the current filters. */
  readonly filters$: Observable<ChurchFilters> = this.filtersSubject.asObservable();

  get current(): ChurchFilters {
    return this.filtersSubject.value;
  }

  setFilters(filters: ChurchFilters): void {
    this.filtersSubject.next({ ...filters });
  }

  patchFilter<K extends keyof ChurchFilters>(key: K, value: ChurchFilters[K]): void {
    this.filtersSubject.next({ ...this.filtersSubject.value, [key]: value });
  }

  reset(): void {
    this.filtersSubject.next({ ...DEFAULT_FILTERS });
  }
}
