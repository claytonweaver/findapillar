import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { SkeletonModule } from 'primeng/skeleton';
import { CardModule } from 'primeng/card';
import { ChurchSearchService } from '../../core/services/church-search.service';
import { Church, DAY_NAMES, formatTime } from '../../core/models/church.model';

@Component({
  selector: 'app-church-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, TagModule, DividerModule, SkeletonModule, CardModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './church-detail.component.html',
  styleUrl: './church-detail.component.scss',
})
export class ChurchDetailComponent implements OnInit {
  church: Church | null = null;
  loading = true;

  readonly DAY_NAMES = DAY_NAMES;
  readonly formatTime = formatTime;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly searchService: ChurchSearchService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.searchService.getChurchBySlug(slug).subscribe(church => {
      this.church = church;
      this.loading = false;
      this.cdr.markForCheck();
    });
  }

  get sortedDays(): number[] {
    if (!this.church?.meeting_times) return [];
    return [...new Set(this.church.meeting_times.map(m => m.day_of_week))].sort();
  }

  meetingsForDay(day: number) {
    return (this.church?.meeting_times ?? [])
      .filter(m => m.day_of_week === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  get primaryPastor() { return this.church?.pastors?.find(p => p.is_primary); }
  get otherPastors() { return this.church?.pastors?.filter(p => !p.is_primary) ?? []; }

  get denomLabel(): string {
    const path = this.church?.denomination_path;
    return path && path.length > 1 ? path[path.length - 1] : (path?.[0] ?? '');
  }

  stripProtocol(url: string): string {
    return url.replace(/^https?:\/\//, '');
  }

  get mapsUrl(): string {
    if (!this.church) return '';
    if (this.church.lat && this.church.lng) {
      return `https://www.google.com/maps/search/?api=1&query=${this.church.lat},${this.church.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${this.church.name} ${this.church.street_address} ${this.church.city} ${this.church.state}`
    )}`;
  }
}
