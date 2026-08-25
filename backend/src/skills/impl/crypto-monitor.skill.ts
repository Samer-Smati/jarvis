import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioEntity } from '../entities/portfolio.entity';
import { PriceHistoryEntity } from '../entities/price-history.entity';
import { EmailSkill } from './email.skill';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const ALERT_DROP_THRESHOLD = 0.05;
const FETCH_TIMEOUT_MS = 15_000;

interface CoinGeckoPriceResponse {
  [coinId: string]: { usd?: number };
}

@Injectable()
export class CryptoMonitorSkill implements Skill {
  readonly name = 'crypto_monitor';
  readonly description =
    'Track crypto portfolio holdings in Postgres, compare daily total value, and email alerts when value drops more than 5% in 24 hours.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'remove', 'check'],
        description: 'add/list/remove holdings, or check portfolio now',
      },
      coin_id: { type: 'string', description: 'CoinGecko id, e.g. bitcoin (for add)' },
      symbol: { type: 'string', description: 'Ticker symbol, e.g. BTC (for add)' },
      amount: { type: 'number', description: 'Quantity held (for add)' },
      id: { type: 'string', description: 'Holding row id (for remove)' },
    },
    required: ['action'],
  };

  private readonly logger = new Logger(CryptoMonitorSkill.name);

  constructor(
    @InjectRepository(PortfolioEntity)
    private readonly holdings: Repository<PortfolioEntity>,
    @InjectRepository(PriceHistoryEntity)
    private readonly history: Repository<PriceHistoryEntity>,
    private readonly email: EmailSkill,
    private readonly config: ConfigService,
  ) {}

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? '');
    switch (action) {
      case 'add':
        return this.addHolding(
          String(args?.coin_id ?? ''),
          String(args?.symbol ?? ''),
          Number(args?.amount),
        );
      case 'list':
        return this.listHoldings();
      case 'remove':
        return this.removeHolding(String(args?.id ?? ''));
      case 'check':
        return this.checkPortfolio(true);
      default:
        return {
          success: false,
          output: `Unknown action "${action}". Use add, list, remove, or check.`,
        };
    }
  }

  /** Desktop scheduler entry point — no-op when there are no holdings. */
  async runDailyCheck(): Promise<void> {
    const result = await this.checkPortfolio(false);
    if (!result.success) {
      this.logger.warn(`Daily crypto check: ${result.output}`);
      return;
    }
    this.logger.log(`Daily crypto check: ${result.output}`);
  }

  private async addHolding(coinId: string, symbol: string, amount: number): Promise<SkillResult> {
    if (!coinId?.trim() || !symbol?.trim()) {
      return { success: false, output: 'coin_id and symbol are required for add.' };
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, output: 'amount must be a positive number.' };
    }
    const normalizedId = coinId.trim().toLowerCase();
    const existing = await this.holdings.findOne({ where: { coinId: normalizedId } });
    if (existing) {
      existing.amount = amount;
      existing.symbol = symbol.trim().toUpperCase();
      await this.holdings.save(existing);
      return {
        success: true,
        output: `Updated ${existing.symbol}: ${amount} (${normalizedId}).`,
      };
    }
    const row = await this.holdings.save(
      this.holdings.create({
        coinId: normalizedId,
        symbol: symbol.trim().toUpperCase(),
        amount,
      }),
    );
    return {
      success: true,
      output: `Added ${row.symbol}: ${row.amount} (${row.coinId}, id ${row.id}).`,
    };
  }

  private async listHoldings(): Promise<SkillResult> {
    const rows = await this.holdings.find({ order: { symbol: 'ASC' } });
    if (!rows.length) {
      return {
        success: true,
        output: 'No crypto holdings configured. Use crypto_monitor action add with coin_id, symbol, and amount.',
      };
    }
    const lines = rows.map(
      (r) => `- [${r.id}] ${r.symbol}: ${r.amount} (${r.coinId})`,
    );
    return { success: true, output: lines.join('\n') };
  }

  private async removeHolding(id: string): Promise<SkillResult> {
    if (!id?.trim()) {
      return { success: false, output: 'id is required for remove.' };
    }
    const result = await this.holdings.delete({ id: id.trim() });
    return result.affected
      ? { success: true, output: `Removed holding ${id}.` }
      : { success: false, output: `No holding found with id ${id}.` };
  }

  private async checkPortfolio(userFacing: boolean): Promise<SkillResult> {
    const rows = await this.holdings.find();
    if (!rows.length) {
      const msg = 'No crypto holdings configured — add holdings before monitoring.';
      return { success: true, output: msg };
    }

    const prices = await this.fetchPrices(rows.map((r) => r.coinId));
    let total = 0;
    const breakdown: string[] = [];
    for (const row of rows) {
      const price = prices[row.coinId]?.usd ?? 0;
      if (price <= 0) {
        return {
          success: false,
          output: `Could not fetch USD price for ${row.coinId} (${row.symbol}).`,
        };
      }
      const value = price * row.amount;
      total += value;
      breakdown.push(`${row.symbol}: $${value.toFixed(2)}`);
    }

    const today = utcDateString(new Date());
    const previous = await this.findPreviousSnapshot(today);
    await this.upsertSnapshot(today, total);

    if (!previous) {
      const msg = `Portfolio value recorded: $${total.toFixed(2)} (${today}). No prior snapshot — alert baseline set.`;
      return { success: true, output: msg };
    }

    const change = (total - previous.totalValueUsd) / previous.totalValueUsd;
    const changePct = (change * 100).toFixed(2);
    const summary =
      `Portfolio $${total.toFixed(2)} (${changePct}% vs ${previous.snapshotDate}). ` +
      breakdown.join('; ');

    if (change <= -ALERT_DROP_THRESHOLD) {
      const alertBody =
        `JARVIS crypto alert\n\n` +
        `Portfolio dropped ${Math.abs(Number(changePct))}% since ${previous.snapshotDate}.\n` +
        `Previous: $${previous.totalValueUsd.toFixed(2)}\n` +
        `Current: $${total.toFixed(2)}\n\n` +
        breakdown.join('\n');
      const emailResult = await this.sendAlert(alertBody, userFacing);
      return {
        success: true,
        output: `${summary} Alert: ${emailResult}`,
      };
    }

    return { success: true, output: summary };
  }

  private async sendAlert(body: string, userFacing: boolean): Promise<string> {
    const to =
      this.config.get<string>('CRYPTO_ALERT_EMAIL')?.trim() ??
      this.config.get<string>('SMTP_USER')?.trim();
    if (!to) {
      return userFacing
        ? 'drop exceeded 5% but CRYPTO_ALERT_EMAIL/SMTP_USER is not set — configure SMTP to receive alerts.'
        : 'alert skipped (no CRYPTO_ALERT_EMAIL or SMTP_USER)';
    }
    const result = await this.email.execute(
      {
        to,
        subject: 'JARVIS crypto portfolio alert (>5% daily drop)',
        body,
      },
      { conversationId: 'crypto-monitor' },
    );
    return result.output;
  }

  private async fetchPrices(coinIds: string[]): Promise<CoinGeckoPriceResponse> {
    const ids = [...new Set(coinIds.filter(Boolean))].join(',');
    const url = `${COINGECKO_PRICE_URL}?ids=${encodeURIComponent(ids)}&vs_currencies=usd`;
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status}`);
    }
    return (await response.json()) as CoinGeckoPriceResponse;
  }

  private async findPreviousSnapshot(today: string): Promise<PriceHistoryEntity | null> {
    const rows = await this.history.find({
      where: {},
      order: { snapshotDate: 'DESC' },
      take: 5,
    });
    return rows.find((r) => r.snapshotDate < today) ?? null;
  }

  private async upsertSnapshot(snapshotDate: string, totalValueUsd: number): Promise<void> {
    const existing = await this.history.findOne({ where: { snapshotDate } });
    if (existing) {
      existing.totalValueUsd = totalValueUsd;
      await this.history.save(existing);
      return;
    }
    await this.history.save(this.history.create({ snapshotDate, totalValueUsd }));
  }
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
