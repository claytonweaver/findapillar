import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BadgeModule } from 'primeng/badge';
import { TagModule } from 'primeng/tag';
import { Church, formatAttendance } from '../../../../core/models/church.model';

@Component({
  selector: 'app-church-card',
  standalone: true,
  imports: [CommonModule, RouterModule, BadgeModule, TagModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="church-card"
      [class.is-selected]="isSelected"
      [class.is-hovered]="isHovered"
      (mouseenter)="hovered.emit(church.id)"
      (mouseleave)="hovered.emit(null)"
      (click)="selected.emit(church.id)"
    >
      <!-- Thumbnail -->
      <div class="church-card__thumb">
        <img
          *ngIf="church.cover_photo; else placeholder"
          [src]="church.cover_photo"
          [alt]="church.name"
        />
        <ng-template #placeholder>
          <div class="church-card__thumb-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                d="M3 21V7l9-4 9 4v14M9 21V11h6v10" />
            </svg>
          </div>
        </ng-template>
        <div *ngIf="church.is_verified" class="church-card__verified">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/>
          </svg>
        </div>
      </div>

      <!-- Body -->
      <div class="church-card__body">
        <p *ngIf="denomination" class="church-card__denom">{{ denomination }}</p>
        <h3 class="church-card__name">{{ church.name }}</h3>

        <div class="church-card__meta">
          <span *ngIf="church.city" class="church-card__meta-item">
            <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1.5A4.5 4.5 0 003.5 6c0 3 4.5 8.5 4.5 8.5S12.5 9 12.5 6A4.5 4.5 0 008 1.5zM8 8a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>
            {{ church.city }}, {{ church.state }}
          </span>
          <span *ngIf="church.average_attendance" class="church-card__meta-item">
            <svg viewBox="0 0 16 16" fill="currentColor"><path d="M7 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1 14.5a6 6 0 0112 0H1zM14.5 8a2 2 0 100-4 2 2 0 000 4zM11 14.5a3.5 3.5 0 00-1.4-2.8A7.48 7.48 0 0114.5 10a5.5 5.5 0 011 .1 5.5 5.5 0 01.5 4.4H11z"/></svg>
            ~{{ formatAtt(church.average_attendance) }}
          </span>
          <span *ngIf="firstServiceTime" class="church-card__meta-item">
            <svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3.5a.75.75 0 01.75.75v3.25h2a.75.75 0 010 1.5H8a.75.75 0 01-.75-.75v-4A.75.75 0 018 4.5z" clip-rule="evenodd"/></svg>
            {{ firstServiceTime }}
          </span>
        </div>

        <div *ngIf="church.pastors?.length" class="church-card__pastor">
          {{ primaryPastor?.title || 'Pastor' }}: {{ primaryPastor?.name }}
        </div>

        <div *ngIf="church.church_tags?.length" class="church-card__tags">
          <span *ngFor="let tag of visibleTags" class="church-card__tag">{{ tag.tag }}</span>
          <span *ngIf="(church.church_tags?.length || 0) > 3" class="church-card__tag church-card__tag--more">
            +{{ (church.church_tags?.length || 0) - 3 }}
          </span>
        </div>
      </div>

      <!-- Selected CTA -->
      <div *ngIf="isSelected" class="church-card__cta">
        <a [routerLink]="['/church', church.slug || church.id]" (click)="$event.stopPropagation()">
          View details →
        </a>
      </div>
    </div>
  `,
  styles: [`
    .church-card {
      display: flex;
      gap: 0.875rem;
      padding: 0.875rem;
      border-radius: var(--sanctuary-radius);
      border: 1.5px solid transparent;
      background: transparent;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
      position: relative;
    }
    .church-card:hover, .church-card.is-hovered {
      background: white;
      box-shadow: var(--sanctuary-shadow-sm);
    }
    .church-card.is-selected {
      background: #FEF9F5;
      border-color: #D97706;
      box-shadow: 0 2px 8px rgba(217,119,6,0.12);
    }

    /* Thumbnail */
    .church-card__thumb {
      position: relative;
      width: 108px;
      height: 108px;
      flex-shrink: 0;
      border-radius: 0.75rem;
      overflow: hidden;
      background: #ede9e3;
    }
    .church-card__thumb img {
      width: 100%; height: 100%; object-fit: cover;
      transition: transform 0.3s ease;
    }
    .church-card:hover .church-card__thumb img { transform: scale(1.04); }
    .church-card__thumb-placeholder {
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #c4bdb6;
    }
    .church-card__thumb-placeholder svg { width: 2rem; height: 2rem; }
    .church-card__verified {
      position: absolute; top: 5px; right: 5px;
      width: 20px; height: 20px; color: #2563eb;
      background: white; border-radius: 50%;
    }
    .church-card__verified svg { width: 100%; height: 100%; }

    /* Body */
    .church-card__body { flex: 1; min-width: 0; }
    .church-card__denom {
      font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sanctuary-accent);
      margin: 0 0 0.2rem;
    }
    .church-card__name {
      font-size: 0.9375rem; font-weight: 600; color: var(--sanctuary-text);
      margin: 0 0 0.375rem; line-height: 1.3;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .church-card__meta {
      display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; margin-bottom: 0.25rem;
    }
    .church-card__meta-item {
      display: flex; align-items: center; gap: 0.25rem;
      font-size: 0.75rem; color: var(--sanctuary-muted);
    }
    .church-card__meta-item svg { width: 11px; height: 11px; flex-shrink: 0; }
    .church-card__pastor {
      font-size: 0.75rem; color: var(--sanctuary-muted); margin-bottom: 0.375rem;
    }
    .church-card__tags { display: flex; flex-wrap: wrap; gap: 0.25rem; }
    .church-card__tag {
      font-size: 0.6875rem; padding: 0.2rem 0.5rem;
      border-radius: 999px; background: #f5f2ed;
      border: 1px solid #e8e4de; color: #57534e;
      white-space: nowrap;
    }
    .church-card__tag--more { color: var(--sanctuary-accent); background: var(--sanctuary-accent-bg); border-color: #fcd5b5; }

    /* CTA */
    .church-card__cta {
      position: absolute; bottom: 0.75rem; right: 0.875rem;
    }
    .church-card__cta a {
      font-size: 0.75rem; font-weight: 600;
      color: var(--sanctuary-accent); text-decoration: none;
    }
    .church-card__cta a:hover { text-decoration: underline; }
  `]
})
export class ChurchCardComponent {
  @Input({ required: true }) church!: Church;
  @Input() isSelected = false;
  @Input() isHovered = false;
  @Output() hovered = new EventEmitter<string | null>();
  @Output() selected = new EventEmitter<string>();

  formatAtt = formatAttendance;

  get denomination(): string {
    const path = this.church.denomination_path;
    return path && path.length > 1 ? path[path.length - 1] : (path?.[0] ?? '');
  }

  get primaryPastor() {
    return this.church.pastors?.find(p => p.is_primary) ?? this.church.pastors?.[0];
  }

  get firstServiceTime(): string {
    const mt = this.church.meeting_times?.[0];
    if (!mt) return '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const [h, m] = mt.start_time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    const mins = m ? `:${String(m).padStart(2, '0')}` : '';
    return `${days[mt.day_of_week]} ${hour}${mins} ${ampm}`;
  }

  get visibleTags() {
    return this.church.church_tags?.slice(0, 3) ?? [];
  }
}
