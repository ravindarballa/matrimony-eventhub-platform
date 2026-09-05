import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type { ChatMessageDto, ChatThreadDto } from '@eventhub/contracts';

import { MatrimonyApi, unwrap } from '../data/matrimony-api';
import type { AppError } from '../../../core/models/app-error';

/**
 * Conversations.
 *
 * Threads exist only because both families accepted an interest, so this is
 * never a cold inbox. Reading is free for both sides; sending is what a plan
 * pays for, and a free member is told that at the moment they try rather than
 * before they have anything to say.
 *
 * Delivery is polled rather than pushed. A five-second poll on an open thread
 * is honest about what it is, and a websocket for a conversation that moves at
 * the speed of two families deciding things would be machinery without a
 * matching benefit. That changes when read receipts need to be live.
 */
@Component({
  selector: 'eh-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  template: `
    <main class="wrap">
      <header>
        <h1>Conversations</h1>
        <p class="sub">
          Opened when both sides accept an interest. Reading is always free.
        </p>
      </header>

      @if (threads.isLoading()) { <mat-progress-bar mode="indeterminate" /> }
      @if (message(); as m) { <p class="notice" role="alert">{{ m }}</p> }

      <div class="split">
        <aside class="list">
          @for (thread of threads.value(); track thread.id) {
            <button
              type="button"
              class="thread"
              [class.on]="openId() === thread.id"
              (click)="open(thread)"
            >
              <span class="who">
                {{ thread.counterpart.displayName }}
                @if (thread.unreadCount > 0) {
                  <span class="badge">{{ thread.unreadCount }}</span>
                }
              </span>
              <span class="preview">
                {{ thread.lastMessagePreview ?? 'Say hello' }}
              </span>
            </button>
          } @empty {
            @if (!threads.isLoading()) {
              <p class="empty">
                No conversations yet. Accept an interest and one opens here.
              </p>
            }
          }
        </aside>

        <section class="panel">
          @if (!openId()) {
            <p class="empty">Pick a conversation.</p>
          } @else {
            <div class="messages">
              @for (m of messages(); track m.id) {
                <div class="bubble" [class.mine]="m.mine">
                  <span class="body">{{ m.body }}</span>
                  <span class="at">{{ time(m.sentAt) }}</span>
                </div>
              } @empty {
                <p class="empty">Nothing said yet.</p>
              }
            </div>

            <form class="composer" (submit)="$event.preventDefault(); send()">
              <input
                type="text"
                [value]="draft()"
                (input)="draft.set($any($event.target).value)"
                placeholder="Write a message"
                maxlength="2000"
                [disabled]="sending()"
              />
              <button mat-flat-button type="submit" [disabled]="sending() || !draft().trim()">
                Send
              </button>
            </form>

            @if (locked()) {
              <p class="locked">
                Sending messages is part of a paid plan — reading stays free.
                <a routerLink="/matrimony/plans">See plans</a>
              </p>
            }
          }
        </section>
      </div>
    </main>
  `,
  styles: `
    .wrap { max-width: 56rem; margin: 2rem auto 4rem; padding: 0 1.25rem;
            display: flex; flex-direction: column; gap: 1rem; }
    h1 { margin: 0; font-size: 1.6rem; font-weight: 600; }
    .sub { margin: 0.25rem 0 0; color: rgb(0 0 0 / 0.6); font-size: 0.9rem; }
    .split { display: grid; grid-template-columns: 16rem 1fr; gap: 1rem;
             align-items: start; }
    @media (max-width: 720px) { .split { grid-template-columns: 1fr; } }
    .list { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
            overflow: hidden; display: flex; flex-direction: column; }
    .thread { text-align: left; border: none; background: none; font: inherit;
              cursor: pointer; padding: 0.75rem 0.9rem;
              border-bottom: 1px solid rgb(0 0 0 / 0.07);
              display: flex; flex-direction: column; gap: 0.15rem; }
    .thread:hover { background: #f7f7fb; }
    .thread.on { background: #eef1fb; }
    .who { font-size: 0.92rem; font-weight: 600; display: flex; gap: 0.4rem;
           align-items: center; }
    .badge { font-size: 0.65rem; font-weight: 700; background: #b3261e; color: #fff;
             border-radius: 999px; padding: 0.05rem 0.35rem; }
    .preview { font-size: 0.78rem; color: rgb(0 0 0 / 0.55);
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel { background: #fff; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 10px;
             min-height: 22rem; display: flex; flex-direction: column; }
    .messages { flex: 1; padding: 1rem; display: flex; flex-direction: column;
                gap: 0.5rem; overflow-y: auto; max-height: 26rem; }
    .bubble { max-width: 75%; padding: 0.5rem 0.7rem; border-radius: 10px;
              background: #f1f1f4; display: flex; flex-direction: column; gap: 0.15rem; }
    .bubble.mine { align-self: flex-end; background: #e6f4ea; }
    .body { font-size: 0.9rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    .at { font-size: 0.65rem; color: rgb(0 0 0 / 0.45); align-self: flex-end; }
    .composer { display: flex; gap: 0.5rem; padding: 0.75rem;
                border-top: 1px solid rgb(0 0 0 / 0.08); }
    .composer input { flex: 1; font: inherit; font-size: 0.9rem; padding: 0.5rem 0.6rem;
                      border: 1px solid rgb(0 0 0 / 0.25); border-radius: 6px; }
    .locked { margin: 0; padding: 0 0.75rem 0.75rem; font-size: 0.82rem; color: #8a5a00; }
    .empty { margin: auto; padding: 2rem 1rem; text-align: center;
             color: rgb(0 0 0 / 0.5); font-size: 0.88rem; }
    .notice { margin: 0; font-size: 0.88rem; color: #b3261e; }
  `,
})
export class ChatPage implements OnDestroy {
  private readonly api = inject(MatrimonyApi);
  private readonly http = inject(HttpClient);

  protected readonly openId = signal<string | null>(null);
  protected readonly messages = signal<ChatMessageDto[]>([]);
  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly locked = signal(false);
  protected readonly message = signal<string | null>(null);

  protected readonly threads = httpResource<ChatThreadDto[]>(
    () => `${this.api.base}/chat`,
    { parse: unwrap<ChatThreadDto[]>, defaultValue: [] },
  );

  /** Polls the open thread. Cleared on destroy so it cannot outlive the page. */
  private timer?: ReturnType<typeof setInterval>;

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected async open(thread: ChatThreadDto): Promise<void> {
    this.openId.set(thread.id);
    this.locked.set(false);
    this.message.set(null);
    await this.refresh();

    clearInterval(this.timer);
    this.timer = setInterval(() => void this.refresh(), 5000);
  }

  private async refresh(): Promise<void> {
    const id = this.openId();
    if (!id) return;
    try {
      const res = await firstValueFrom(
        this.http.get<{ data: ChatMessageDto[] }>(`${this.api.base}/chat/${id}`),
      );
      this.messages.set(res.data);
      // Opening marks messages read, so the badge in the list is now stale.
      this.threads.reload();
    } catch {
      // A dropped poll is not worth interrupting a conversation over.
    }
  }

  protected async send(): Promise<void> {
    const id = this.openId();
    const body = this.draft().trim();
    if (!id || !body) return;

    this.sending.set(true);
    this.message.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<{ data: ChatMessageDto }>(`${this.api.base}/chat/${id}`, {
          body,
        }),
      );
      this.messages.update((all) => [...all, res.data]);
      this.draft.set('');
      this.threads.reload();
    } catch (e) {
      const err = e as AppError;
      if (err.code === 'MAT_QUOTA_EXCEEDED') {
        this.locked.set(true);
      } else {
        this.message.set(err.message);
      }
    } finally {
      this.sending.set(false);
    }
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}
