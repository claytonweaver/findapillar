import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { LocationService, CitySuggestion } from '../../core/services/location.service';

@Component({
  selector: 'app-home-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnDestroy {
  location = '';
  suggestions: CitySuggestion[] = [];
  showSuggestions = false;

  private readonly destroy$ = new Subject<void>();
  private readonly input$ = new Subject<string>();

  constructor(
    private readonly router: Router,
    private readonly locationService: LocationService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.input$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      switchMap(term => this.locationService.suggestCities(term)),
      takeUntil(this.destroy$),
    ).subscribe(suggestions => {
      this.suggestions = suggestions;
      this.showSuggestions = suggestions.length > 0;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  onInput(value: string): void {
    this.input$.next(value);
  }

  selectSuggestion(s: CitySuggestion): void {
    this.location = s.label;
    this.showSuggestions = false;
    const params = s.zip ? { zip: s.zip } : { city: s.city, state: s.state };
    this.router.navigate(['/search'], { queryParams: params });
  }

  hideSuggestions(): void {
    setTimeout(() => { this.showSuggestions = false; this.cdr.markForCheck(); }, 150);
  }

  onSearch(): void {
    const q = this.location.trim();
    if (!q) return;
    this.showSuggestions = false;
    // If exactly matches a suggestion, use structured params
    const match = this.suggestions.find(s => s.label.toLowerCase() === q.toLowerCase());
    if (match) {
      this.router.navigate(['/search'], { queryParams: { city: match.city, state: match.state } });
      return;
    }
    this.router.navigate(['/search'], { queryParams: { location: q } });
  }
}
