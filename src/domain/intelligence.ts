// The deterministic analysis layer. It turns payments + usage into facts the agent reasons over:
// cost per hour, a 0-100 value score, issues and a recommended action. The LLM never invents
// these numbers; it reads them through tools and decides what to do about them.

import { UTILITY_CATEGORIES } from './catalog';
import { addDays, currentCurrency, cycleMonths, cycleShort, diffDays, money, round, today } from './dates';
import type { Category, Charge, Currency, Db, Insight, Issue, Portfolio, Recommendation, Subscription, Verdict } from './types';

/** What an hour of use "should" cost for a fairly used subscription, by category (USD). */
/**
 * Subscription price levels differ by market far more than exchange rates suggest (a music plan
 * is about $12 in the US and about ₹119 in India). The benchmarks below are in USD and are scaled
 * by this factor for the user's currency. These are judgement calls, not measured data: they set
 * where "good value" starts, and are the first thing to tune.
 */
const PRICE_LEVEL: Record<Currency, number> = { USD: 1, EUR: 0.95, GBP: 0.8, INR: 20 };

const FAIR_COST_PER_HOUR: Record<Category, number> = {
  Streaming: 1.5,
  Music: 0.5,
  Productivity: 4,
  News: 3,
  Membership: 1,
  Developer: 1,
  Other: 3,
  Gaming: 2,
  AI: 2,
  Telecom: 1,
  Broadband: 1,
  Storage: 1,
  Wellness: 3,
  Learning: 2,
};

export const monthlyCost = (s: Subscription) => s.price / cycleMonths(s.cycle);
const isLive = (s: Subscription) => s.status === 'active' || s.status === 'trial' || s.status === 'past_due';

