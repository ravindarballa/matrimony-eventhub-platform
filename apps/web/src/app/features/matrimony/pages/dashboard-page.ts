import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { MatrimonyDashboardDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';

/** One thing worth doing next, with the link that does it. */
interface NextStep {
  text: string;
  action: string;
  link: string;
  query?: Record<string, string>;
  /** Urgent steps are somebody waiting on the member, not housekeeping. */
  urgent: boolean;
}

/**
 * The member's own summary.
 *
 * Every number on this page is a door. A count that cannot be clicked is a
 * status light, and status lights are what make dashboards ornamental - so each
 * tile navigates to the list it counts, and the one that cannot (who has
 * shortlisted you) is drawn as a plain figure rather than as a dead button.
 *
 * The order is by whose move it is: what other people are waiting on, then what
 * the member is waiting on, then the standing totals. That ordering is the only
 * editorial judgement on the page, and it is the reason the page is worth
 * opening at all.
 */
@Component({
  selector: 'eh-matrimony-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      @if (summary.isLoading()) { <mat-progress-bar mode="indeterminate" /> }

      @if (summary.value(); as s) {
        <!--
          Who you are and how complete. This is the header a member checks
          against what a family reads back to them over the phone, so the id is
          set in monospace and sits beside the name rather than under it.
        -->
        <header class="hero">
          <div class="who">
            <span class="portrait">
              @if (s.profile?.photoUrl; as url) {
                <img [src]="url" alt="" />
              } @else {
                <span class="initials">{{ initials() }}</span>
              }
            </span>

            <div class="ident">
              <h1>{{ s.profile?.displayName || 'Your dashboard' }}</h1>
              @if (s.profile; as p) {
                <p class="id">
                  <span class="code">{{ p.displayId }}</span>
                  <span class="chip" [class.live]="p.status === 'ACTIVE'">
                    {{ statusWord(p.status) }}
                  </span>
                  @if (p.verified) { <span class="chip ok">Verified</span> }
                </p>
              } @else {
                <p class="id">No profile yet — searching and interests need one.</p>
              }
            </div>
          </div>

          @if (s.profile; as p) {
            <div class="meter">
              <span class="ring" [style.--pct]="p.completeness"
                    [attr.aria-label]="p.completeness + '% complete'">
                <b>{{ p.completeness }}<i>%</i></b>
              </span>
              <a mat-stroked-button class="edit" routerLink="/matrimony/profile/edit">
                {{ p.completeness < 100 ? 'Complete profile' : 'Edit profile' }}
              </a>
            </div>
          } @else {
            <a mat-flat-button routerLink="/matrimony/profile/edit">
              Create your profile
            </a>
          }
        </header>

        <!--
          Waiting on you. Kept apart from the totals below because these are the
          only two numbers on the page that are somebody else's move, and
          mixing them into a wall of six tiles is what makes a dashboard
          something people stop reading.
        -->
        <section class="band">
          <h2>Waiting on you</h2>
          <div class="tiles">
            <a
              class="tile act"
              routerLink="/matrimony/interests"
              [queryParams]="{ tab: 'received' }"
            >
              <span class="n">{{ s.interests.received }}</span>
              <span class="t">Interested in you</span>
              <span class="s">Proposals you have not answered</span>
            </a>

            <a class="tile act" routerLink="/matrimony/chat">
              <span class="n">{{ s.chat.unread }}</span>
              <span class="t">Unread messages</span>
              <span class="s">
                across {{ s.chat.threads }}
                {{ s.chat.threads === 1 ? 'conversation' : 'conversations' }}
              </span>
            </a>
          </div>
        </section>

        <section class="band">
          <h2>Your activity</h2>
          <div class="tiles">
            <a
              class="tile"
              routerLink="/matrimony/interests"
              [queryParams]="{ tab: 'accepted' }"
            >
              <span class="n">{{ s.interests.accepted }}</span>
              <span class="t">Matches</span>
              <span class="s">Interest accepted both ways</span>
            </a>

            <a
              class="tile"
              routerLink="/matrimony/interests"
              [queryParams]="{ tab: 'sent' }"
            >
              <span class="n">{{ s.interests.awaitingReply }}</span>
              <span class="t">Awaiting reply</span>
              <span class="s">Sent, not yet answered</span>
            </a>

            <a class="tile" routerLink="/matrimony/shortlist">
              <span class="n">{{ s.shortlist.saved }}</span>
              <span class="t">Shortlisted</span>
              <span class="s">Profiles you saved</span>
            </a>

            <!--
              Not a link, and deliberately so: this is the one number here with
              no list behind it. A shortlist is private to whoever made it, so
              the count is encouragement without being a disclosure.
            -->
            <div class="tile flat">
              <span class="n">{{ s.shortlist.savedBy }}</span>
              <span class="t">Saved you</span>
              <span class="s">Members who shortlisted you</span>
            </div>
          </div>
        </section>

        <div class="split">
          <!--
            The plan in the terms it is actually spent: days, and today's
            interests. Both are things that run out, and neither is legible on
            any other screen.
          -->
          <section class="card plan">
            <h2>Your plan</h2>
            <p class="pname">
              {{ s.plan.name }}
              @if (!s.plan.isPaid) { <span class="chip">Free</span> }
            </p>

            @if (s.plan.daysLeft !== null) {
              <p class="days" [class.urgent]="s.plan.daysLeft <= 14">
                @if (s.plan.daysLeft > 0) {
                  <strong>{{ s.plan.daysLeft }}</strong>
                  {{ s.plan.daysLeft === 1 ? 'day' : 'days' }} left
                } @else {
                  <strong>Lapsed.</strong> Renew to keep contact details visible.
                }
              </p>
            }

            <div class="quota">
              <span class="qlabel">
                <span>Interests today</span>
                <b>
                  {{ s.interests.sentToday }}
                  @if (s.interests.dailyLimit !== null) {
                    / {{ s.interests.dailyLimit }}
                  } @else {
                    / unlimited
                  }
                </b>
              </span>
              @if (s.interests.dailyLimit !== null) {
                <span class="bar">
                  <span class="fill" [style.width.%]="quotaPct()"></span>
                </span>
              }
            </div>

            <a mat-stroked-button routerLink="/matrimony/plans">
              {{ s.plan.isPaid ? 'Manage plan' : 'See plans' }}
            </a>
          </section>

          <section class="card steps">
            <h2>Next steps</h2>
            @for (step of nextSteps(); track step.action) {
              <a
                class="step"
                [class.urgent]="step.urgent"
                [routerLink]="step.link"
                [queryParams]="step.query ?? {}"
              >
                <span class="stext">{{ step.text }}</span>
                <span class="sgo">{{ step.action }}</span>
              </a>
            } @empty {
              <p class="clear">Nothing needs you right now. Go and browse.</p>
            }
          </section>
        </div>
      }

      @if (summary.error()) {
        <p class="err" role="alert">
          Your dashboard could not be loaded. Refresh to try again.
        </p>
      }
    </main>
  `,
  styles: `
    .wrap { max-width: 1120px; margin: 0 auto; padding: 1.25rem 1rem 3rem;
            display: flex; flex-direction: column; gap: 1.5rem; }

    /* ------------------------------------------------------------------ hero */

    .hero { display: flex; align-items: center; justify-content: space-between;
            gap: 1.25rem; flex-wrap: wrap;
            padding: 1.1rem 1.25rem; border-radius: 14px;
            background: linear-gradient(120deg, var(--brand-deep), var(--brand-light));
            color: #fff;
            box-shadow: 0 6px 20px rgb(var(--brand-deep-rgb) / 0.25); }

    .who { display: flex; align-items: center; gap: 1rem; min-width: 0; }

    .portrait { width: 64px; height: 64px; flex: none; border-radius: 50%;
                overflow: hidden; display: grid; place-items: center;
                background: rgb(255 255 255 / 0.18);
                border: 2px solid var(--gold); }
    .portrait img { width: 100%; height: 100%; object-fit: cover; }
    .initials { font-size: 1.3rem; font-weight: 700; letter-spacing: 0.04em; }

    .ident { min-width: 0; }
    .ident h1 { margin: 0; font-size: 1.45rem; line-height: 1.2; }
    .id { margin: 0.35rem 0 0; display: flex; align-items: center; gap: 0.5rem;
          flex-wrap: wrap; font-size: 0.85rem; color: rgb(255 255 255 / 0.85); }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            letter-spacing: 0.06em; font-size: 0.88rem; color: #fff; }

    .chip { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.72rem;
            font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
            background: rgb(255 255 255 / 0.18);
            border: 1px solid rgb(255 255 255 / 0.3); }
    .chip.live { background: var(--gold); color: #3a2606; border-color: transparent; }
    .chip.ok { background: #1b5e20; border-color: transparent; }

    .meter { display: flex; align-items: center; gap: 0.85rem; }
    .edit { color: #fff !important; border-color: rgb(255 255 255 / 0.5) !important; }

    /*
     * The completeness ring is a conic gradient over a masked disc rather than
     * an SVG: one element, no viewBox to keep in step with the font size, and
     * --pct is the only thing that ever changes.
     */
    .ring { --pct: 0; position: relative; width: 62px; height: 62px; flex: none;
            border-radius: 50%; display: grid; place-items: center;
            background: conic-gradient(var(--gold) calc(var(--pct) * 1%),
                                       rgb(255 255 255 / 0.22) 0); }
    .ring::before { content: ''; position: absolute; width: 48px; height: 48px;
                    border-radius: 50%; background: var(--brand-deep); }
    .ring b { position: relative; font-size: 1rem; }
    .ring i { font-style: normal; font-size: 0.7rem; opacity: 0.8; }

    /* ----------------------------------------------------------------- tiles */

    .band h2, .card h2 { margin: 0 0 0.7rem; font-size: 0.8rem; font-weight: 700;
                         text-transform: uppercase; letter-spacing: 0.09em;
                         color: var(--brand-ink); }

    .tiles { display: grid; gap: 0.85rem;
             grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }

    .tile { display: flex; flex-direction: column; gap: 0.1rem;
            padding: 1rem 1.1rem; border-radius: 12px; text-decoration: none;
            background: #fff; border: 1px solid var(--brand-line);
            color: inherit;
            transition: transform 120ms ease, box-shadow 120ms ease; }
    a.tile:hover { transform: translateY(-2px);
                   box-shadow: 0 6px 16px rgb(var(--brand-rgb) / 0.14);
                   border-color: var(--brand); }

    /* The two that are somebody else's move carry the brand tint; the rest do
       not, so there is exactly one place on the page the eye is pulled to. */
    .tile.act { background: var(--brand-tint); }
    .tile.act .n { color: var(--brand); }
    .tile.flat { opacity: 0.92; }

    .n { font-size: 2rem; font-weight: 700; line-height: 1.1;
         color: var(--brand-ink); font-variant-numeric: tabular-nums; }
    .t { font-size: 0.95rem; font-weight: 600; }
    .s { font-size: 0.8rem; color: rgb(0 0 0 / 0.55); }

    /* ------------------------------------------------------------ plan, steps */

    .split { display: grid; gap: 1rem;
             grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); }

    .card { padding: 1.1rem 1.25rem; border-radius: 12px; background: #fff;
            border: 1px solid var(--brand-line); }

    .pname { margin: 0 0 0.3rem; font-size: 1.15rem; font-weight: 600;
             display: flex; align-items: center; gap: 0.5rem; }
    .pname .chip { background: var(--brand-tint); color: var(--brand-ink);
                   border-color: var(--brand-line); }

    .days { margin: 0 0 0.9rem; font-size: 0.9rem; color: rgb(0 0 0 / 0.65); }
    .days strong { font-size: 1.1rem; color: var(--brand-ink); }
    .days.urgent, .days.urgent strong { color: #a35400; }

    .quota { margin-bottom: 1rem; }
    .qlabel { display: flex; justify-content: space-between; font-size: 0.85rem;
              color: rgb(0 0 0 / 0.6); margin-bottom: 0.35rem; }
    .qlabel b { color: var(--brand-ink); font-variant-numeric: tabular-nums; }
    .bar { display: block; height: 6px; border-radius: 999px;
           background: var(--brand-line); overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--brand);
            border-radius: 999px; }

    .step { display: flex; align-items: center; justify-content: space-between;
            gap: 0.75rem; padding: 0.65rem 0; text-decoration: none;
            color: inherit; border-bottom: 1px solid var(--brand-line);
            font-size: 0.9rem; }
    .step:last-of-type { border-bottom: none; }
    .step.urgent .stext { font-weight: 600; color: var(--brand-ink); }
    .sgo { flex: none; font-size: 0.82rem; font-weight: 600; color: var(--brand); }
    .step:hover .sgo { text-decoration: underline; }
    .clear { margin: 0; font-size: 0.9rem; color: rgb(0 0 0 / 0.55); }

    .err { margin: 0; padding: 0.8rem 1rem; border-radius: 8px;
           background: #fdecea; color: #7f1d1d; font-size: 0.9rem; }

    @media (max-width: 640px) {
      .hero { flex-direction: column; align-items: flex-start; }
      .n { font-size: 1.7rem; }
    }
  `,
})
export class MatrimonyDashboardPage {
  private readonly api = inject(MatrimonyApi);

  protected readonly summary = httpResource<MatrimonyDashboardDto>(
    () => this.api.dashboardUrl,
    { parse: unwrap<MatrimonyDashboardDto> },
  );

  protected readonly initials = computed(() => {
    const name = this.summary.value()?.profile?.displayName ?? '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    return (parts[0][0] + (parts.at(-1)?.[0] ?? '')).toUpperCase();
  });

  /** Capped: an unlimited plan never gets here, and a granted one can overshoot. */
  protected readonly quotaPct = computed(() => {
    const i = this.summary.value()?.interests;
    if (!i || i.dailyLimit === null || i.dailyLimit === 0) return 0;
    return Math.min(100, Math.round((i.sentToday / i.dailyLimit) * 100));
  });

  /**
   * What to do next, in the order it matters.
   *
   * Derived here rather than sent by the server, because every one of these is
   * a judgement about this UI - which screen to send somebody to, and what to
   * call the link - and none of it is a fact the API owns. Capped at four: a
   * list of nine next steps is not a list of next steps.
   */
  protected readonly nextSteps = computed<NextStep[]>(() => {
    const s = this.summary.value();
    if (!s) return [];

    if (!s.profile) {
      return [
        {
          text: 'Create your profile to start searching',
          action: 'Create',
          link: '/matrimony/profile/edit',
          urgent: true,
        },
      ];
    }

    const steps: NextStep[] = [];

    if (s.interests.received > 0) {
      const plural = s.interests.received === 1 ? 'person is' : 'people are';
      steps.push({
        text: `${s.interests.received} ${plural} waiting for your reply`,
        action: 'Review',
        link: '/matrimony/interests',
        query: { tab: 'received' },
        urgent: true,
      });
    }

    if (s.chat.unread > 0) {
      steps.push({
        text: `${s.chat.unread} unread ${s.chat.unread === 1 ? 'message' : 'messages'}`,
        action: 'Open chat',
        link: '/matrimony/chat',
        urgent: true,
      });
    }

    if (s.profile.status === 'DRAFT') {
      steps.push({
        text: 'Your profile is not live yet — 60% completes it',
        action: 'Finish',
        link: '/matrimony/profile/edit',
        urgent: true,
      });
    } else if (s.profile.completeness < 90) {
      steps.push({
        text: `Your profile is ${s.profile.completeness}% complete — fuller profiles appear in more searches`,
        action: 'Add more',
        link: '/matrimony/profile/edit',
        urgent: false,
      });
    }

    if (!s.profile.photoUrl) {
      steps.push({
        text: 'Add a photo — profiles with one get far more interest',
        action: 'Upload',
        link: '/matrimony/profile/edit',
        urgent: false,
      });
    }

    if (s.plan.daysLeft !== null && s.plan.daysLeft <= 14) {
      const d = s.plan.daysLeft;
      steps.push({
        text:
          d > 0
            ? `Your plan ends in ${d} ${d === 1 ? 'day' : 'days'}`
            : 'Your plan has lapsed',
        action: 'Renew',
        link: '/matrimony/plans',
        urgent: d <= 0,
      });
    }

    if (s.shortlist.saved === 0 && s.interests.awaitingReply === 0) {
      steps.push({
        text: 'Shortlist a few profiles to compare them side by side',
        action: 'Search',
        link: '/matrimony/search',
        urgent: false,
      });
    }

    return steps.slice(0, 4);
  });

  protected statusWord(status: string): string {
    return (
      { DRAFT: 'Draft', ACTIVE: 'Live', HIDDEN: 'Hidden', ENGAGED: 'Engaged' }[
        status
      ] ?? status
    );
  }
}
