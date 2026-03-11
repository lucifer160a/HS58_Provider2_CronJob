/**
 * Telegram Bot — API Activity Monitoring
 *
 * Sends notifications to a Telegram chat for all API call activities.
 * Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID when enabled.
 */

import type { ProviderConfig } from './types.js';

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface ActivityPayload {
  operation: string;
  status: 'success' | 'error';
  modelId?: string;
  details?: string;
  cost?: string;
  channelId?: string;
  error?: string;
  /** Requester/client IP address */
  requesterIp?: string;
  /** URL that will be or was visited (single job) */
  visitUrl?: string;
  /** Number of visits or URLs (history entries / job count) */
  visitCount?: number;
  /** Multiple visit URLs (e.g. from list) */
  visitUrls?: string[];
  extra?: Record<string, unknown>;
}

export class TelegramMonitor {
  private config: TelegramConfig | null = null;

  constructor(config: ProviderConfig) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const enabled = process.env.TELEGRAM_ENABLED !== 'false'; // default: enabled if vars set

    if (token && chatId && enabled) {
      this.config = { enabled: true, botToken: token, chatId };
    }
  }

  isEnabled(): boolean {
    return this.config !== null;
  }

  /**
   * Send a notification to Telegram (fire-and-forget, never throws).
   */
  async notify(payload: ActivityPayload): Promise<void> {
    if (!this.config) return;

    const text = this.formatMessage(payload);
    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('[telegram] Send failed:', res.status, err.slice(0, 200));
      }
    } catch (err) {
      console.error('[telegram] Error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Fire-and-forget wrapper: never blocks or throws.
   */
  notifyAsync(payload: ActivityPayload): void {
    this.notify(payload).catch(() => {});
  }

  /**
   * Notify about an HTTP API request (for request-level monitoring).
   */
  notifyRequest(method: string, path: string, statusCode: number, durationMs: number, requesterIp?: string): void {
    const excludeHealth = process.env.TELEGRAM_EXCLUDE_HEALTH !== 'false';
    if (excludeHealth && method === 'GET' && path === '/health') return;

    this.notifyAsync({
      operation: `API ${method} ${path}`,
      status: statusCode >= 200 && statusCode < 400 ? 'success' : 'error',
      requesterIp,
      details: `${statusCode} in ${durationMs}ms`,
      extra: { method, path, statusCode, durationMs },
    });
  }

  private formatMessage(p: ActivityPayload): string {
    const statusEmoji = p.status === 'success' ? '✅' : '❌';
    const lines: string[] = [
      `${statusEmoji} <b>${this.escape(p.operation)}</b>`,
      `Status: ${p.status}`,
    ];

    if (p.modelId) lines.push(`Operation: <code>${this.escape(p.modelId)}</code>`);
    if (p.requesterIp) lines.push(`IP: <code>${this.escape(p.requesterIp)}</code>`);
    if (p.visitUrl) lines.push(`Visit URL: <code>${this.escape(p.visitUrl)}</code>`);
    if (p.visitCount != null) lines.push(`Visits: ${p.visitCount}`);
    if (p.visitUrls && p.visitUrls.length > 0) {
      const urls = p.visitUrls.slice(0, 5).map(u => this.escape(u.length > 60 ? u.slice(0, 60) + '…' : u));
      lines.push(`URLs: ${urls.join(', ')}${p.visitUrls.length > 5 ? ` (+${p.visitUrls.length - 5} more)` : ''}`);
    }
    if (p.details) lines.push(`Details: ${this.escape(p.details)}`);
    if (p.cost) lines.push(`Cost: ${p.cost}`);
    if (p.channelId) lines.push(`Channel: <code>${p.channelId.slice(0, 18)}…</code>`);
    if (p.error) lines.push(`Error: ${this.escape(p.error)}`);

    if (p.extra && Object.keys(p.extra).length > 0) {
      const extra = Object.entries(p.extra)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
      lines.push(`Extra: ${this.escape(extra)}`);
    }

    return lines.join('\n');
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
