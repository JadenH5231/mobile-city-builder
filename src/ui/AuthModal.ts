/**
 * Auth modal controller (Alpha 4.25). Wraps the auth form HTML in
 * `index.html` with a small state machine for the three flows:
 *  - Sign in (email + password)
 *  - Create account (email + password → email confirmation)
 *  - Magic link (email only → click email link → signed in)
 *
 * Vanilla DOM, no framework. Hooks into `getSupabase()` directly.
 *
 * Public surface:
 *  - `new AuthModal()` wires up DOM listeners
 *  - `.open()` shows the modal
 *  - `.close()` hides it
 *  - `.onSuccess` callback fires after a successful sign-in (used to
 *    refresh the city load + show a status toast)
 */

import { getSupabase } from '../auth/SupabaseClient';

type Pane = 'signin' | 'signup' | 'magic' | 'verify';

export class AuthModal {
  private modal: HTMLElement;
  private status: HTMLElement;
  /** Email captured at sign-up / magic-link send time, carried into the
   *  verify pane so the user doesn't have to retype it. (Beta 1.0.2) */
  private pendingEmail = '';
  /** Tracks how the user arrived at the verify pane so resend uses the
   *  matching API call (signUp.resend vs. signInWithOtp). */
  private pendingFlow: 'signup' | 'magic' | null = null;
  /** Optional caller hook fired on successful sign-in (not on sign-up
   *  email send or magic-link send — those don't sign the user in
   *  immediately). The caller typically reloads the city on this. */
  onSuccess?: () => void;