function scoreOf(costPerHour: number, category: Category, trendPct: number | null, daysSinceLastUse: number | null) {
  const ratio = costPerHour / (FAIR_COST_PER_HOUR[category] * PRICE_LEVEL[currentCurrency()]);
  let score = 100 - 35 * Math.log2(1 + ratio);
  if (trendPct !== null && trendPct <= -50) score -= 15;
  if (daysSinceLastUse !== null && daysSinceLastUse > 30) score -= 25;
  else if (daysSinceLastUse !== null && daysSinceLastUse > 14) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function analyze(data: Db): Portfolio {
  const now = today();
  const from30 = addDays(now, -30);
  const from60 = addDays(now, -60);

  const base = data.subscriptions.map((sub) => {
    const days = data.usage.filter((u) => u.subId === sub.id);
    const recent = days.filter((u) => u.date > from30);
    const prior = days.filter((u) => u.date > from60 && u.date <= from30);
    const hours30 = round(recent.reduce((t, u) => t + u.minutes, 0) / 60, 1);
    const hoursPrev30 = round(prior.reduce((t, u) => t + u.minutes, 0) / 60, 1);
    // A reported day with zero minutes is evidence of no use, not a use.
    const lastUse = days.reduce<string | null>((m, u) => (u.minutes > 0 && (!m || u.date > m) ? u.date : m), null);
    const subCharges = data.charges.filter((c) => c.subId === sub.id).sort((a, b) => a.date.localeCompare(b.date));
    const lastCharge: Charge | undefined = subCharges.at(-1);
    const paid = subCharges.filter((c) => c.status === 'paid');
    const previousPrice = paid.find((c) => c.amount < sub.price)?.amount;

    const weekly: Insight['weekly'] = [];
    for (let w = 11; w >= 0; w--) {
      const weekStart = addDays(now, -(w * 7 + 6));
      const weekEnd = addDays(now, -(w * 7));
      const minutes = days.filter((u) => u.date >= weekStart && u.date <= weekEnd).reduce((t, u) => t + u.minutes, 0);
      weekly.push({ weekStart, hours: round(minutes / 60, 1) });
    }

    return {
      sub,
      hours30,
      hoursPrev30,
      activeDays30: recent.filter((u) => u.minutes > 0).length,
      daysSinceLastUse: lastUse ? diffDays(now, lastUse) : null,
      trendPct: hoursPrev30 > 0 ? Math.round(((hours30 - hoursPrev30) / hoursPrev30) * 100) : null,
      lastCharge,
      previousPrice,
      weekly,
    };
  });

  const insights: Insight[] = base.map((b) => {
    const { sub } = b;
    const cost = monthlyCost(sub);
    const essential = UTILITY_CATEGORIES.includes(sub.category);
    const measured = sub.coverage !== 'none' && !essential;
    const costPerHour = measured && b.hours30 > 0 ? round(cost / b.hours30, 2) : null;
    const daysToRenewal = diffDays(sub.nextRenewal, now);

    let verdict: Verdict;
    let valueScore: number | null;
    if (essential) {
      verdict = 'essential';
      valueScore = null;
    } else if (!measured) {
      verdict = 'unmeasured';
      valueScore = null;
    } else if (b.hours30 === 0) {
      verdict = 'unused';
      valueScore = 0;
    } else {
      valueScore = scoreOf(costPerHour!, sub.category, b.trendPct, b.daysSinceLastUse);
      verdict = valueScore >= 65 ? 'great' : valueScore >= 40 ? 'fair' : 'poor';
    }

    const issues: Issue[] = [];
    const live = isLive(sub);

    if (live && b.lastCharge?.status === 'failed') {
      issues.push({ type: 'payment_failed', severity: 'critical', message: `Last payment of ${money(b.lastCharge.amount)} failed on ${b.lastCharge.date}.` });
    }
    if (live && sub.status === 'trial' && sub.trialEndsAt) {
      const d = diffDays(sub.trialEndsAt, now);
      if (d <= 7) {
        issues.push({
          type: 'trial_ending',
          severity: d <= 3 ? 'critical' : 'warn',
          message: `Free trial converts to ${money(sub.price)}/${cycleShort(sub.cycle)} in ${d} day${d === 1 ? '' : 's'}.`,
        });
      }
    }
    if (live && verdict === 'unused') {
      issues.push({
        type: 'unused',
        severity: 'critical',
        message: b.daysSinceLastUse === null ? 'No recorded use.' : `Not opened in ${b.daysSinceLastUse} days.`,
      });
    }
    if (live && b.trendPct !== null && b.trendPct <= -50 && b.hoursPrev30 >= 5) {
      issues.push({ type: 'declining', severity: 'warn', message: `Usage fell ${Math.abs(b.trendPct)}% (${b.hoursPrev30}h to ${b.hours30}h).` });
    }
    if (live && verdict === 'poor') {
      issues.push({ type: 'low_value', severity: 'warn', message: `${money(costPerHour ?? 0)} per hour of use this month.` });
    }
    if (live && b.previousPrice !== undefined) {
      const pct = Math.round(((sub.price - b.previousPrice) / b.previousPrice) * 100);
      issues.push({ type: 'price_increase', severity: 'warn', message: `Price rose ${pct}% (${money(b.previousPrice)} to ${money(sub.price)}).` });
    }
    if (live && sub.status !== 'trial' && daysToRenewal >= 0 && daysToRenewal <= 7) {
      issues.push({ type: 'renews_soon', severity: 'info', message: `Renews in ${daysToRenewal} day${daysToRenewal === 1 ? '' : 's'} for ${money(sub.price)}.` });
    }

    // Overlap: another live subscription in the same category that is used more.
    const rival = base.find((o) => o.sub.id !== sub.id && isLive(o.sub) && o.sub.category === sub.category && o.hours30 > b.hours30 * 4 && o.hours30 >= 10);
    const duplicate = live && (sub.category === 'Music' || sub.category === 'AI') && rival;
    if (duplicate) {
      issues.push({ type: 'duplicate', severity: 'warn', message: `Overlaps with ${rival.sub.name}, which you use ${rival.hours30}h/month.` });
    }

    const tvCaveat = sub.category === 'Streaming' && sub.coverage !== 'phone+tv';
    const confidence: Recommendation['confidence'] = tvCaveat ? 'medium' : 'high';
    let recommendation: Recommendation = { action: 'keep', reason: 'Used enough to justify its price.', savingsMonthly: 0, confidence: 'high' };

    if (!live) {
      recommendation = { action: 'keep', reason: `Already ${sub.status}.`, savingsMonthly: 0, confidence: 'high' };
    } else if (essential) {
      recommendation = { action: 'keep', reason: 'Essential service. Tracked for price changes and renewal dates, not screen time.', savingsMonthly: 0, confidence: 'high' };
    } else if (!measured) {
      recommendation = { action: 'review', reason: 'No usage signal for this service, so value cannot be measured. Review it yourself.', savingsMonthly: 0, confidence: 'low' };
    } else if (sub.status === 'trial' && b.hours30 < 2) {
      recommendation = {
        action: 'cancel',
        reason: `Trial used for ${b.hours30}h. Cancel before it converts to ${money(sub.price)}.`,
        savingsMonthly: round(cost),
        confidence: 'high',
      };
    } else if (verdict === 'unused') {
      recommendation = {
        action: 'cancel',
        reason: `No use in ${b.daysSinceLastUse ?? 30}+ days while paying ${money(round(cost))}/month.`,
        savingsMonthly: round(cost),
        confidence,
      };
    } else if (duplicate) {
      recommendation = {
        action: 'cancel',
        reason: `${rival.sub.name} covers the same need and gets ${rival.hours30}h/month against ${b.hours30}h here.`,
        savingsMonthly: round(cost),
        confidence: 'high',
      };
    } else if (b.lastCharge?.status === 'failed') {
      recommendation =
        verdict === 'poor'
          ? { action: 'cancel', reason: 'Payment failed and usage does not justify fixing it.', savingsMonthly: round(cost), confidence }
          : { action: 'retry_payment', reason: 'You use this regularly. Fix the payment method to avoid losing access.', savingsMonthly: 0, confidence: 'high' };
    } else if (verdict === 'poor' && b.trendPct !== null && b.trendPct <= -60 && b.hoursPrev30 >= 8) {
      recommendation = {
        action: 'pause',
        reason: `You used it ${b.hoursPrev30}h last month but only ${b.hours30}h this month. Pausing is reversible and skips the next charge.`,
        savingsMonthly: round(cost),
        confidence,
      };
    } else if (verdict === 'poor' && sub.cheaperPlan) {
      recommendation = {
        action: 'downgrade',
        reason: `${b.hours30}h/month fits the ${sub.cheaperPlan.name} plan at ${money(sub.cheaperPlan.price)}.`,
        savingsMonthly: round(cost - sub.cheaperPlan.price),
        confidence,
      };
    } else if (verdict === 'poor') {
      recommendation = { action: 'cancel', reason: `${money(costPerHour ?? 0)}/hour is well above fair value for ${sub.category.toLowerCase()}.`, savingsMonthly: round(cost), confidence };
    }

    return {
      sub,
      monthlyCost: round(cost),
      yearlyCost: round(cost * 12),
      hours30: b.hours30,
      hoursPrev30: b.hoursPrev30,
      trendPct: b.trendPct,
      activeDays30: b.activeDays30,
      daysSinceLastUse: b.daysSinceLastUse,
      costPerHour,
      valueScore,
      verdict,
      daysToRenewal,
      issues,
      recommendation,
      weekly: b.weekly,
      lastCharge: b.lastCharge,
      previousPrice: b.previousPrice,
    };
  });

  const live = insights.filter((i) => isLive(i.sub));
  // A trial has cost nothing yet; it counts toward upcoming charges, not current spend.
  const paying = live.filter((i) => i.sub.status !== 'trial');
  const upcoming: Portfolio['upcoming'] = live
    .filter((i) => i.daysToRenewal >= 0 && i.daysToRenewal <= 30)
    .map((i) => ({
      subId: i.sub.id,
      name: i.sub.name,
      date: i.sub.nextRenewal,
      amount: i.sub.price,
      kind: i.sub.status === 'trial' ? ('trial_conversion' as const) : ('renewal' as const),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const sum = (xs: number[]) => round(xs.reduce((t, x) => t + x, 0));

  return {
    asOf: now,
    monthlySpend: sum(paying.map((i) => i.monthlyCost)),
    yearlySpend: sum(paying.map((i) => i.yearlyCost)),
    wastedMonthly: sum(paying.filter((i) => i.verdict === 'unused' || i.verdict === 'poor').map((i) => i.monthlyCost)),
    potentialSavingsMonthly: sum(live.map((i) => i.recommendation.savingsMonthly)),
    hours30: round(sum(live.map((i) => i.hours30)), 1),
    next30Total: sum(upcoming.map((u) => u.amount)),
    activeCount: live.length,
    insights,
    upcoming,
  };
}
