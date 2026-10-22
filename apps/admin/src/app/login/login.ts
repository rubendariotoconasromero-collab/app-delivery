import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';
import { apiError, Identity } from '../core/identity';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
})
export class Login {
  private readonly identity = inject(Identity);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly expired = this.route.snapshot.queryParamMap.has('expired');
  readonly unavailable = this.route.snapshot.queryParamMap.has('unavailable');
  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    totp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  submit(): void {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    const { email, password, totp } = this.form.getRawValue();
    this.identity
      .login(email, password, totp)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.form.controls.password.reset();
          this.form.controls.totp.reset();
        }),
      )
      .subscribe({
        next: () => {
          const requested = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
          const safe =
            requested === '/' || /^\/(conductores|usuarios)(\/[^?#]*)?(\?[^#]*)?$/.test(requested);
          void this.router.navigateByUrl(safe ? requested : '/');
        },
        error: (error: unknown) => this.error.set(apiError(error)),
      });
  }
}