  constructor() {
    const modal = document.getElementById('auth-modal');
    const status = document.getElementById('auth-modal-status');
    if (!modal || !status) {
      throw new Error('Auth modal HTML missing — check index.html for #auth-modal');
    }
    this.modal = modal;
    this.status = status;

    // Close handlers — click backdrop or X button.
    for (const el of modal.querySelectorAll('[data-auth-close]')) {
      el.addEventListener('click', () => this.close());
    }

    // Tab switching.
    for (const tab of modal.querySelectorAll<HTMLButtonElement>('[data-auth-tab]')) {
      tab.addEventListener('click', () => {
        const pane = tab.dataset.authTab as Pane;
        this.switchPane(pane);
      });
    }

    // OAuth buttons (Beta 1.0). Each one calls supabase.auth.signInWithOAuth
    // and the redirect handles the rest. If the provider isn't enabled in
    // the Supabase dashboard, surfacing the error in the status pane is
    // enough — the user understands "this needs setup."
    for (const btn of modal.querySelectorAll<HTMLButtonElement>('[data-auth-oauth]')) {
      btn.addEventListener('click', () => {
        const provider = btn.dataset.authOauth as 'google' | 'apple';
        this.handleOAuth(provider);
      });
    }

    // Form submits — one handler per pane.
    document.getElementById('auth-form-signin')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSignIn(e.target as HTMLFormElement);
    });
    document.getElementById('auth-form-signup')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSignUp(e.target as HTMLFormElement);
    });
    document.getElementById('auth-form-magic')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleMagicLink(e.target as HTMLFormElement);
    });
    document.getElementById('auth-form-verify')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleVerify(e.target as HTMLFormElement);
    });
    document.getElementById('auth-verify-resend')?.addEventListener('click', () => {
      this.handleResend();
    });

    // Esc closes the modal.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  open(initialPane: Pane = 'signin'): void {
    this.switchPane(initialPane);
    this.setStatus('', null);
    this.modal.classList.remove('hidden');
  }
  close(): void {
    this.modal.classList.add('hidden');
  }

  private switchPane(pane: Pane): void {
    for (const tab of this.modal.querySelectorAll<HTMLButtonElement>('[data-auth-tab]')) {
      tab.classList.toggle('is-active', tab.dataset.authTab === pane);
    }
    for (const form of this.modal.querySelectorAll<HTMLFormElement>('[data-auth-pane]')) {
      form.classList.toggle('is-active', form.dataset.authPane === pane);
    }
    this.setStatus('', null);
  }

  private setStatus(msg: string, kind: 'error' | 'success' | null): void {
    this.status.textContent = msg;
    this.status.classList.remove('is-error', 'is-success');
    if (kind === 'error') this.status.classList.add('is-error');
    else if (kind === 'success') this.status.classList.add('is-success');
  }

  private async handleSignIn(form: HTMLFormElement): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-in is not configured for this build.', 'error'); return; }
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!email || !password) { this.setStatus('Email and password required.', 'error'); return; }
    this.setSubmitting(form, true);
    this.setStatus('Signing in…', null);
    const { error } = await supa.auth.signInWithPassword({ email, password });
    this.setSubmitting(form, false);
    if (error) {
      this.setStatus(error.message, 'error');
      return;
    }
    this.setStatus('Signed in.', 'success');
    this.onSuccess?.();
    setTimeout(() => this.close(), 600);
  }

  private async handleSignUp(form: HTMLFormElement): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-up is not configured for this build.', 'error'); return; }
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    if (!email || !password) { this.setStatus('Email and password required.', 'error'); return; }
    if (password.length < 6) { this.setStatus('Password must be at least 6 characters.', 'error'); return; }
    this.setSubmitting(form, true);
    this.setStatus('Creating account…', null);
    const { data, error } = await supa.auth.signUp({ email, password });
    this.setSubmitting(form, false);
    if (error) {
      this.setStatus(error.message, 'error');
      return;
    }
    if (data.session) {
      // Auto-confirmed (Supabase project setting OFF email confirmation).
      this.setStatus('Account created. Signed in.', 'success');
      this.onSuccess?.();
      setTimeout(() => this.close(), 600);
    } else {
      // Email confirmation required → switch to the verify-code pane
      // (Beta 1.0.2). The code is in the email Supabase just sent.
      this.pendingEmail = email;
      this.pendingFlow = 'signup';
      this.showVerifyPane(email, `We sent a 6-digit code to ${email}. Enter it below to finish creating your account.`);
    }
  }

  private async handleMagicLink(form: HTMLFormElement): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-in is not configured for this build.', 'error'); return; }
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim();
    if (!email) { this.setStatus('Email required.', 'error'); return; }
    this.setSubmitting(form, true);
    this.setStatus('Sending code…', null);
    // shouldCreateUser:false so the magic-link tab can't accidentally
    // create a brand-new account (use the Create account tab for that).
    const { error } = await supa.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    this.setSubmitting(form, false);
    if (error) {
      this.setStatus(error.message, 'error');
      return;
    }
    this.pendingEmail = email;
    this.pendingFlow = 'magic';
    this.showVerifyPane(email, `We sent a 6-digit code to ${email}. Enter it below to sign in.`);
  }

  /** Switch to the verify-code pane. Pre-fills the (read-only) email
   *  field and updates the helper message. */
  private showVerifyPane(email: string, message: string): void {
    const emailInput = document.getElementById('auth-verify-email') as HTMLInputElement | null;
    const msgEl = document.getElementById('auth-verify-msg');
    if (emailInput) emailInput.value = email;
    if (msgEl) msgEl.textContent = message;
    this.switchPane('verify');
    // Auto-focus the code input so the player can start typing immediately.
    setTimeout(() => {
      const tokenInput = document.querySelector<HTMLInputElement>('#auth-form-verify input[name="token"]');
      tokenInput?.focus();
    }, 50);
  }

  private async handleVerify(form: HTMLFormElement): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-in is not configured for this build.', 'error'); return; }
    const fd = new FormData(form);
    const email = String(fd.get('email') ?? '').trim() || this.pendingEmail;
    const token = String(fd.get('token') ?? '').trim();
    if (!email || !token) { this.setStatus('Email and code required.', 'error'); return; }
    if (!/^\d{6}$/.test(token)) { this.setStatus('Enter the 6-digit code from your email.', 'error'); return; }
    this.setSubmitting(form, true);
    this.setStatus('Verifying…', null);
    // type:'email' covers both signup-confirmation and magic-link OTP
    // verification in Supabase's current API.
    const { error } = await supa.auth.verifyOtp({ email, token, type: 'email' });
    this.setSubmitting(form, false);
    if (error) {
      this.setStatus(error.message, 'error');
      return;
    }
    this.setStatus('Signed in.', 'success');
    this.onSuccess?.();
    setTimeout(() => this.close(), 600);
  }

  /** Resend the verification code via the same flow that sent the
   *  original. Used from the "Resend the code" link on the verify
   *  pane. */
  private async handleResend(): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-in is not configured for this build.', 'error'); return; }
    const email = this.pendingEmail;
    if (!email) { this.setStatus('No pending email. Start over.', 'error'); return; }
    this.setStatus('Resending code…', null);
    let error;
    if (this.pendingFlow === 'signup') {
      ({ error } = await supa.auth.resend({ type: 'signup', email }));
    } else {
      ({ error } = await supa.auth.signInWithOtp({ email, options: { shouldCreateUser: false } }));
    }
    if (error) {
      this.setStatus(error.message, 'error');
      return;
    }
    this.setStatus(`A new 6-digit code was sent to ${email}.`, 'success');
  }

  private setSubmitting(form: HTMLFormElement, busy: boolean): void {
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) btn.disabled = busy;
  }

  private async handleOAuth(provider: 'google' | 'apple'): Promise<void> {
    const supa = getSupabase();
    if (!supa) { this.setStatus('Cloud sign-in is not configured for this build.', 'error'); return; }
    this.setStatus(`Redirecting to ${provider === 'google' ? 'Google' : 'Apple'}…`, null);
    // Disable both OAuth buttons during redirect so the user doesn't
    // double-click and end up with two redirects fighting each other.
    for (const btn of this.modal.querySelectorAll<HTMLButtonElement>('[data-auth-oauth]')) {
      btn.disabled = true;
    }
    const { error } = await supa.auth.signInWithOAuth({
      provider,
      options: {
        // Come back to the same URL after OAuth — Supabase's
        // detectSessionInUrl picks up the tokens and onAuthStateChange
        // fires, which our main.ts handler reloads on.
        redirectTo: window.location.href
      }
    });
    if (error) {
      this.setStatus(error.message, 'error');
      for (const btn of this.modal.querySelectorAll<HTMLButtonElement>('[data-auth-oauth]')) {
        btn.disabled = false;
      }
    }
    // On success, the browser navigates away to the OAuth provider —
    // no need to handle the success path here.
  }
}
