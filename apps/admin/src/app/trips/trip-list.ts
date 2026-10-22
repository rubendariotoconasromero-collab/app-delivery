import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { filter, finalize, interval } from 'rxjs';
import { apiError } from '../core/identity';
import { bolivianos, cashNames, Trip, TripsApi, tripStateNames } from '../core/trips-api';

@Component({
  selector: 'app-trip-list',
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink],
  templateUrl: './trip-list.html',
})
export class TripList implements OnInit {
  private readonly api = inject(TripsApi);
  private readonly destroy = inject(DestroyRef);
  readonly trips = signal<Trip[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly state = signal('searching');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly checkedAt = signal<Date | null>(null);
  readonly names = tripStateNames;
  readonly states = Object.entries(tripStateNames);
  readonly cashNames = cashNames;
  readonly money = bolivianos;
  ngOnInit(): void {
    this.load();
    interval(15000)
      .pipe(
        filter(() => document.visibilityState === 'visible'),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe(() => this.load());
  }
  filter(state: string): void {
    this.state.set(state);
    this.offset.set(0);
    this.trips.set([]);
    this.load();
  }
  page(direction: number): void {
    this.offset.update((value) => Math.max(0, value + direction * 50));
    this.trips.set([]);
    this.load();
  }
  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.api
      .list(this.state(), this.offset())
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe({
        next: ({ items, total }) => {
          this.trips.set(items);
          this.total.set(total);
          this.checkedAt.set(new Date());
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
}
