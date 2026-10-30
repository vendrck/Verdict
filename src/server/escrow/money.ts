/**
 * Money helpers. PayPal sends amounts as decimal strings ("12.50"); all
 * arithmetic here is done in integer minor units so partial releases never
 * drift by a cent.
 */

/** Currencies PayPal accepts without decimals. */
const ZERO_DECIMAL_CURRENCIES = new Set(["HUF", "JPY", "TWD"]);

export interface Money {
  currency: string;
  /** Integer amount in the currency's minor unit (cents for USD). */
  minor: number;
}

export function decimalsFor(currency: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function parseMoney(value: string, currency: string): Money {
  const code = currency.toUpperCase();
  const decimals = decimalsFor(code);
  const pattern = decimals === 0 ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${code} amount: "${value}"`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const minor = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || "0");
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Amount out of range: "${value}"`);
  }
  return { currency: code, minor };
}

export function formatMoney(money: Money): string {
  const decimals = decimalsFor(money.currency);
  if (decimals === 0) return String(money.minor);
  const whole = Math.trunc(money.minor / 100);
  const cents = String(money.minor % 100).padStart(2, "0");
  return `${whole}.${cents}`;
}

/** PayPal Orders/Payments v2 amount shape. */
export function toPayPalAmount(money: Money): { currency_code: string; value: string } {
  return { currency_code: money.currency, value: formatMoney(money) };
}

export interface ReleaseSplit {
  /** Captured from the authorization and paid out to the freelancer. */
  release: Money;
  /** Never captured; PayPal returns it to the client when final_capture is true. */
  returnedToClient: Money;
}

/**
 * Split a held authorization into the part released to the freelancer and the
 * part returned to the client. Used for full, partial, and zero releases.
 */
export function splitRelease(held: Money, release: Money): ReleaseSplit {
  if (held.currency !== release.currency) {
    throw new Error(`Currency mismatch: held ${held.currency}, release ${release.currency}`);
  }
  if (release.minor < 0 || release.minor > held.minor) {
    throw new Error(`Release ${formatMoney(release)} must be between 0 and the held ${formatMoney(held)}`);
  }
  return {
    release,
    returnedToClient: { currency: held.currency, minor: held.minor - release.minor },
  };
}

/** Release a percentage (0–100) of the held amount, rounding down to the minor unit. */
export function percentOf(held: Money, percent: number): Money {
  if (!(percent >= 0 && percent <= 100)) {
    throw new Error(`Percent must be between 0 and 100, got ${percent}`);
  }
  return { currency: held.currency, minor: Math.floor((held.minor * percent) / 100) };
}
