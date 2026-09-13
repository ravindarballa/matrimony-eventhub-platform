import { DOCUMENT, Injectable, NgZone, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthStore } from '../../features/auth/data/auth.store';

/**
 * How long a signed-in member may do nothing before the session ends.
 *
 * Thirty minutes is the consumer default, and it is the right end of the range
 * for this product rather than the fifteen a bank would use. Two facts decide
 * it: a matrimony profile carries mobile numbers, photographs and horoscopes,
 * and it is very often opened on a device the whole family uses - a parent's
 * phone passed around, a shared desktop. That is a real argument for having a
 * timeout at all, which a photo-sharing app does not have. Against that, a
 * family reads a profile slowly and discusses it between themselves, and
 * signing them out mid-conversation to save fifteen minutes of exposure is a
 * bad trade.
 */
const IDLE_LIMIT_MS = 30 * 60 * 1000;

/** How long the warning stands before the session actually ends. */
const WARN_BEFORE_MS = 2 * 60 * 1000;

/**
 * Shared across tabs. Activity in any one of them keeps all of them alive,
 * which is what stops a second tab left open on a dashboard from signing
 * somebody out of the tab they are actually typing in.
 */
const LAST_ACTIVE_KEY = 'eh.lastActiveAt';

/** Coarse, because this is written on every scroll and keypress. */
const WRITE_THROTTLE_MS = 5_000;

/**
 * Ends a session that has gone quiet, after saying so first.
 *
 * Distinct from token expiry, which this does not touch. The access token lasts
 * fifteen minutes and is refreshed silently behind every request, so a member
 * who is working is never interrupted - that is the refresh interceptor's job
 * and it is already done. This is the opposite case: somebody who stopped, on a
 * device that may not be theirs alone.
 *
 * The warning is not a courtesy. A timeout that fires silently looks exactly
 * like a bug - the page simply forgets who you are - and the member's first
 * assumption is that the site logged them out at random.
 */
@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly doc = inject(DOCUMENT);

  /** Milliseconds left before sign-out, or null when not counting down. */
  private readonly remaining = signal<number | null>(null);

  readonly warning = computed(() => this.remaining() !== null);

  /** Whole seconds, for the countdown the dialog shows. */
  readonly secondsLeft = computed(() => {
    const ms = this.remaining();
    return ms === null ? 0 : Math.max(0, Math.ceil(ms / 1000));
  });

  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastWrite = 0;
  private listening = false;

  constructor() {
    // Starts with the session and stops with it, so a signed-out visitor is
    // never counted down and no listeners are left attached to a public page.
    effect(() => {
      if (this.store.isAuthenticated()) this.start();
      else this.stop();
    });
  }

  /** Called by the dialog's "stay signed in", and by any real activity. */
  markActive(): void {
    this.remaining.set(null);
    this.writeLastActive(Date.now());
  }

  private start(): void {
    if (this.listening) return;
    this.listening = true;

    this.writeLastActive(Date.now());

    // Outside Angular: these fire constantly, and running change detection on
    // every scroll frame to update a number nobody is looking at is the kind of
    // thing that makes a page feel heavy for no visible reason.
    this.zone.runOutsideAngular(() => {
      for (const ev of ACTIVITY_EVENTS) {
        this.doc.addEventListener(ev, this.onActivity, { passive: true });
      }
      this.doc.addEventListener('visibilitychange', this.onVisible);
      window.addEventListener('storage', this.onStorage);

      this.ticker = setInterval(() => this.check(), 1_000);
    });
  }

  private stop(): void {
    if (!this.listening) return;
    this.listening = false;

    for (const ev of ACTIVITY_EVENTS) {
      this.doc.removeEventListener(ev, this.onActivity);
    }
    this.doc.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('storage', this.onStorage);

    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.zone.run(() => this.remaining.set(null));
  }

  private readonly onActivity = (): void => {
    // Not while the warning is up. Once it is showing, only the button in it
    // counts - otherwise the mouse movement of reaching for that button would
    // dismiss the dialog, and the member would never learn the session had
    // been about to end.
    if (this.remaining() !== null) return;
    this.writeLastActive(Date.now());
  };

  /**
   * Coming back to a hidden tab checks immediately.
   *
   * A backgrounded tab has its timers throttled by the browser, so the session
   * can be well past its limit before the next tick would have run.
   */
  private readonly onVisible = (): void => {
    if (this.doc.visibilityState === 'visible') this.check();
  };

  /** Another tab saw activity, so this one is alive too. */
  private readonly onStorage = (e: StorageEvent): void => {
    if (e.key === LAST_ACTIVE_KEY) this.zone.run(() => this.remaining.set(null));
  };

  private check(): void {
    const idleFor = Date.now() - this.readLastActive();
    const left = IDLE_LIMIT_MS - idleFor;

    if (left <= 0) {
      this.zone.run(() => void this.expire());
      return;
    }

    if (left <= WARN_BEFORE_MS) {
      this.zone.run(() => this.remaining.set(left));
    } else if (this.remaining() !== null) {
      // Another tab reset the clock while this one was counting down.
      this.zone.run(() => this.remaining.set(null));
    }
  }

  /**
   * Ends the session and says why.
   *
   * To the login form rather than home, carrying where they were: this is a
   * session that stopped mid-task, which is exactly the case the ordinary
   * sign-out is careful NOT to treat this way. Somebody who walked away from a
   * half-written message wants to come back to it.
   */
  private async expire(): Promise<void> {
    this.remaining.set(null);
    const returnUrl = this.router.url;

    this.stop();
    this.store.clearSession();
    try {
      localStorage.removeItem(LAST_ACTIVE_KEY);
    } catch {
      // Private mode, or storage refused. Nothing here depends on the removal.
    }

    await this.router.navigate(['/auth/login'], {
      queryParams: { returnUrl, reason: 'timeout' },
    });
  }

  private readLastActive(): number {
    try {
      const raw = localStorage.getItem(LAST_ACTIVE_KEY);
      const at = raw ? Number(raw) : NaN;
      return Number.isFinite(at) ? at : Date.now();
    } catch {
      // Storage unavailable: fall back to this tab only, which still times out
      // correctly - it just cannot be kept alive by a sibling tab.
      return this.memoryLastActive;
    }
  }

  private memoryLastActive = Date.now();

  private writeLastActive(at: number): void {
    this.memoryLastActive = at;
    if (at - this.lastWrite < WRITE_THROTTLE_MS) return;
    this.lastWrite = at;
    try {
      localStorage.setItem(LAST_ACTIVE_KEY, String(at));
    } catch {
      // As above - the in-memory value is the fallback.
    }
  }
}

/**
 * What counts as being here.
 *
 * Deliberately not `mousemove`: a mouse nudged by a passing sleeve is not
 * somebody using the site, and on a shared machine that is the exact case the
 * timeout exists for. Pointer presses, keys, scrolls and touches are all
 * deliberate.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
