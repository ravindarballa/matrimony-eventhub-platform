import { computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import type { AuthResponse, Role, SessionUser } from '@eventhub/contracts';

import { AuthApi } from './auth-api';

interface AuthState {
  user: SessionUser | null;
  /**
   * In memory only - never localStorage. An XSS in any third-party script would
   * otherwise walk away with a valid bearer token. The refresh token lives in an
   * httpOnly cookie the browser attaches for us.
   */
  accessToken: string | null;
  status: 'idle' | 'loading' | 'bootstrapping';
}

const initial: AuthState = { user: null, accessToken: null, status: 'bootstrapping' };

/**
 * The one genuinely global store on the platform. Every other feature uses
 * httpResource or plain signals; a session is the exception because guards, the
 * shell and the interceptors all read it.
 */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ user, status }) => ({
    isAuthenticated: computed(() => user() !== null),
    roles: computed<readonly Role[]>(() => user()?.roles ?? []),
    displayName: computed(() => user()?.fullName ?? ''),
    isBusy: computed(() => status() !== 'idle'),
    isVendorVerified: computed(() => user()?.vendor?.kycStatus === 'VERIFIED'),
    /** False for anyone who registered and never set one - i.e. by default. */
    hasPassword: computed(() => user()?.hasPassword ?? false),
    isCustomer: computed(() => (user()?.roles ?? []).includes('CUSTOMER')),
    isSeeker: computed(() => (user()?.roles ?? []).includes('SEEKER')),
  })),
  withMethods((store) => {
    const api = inject(AuthApi);
    const router = inject(Router);

    const apply = (res: AuthResponse): void =>
      patchState(store, { user: res.user, accessToken: res.accessToken, status: 'idle' });

    return {
      setSession: (user: SessionUser, accessToken: string): void =>
        patchState(store, { user, accessToken, status: 'idle' }),

      clearSession: (): void =>
        patchState(store, { user: null, accessToken: null, status: 'idle' }),

      /**
       * Runs once at bootstrap. A hard refresh restores the session from the
       * cookie before the first route resolves, so no page flashes signed-out.
       */
      async restore(): Promise<void> {
        try {
          apply(await firstValueFrom(api.refresh()));
        } catch {
          patchState(store, { user: null, accessToken: null, status: 'idle' });
        }
      },

      async loginWithPassword(mobile: string, password: string): Promise<void> {
        patchState(store, { status: 'loading' });
        try {
          apply(await firstValueFrom(api.login(mobile, password)));
        } catch (err) {
          patchState(store, { status: 'idle' });
          throw err;
        }
      },

      /**
       * Takes a seeker into the wedding side of the platform.
       *
       * The refresh afterwards is not optional: roles live in the access token,
       * and the server's guards read them from there. Without a new token the
       * client would believe it had the role while every API call it made was
       * refused - which looks like a broken product rather than a missing role.
       */
      async becomeCustomer(): Promise<void> {
        await firstValueFrom(api.addRole('CUSTOMER'));
        apply(await firstValueFrom(api.refresh()));
      },

      /** Sign in with a one-time code, for an account with no password yet. */
      async loginWithOtp(
        mobile: string,
        challengeId: string,
        code: string,
      ): Promise<void> {
        patchState(store, { status: 'loading' });
        try {
          apply(await firstValueFrom(api.loginWithOtp(mobile, challengeId, code)));
        } catch (err) {
          patchState(store, { status: 'idle' });
          throw err;
        }
      },

      /**
       * Setting a password revokes every session, this one included, so the
       * store refreshes from /auth/me to pick up the new state rather than
       * trusting what it held before.
       */
      async setPassword(password: string, currentPassword?: string): Promise<void> {
        await firstValueFrom(api.setPassword(password, currentPassword));
        const user = await firstValueFrom(api.me());
        patchState(store, { user });
      },

      async verifyOtp(challengeId: string, code: string): Promise<void> {
        patchState(store, { status: 'loading' });
        try {
          apply(await firstValueFrom(api.verifyOtp(challengeId, code)));
        } catch (err) {
          patchState(store, { status: 'idle' });
          throw err;
        }
      },

      async logout(): Promise<void> {
        try {
          await firstValueFrom(api.logout());
        } finally {
          // Clear locally even if the server call failed - the user asked to leave.
          patchState(store, { user: null, accessToken: null, status: 'idle' });
          await router.navigateByUrl('/auth/login');
        }
      },
    };
  }),
);
