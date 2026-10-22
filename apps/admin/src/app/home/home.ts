import { DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { DependencyName, PlatformStatus } from '../core/platform-status';

@Component({
  selector: 'app-home',
  imports: [DatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  readonly platform = inject(PlatformStatus);
  readonly dependencies: { key: DependencyName; name: string; detail: string }[] = [
    { key: 'postgres', name: 'PostgreSQL', detail: 'Persistencia de la plataforma' },
    { key: 'postgis', name: 'PostGIS', detail: 'Consultas y cobertura geográfica' },
    { key: 'redis', name: 'Redis', detail: 'Disponibilidad y datos temporales' },
  ];

  ngOnInit(): void {
    this.platform.refresh();
  }
}
