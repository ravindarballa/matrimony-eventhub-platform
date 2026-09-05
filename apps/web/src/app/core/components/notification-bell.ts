import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { NotificationDto } from '@eventhub/contracts';

interface Envelope<T> {
  data: T;
}

/**
 * The bell, shared by every shell.
 *
 * The unread count is polled rather than pushed: a websocket for a number that
 * changes a few times a day is a connection to keep alive, reconnect and
 * authorise for no gain. The panel itself is only fetched when opened.
 */
@Component({
  selector: 'eh-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <button
        class="bell"
        type="button"
        [attr.aria-label]="label()"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        🔔
        @if (unread() > 0) {
          <span class="dot">{{ unread() > 9 ? '9+' : unread() }}</span>
        }
      </button>

      @if (open()) {
        <div class="panel" role="dialog" aria-label="Notifications">
          <header>
            <strong>Notifications</strong>
            @if (unread() > 0) {
              <button type="button" class="link" (click)="markAllRead()">
                Mark all read
              </button>
            }
          </header>

          @for (item of items.value(); track item.id) {
            <button
              type="button"
              class="item"
              [class.unread]="!item.read"
              (click)="openItem(item)"
            >
              <span class="title">{{ item.title }}</span>
              <span class="body">{{ item.body }}</span>
              <span class="when">{{ ago(item.createdAt) }}</span>
            </button>
          } @empty {
            <p class="empty">Nothing yet.</p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    .bell { position: relative; border: none; background: none; cursor: pointer;
            font-size: 1.15rem; line-height: 1; padding: 0.35rem; color: inherit; }
    .dot { position: absolute; top: 0; right: 0; background: #b3261e; color: #fff;
           font-size: 0.6rem; font-weight: 700; border-radius: 999px;
           padding: 0.05rem 0.28rem; line-height: 1.4; }
    .panel { position: absolute; right: 0; top: 2.4rem; width: min(22rem, 90vw);
             background: #fff; color: rgb(0 0 0 / 0.87); border-radius: 10px;
             box-shadow: 0 8px 28px rgb(0 0 0 / 0.22); overflow: hidden; z-index: 30;
             max-height: 26rem; overflow-y: auto; }
    header { display: flex; justify-content: space-between; align-items: center;
             padding: 0.7rem 0.9rem; border-bottom: 1px solid rgb(0 0 0 / 0.08);
             font-size: 0.85rem; position: sticky; top: 0; background: #fff; }
    .link { border: none; background: none; color: #2f2d78; cursor: pointer;
            font-size: 0.78rem; padding: 0; }
    .item { display: flex; flex-direction: column; gap: 0.15rem; width: 100%;
            text-align: left; border: none; background: none; cursor: pointer;
            padding: 0.65rem 0.9rem; border-bottom: 1px solid rgb(0 0 0 / 0.06);
            font: inherit; }
    .item:hover { background: #f7f7fb; }
    .item.unread { background: #f2f1fb; }
    .item.unread .title { font-weight: 700; }
    .title { font-size: 0.86rem; }
    .body { font-size: 0.8rem; color: rgb(0 0 0 / 0.65); }
    .when { font-size: 0.7rem; color: rgb(0 0 0 / 0.45); }
    .empty { margin: 0; padding: 1.5rem 0.9rem; text-align: center;
             font-size: 0.85rem; color: rgb(0 0 0 / 0.5); }
  `,
})
export class NotificationBell {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly base = '/api/v1/notifications';

  protected readonly open = signal(false);
  protected readonly unread = signal(0);

  /** Fetched only while the panel is open, so a closed bell costs one count. */
  protected readonly items = httpResource<NotificationDto[]>(
    () => (this.open() ? this.base : undefined),
    {
      parse: (raw) => (raw as Envelope<NotificationDto[]>).data,
      defaultValue: [],
    },
  );

  constructor() {
    void this.refreshCount();
    // A number that changes a few times a day does not need a socket.
    setInterval(() => void this.refreshCount(), 60_000);
  }

  protected label(): string {
    const count = this.unread();
    return count ? `Notifications, ${count} unread` : 'Notifications';
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open()) this.items.reload();
  }

  protected async openItem(item: NotificationDto): Promise<void> {
    if (!item.read) {
      await firstValueFrom(this.http.post(`${this.base}/${item.id}/read`, {}));
      await this.refreshCount();
      this.items.reload();
    }
    if (item.link) {
      this.open.set(false);
      await this.router.navigateByUrl(item.link);
    }
  }

  protected async markAllRead(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.base}/read-all`, {}));
    await this.refreshCount();
    this.items.reload();
  }

  private async refreshCount(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<Envelope<{ count: number }>>(`${this.base}/unread-count`),
      );
      this.unread.set(res.data.count);
    } catch {
      // A signed-out or offline client simply shows no badge.
      this.unread.set(0);
    }
  }

  protected ago(iso: string): string {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }
}
