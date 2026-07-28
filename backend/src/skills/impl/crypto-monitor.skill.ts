/**
 * Crypto Portfolio Monitor Skill
 * Tracks daily portfolio value changes and alerts if drop exceeds threshold.
 */

import axios from 'axios';

interface CryptoAlert {
  type: 'crypto_alert';
  message: string;
  change_percent: number;
  asset: string;
}

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const ALERT_THRESHOLD = 0.05; // 5%

interface PortfolioAsset {
  id: string;       // CoinGecko ID (e.g., 'bitcoin', 'ethereum')
  symbol: string;   // Trading symbol (e.g., 'BTC', 'ETH')
  amount: number;   // Quantity held
}

/**
 * Your crypto portfolio configuration
 * Update this array with your actual holdings
 */
const PORTFOLIO: PortfolioAsset[] = [
  // TODO: Add your assets here
  // Example:
  // { id: 'bitcoin', symbol: 'BTC', amount: 0.5 },
  // { id: 'ethereum', symbol: 'ETH', amount: 2.0 },
  // { id: 'cardano', symbol: 'ADA', amount: 1000 },
];

/**
 * Store previous day's total portfolio value for comparison
 */
const VALUE_STORE_KEY = 'crypto_portfolio_previous_value';

/**
 * Get current portfolio total value in USD
 */
async function getPortfolioValue(): Promise<number> {
  if (PORTFOLIO.length === 0) {
    return 0;
  }

  const ids = PORTFOLIO.map(a => a.id).join(',');
  const response = await axios.get(COINGECKO_API, {
    params: {
      ids,
      vs_currency: 'usd',
    },
    headers: {
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  let total = 0;
  for (const asset of PORTFOLIO) {
    const price = response.data[asset.id]?.usd || 0;
    total += price * asset.amount;
  }
  return total;
}

/**
 * Store value in local storage for persistence
 */
function storePreviousValue(value: number): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(VALUE_STORE_KEY, JSON.stringify({ value, timestamp: Date.now() }));
  }
}

/**
 * Retrieve previous day's stored value
 */
function getPreviousValue(): number | null {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(VALUE_STORE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (data.timestamp > oneDayAgo) {
        return data.value;
      }
    }
  }
  return null;
}

/**
 * Main skill function to check portfolio performance
 */
export async function checkPortfolio(): Promise<CryptoAlert | null> {
  const currentValue = await getPortfolioValue();
  const previousValue = getPreviousValue();

  if (previousValue === null || currentValue === 0) {
    storePreviousValue(currentValue);
    return null;
  }

  const changePercent = (currentValue - previousValue) / previousValue;
  storePreviousValue(currentValue);

  if (Math.abs(changePercent) >= ALERT_THRESHOLD) {
    return {
      type: 'crypto_alert',
      message: changePercent < 0
        ? `🚨 ALERT: Portfolio dropped ${Math.abs(changePercent * 100).toFixed(2)}% today`
        : `📈 NOTICE: Portfolio gained ${changePercent * 100}% today`,
      change_percent: changePercent,
      asset: 'Portfolio',
    };
  }

  return null;
}

/**
 * Scheduled job handler
 * Runs daily to check portfolio performance
 */
export async function dailyPortfolioCheck(): Promise<void> {
  const alert = await checkPortfolio();
  if (alert) {
    console.log(`[Crypto Monitor] ${alert.message}`);
    // This would trigger your notification system
  }
}