import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AdminApi } from '../core/admin-api';
import { apiError, Identity, Role, roleNames, User } from '../core/identity';

@Component({ selector: 'app-users', imports: [FormsModule], templateUrl: './users.html' })
export class Users implements OnInit {
  private readonly api = inject(AdminApi);
  readonly identity = inject(Identity);
  readonly users = signal<User[]>([]);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly success = signal('');
  readonly offset = signal(0);
  readonly editing = signal<User | null>(null);
  readonly names = roleNames;
  readonly availableRoles = Object.keys(roleNames) as Role[];
  selectedRoles: Role[] = [];
  selectedStatus: User['status'] = 'active';
  ngOnInit(): void {
    this.load();
  }
  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.users.set([]);
    this.editing.set(null);
    this.api
      .users(this.offset())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ items }) => this.users.set(items),
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
  page(direction: number): void {
    this.offset.update((value) => Math.max(0, value + direction * 50));
    this.load();
  }
  roleLabel(user: User): string {
    return user.roles.map((role) => this.names[role]).join(' · ');
  }
  edit(user: User): void {
    if (!this.identity.admin() || this.busy()) return;
    this.error.set('');
    this.success.set('');
    this.editing.set(user);
    this.selectedRoles = [...user.roles];
    this.selectedStatus = user.status;
  }
  toggle(role: Role, checked: boolean): void {
    this.selectedRoles = checked
      ? [...new Set([...this.selectedRoles, role])]
      : this.selectedRoles.filter((value) => value !== role);
  }
  save(): void {
    const user = this.editing();
    if (!user || !this.identity.admin() || this.busy()) return;
    if (!this.selectedRoles.length) {
      this.error.set('Selecciona al menos un rol.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    this.api
      .updateUser(user.id, this.selectedRoles, this.selectedStatus)
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({
        next: (updated) => {
          this.users.update((users) =>
            users.map((item) => (item.id === updated.id ? updated : item)),
          );
          this.editing.set(null);
          this.success.set(
            'Permisos y estado actualizados. El servidor aplica los cambios en cada solicitud.',
          );
          if (updated.id === this.identity.user()?.id) {
            const session = this.identity.session();
            if (session) this.identity.session.set({ ...session, user: updated });
          }
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
}
