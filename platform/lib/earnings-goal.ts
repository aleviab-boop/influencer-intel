// ============================================================
// Earnings goal — the earnings view tells a creator what they've made, but not
// whether they're on track for what they WANT to make. Freelancers run on
// monthly income targets; this turns a target plus this month's paid/pending
// deals into a progress read: how far along, whether their current pace lands
// the goal by month-end, and what it'd take to close the gap.
//
// Pure and deterministic: it does calendar-aware arithmetic on numbers the
// route computed (goal, paid-this-month, pending, day-of-month) — no ML/LLM, no
// writes. "today" is injected so pace/projection are testable and
// timezone-honest.
// ============================================================

export interface GoalInput {
  goal: number;                 // monthly target, INR
  earned_this_month: number;    // paid, this calendar month
  pending_this_month: number;   // unpaid but expected (rate on live, undelivered/awaiting)
  day_of_month: number;         // 1..31 (today)
  days_in_month: number;        // 28..31
}

export interface GoalProgress {
  has_goal: boolean;
  goal: number;
  earned: number;
  pending: number;
  progress_pct: number;         // earned / goal, capped display in UI
  remaining: number;            // max(goal - earned, 0)
  covered_by_pending: boolean;  // earned + pending >= goal
  projected: number;            // linear run-rate projection to month-end
  projected_pct: number;
  status: 'hit' | 'ahead' | 'on-track' | 'behind' | 'no-goal';
  days_left: number;
  per_day_needed: number;       // to hit goal with remaining days
  headline: string;
  tip: string;
}

const money = (n: number): string => '\u20b9' + Math.round(n).toLocaleString('en-IN');

export function computeGoalProgress(input: GoalInput): GoalProgress {
  const goal = Math.max(0, Math.round(Number(input.goal) || 0));
  const earned = Math.max(0, Math.round(Number(input.earned_this_month) || 0));
  const pending = Math.max(0, Math.round(Number(input.pending_this_month) || 0));
  const dim = Math.min(31, Math.max(28, Math.round(input.days_in_month) || 30));
  const day = Math.min(dim, Math.max(1, Math.round(input.day_of_month) || 1));
  const daysLeft = Math.max(0, dim - day);

  if (goal <= 0) {
    return {
      has_goal: false, goal: 0, earned, pending,
      progress_pct: 0, remaining: 0, covered_by_pending: false,
      projected: earned, projected_pct: 0, status: 'no-goal', days_left: daysLeft,
      per_day_needed: 0,
      headline: earned > 0 ? `${money(earned)} earned this month.` : 'Set a monthly goal to track your income.',
      tip: 'A target makes it easy to see if your deal pipeline is pacing where you want it.',
    };
  }

  const progressPct = Math.round((earned / goal) * 100);
  const remaining = Math.max(0, goal - earned);
  const coveredByPending = earned + pending >= goal;

  // Linear run-rate: what this month lands at if the current daily pace holds.
  const perDaySoFar = earned / day;
  const projected = Math.round(perDaySoFar * dim);
  const projectedPct = Math.round((projected / goal) * 100);
  const perDayNeeded = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining;

  let status: GoalProgress['status'];
  if (earned >= goal) status = 'hit';
  else if (projected >= goal * 1.05) status = 'ahead';
  else if (projected >= goal * 0.9) status = 'on-track';
  else status = 'behind';

  let headline: string;
  let tip: string;
  if (status === 'hit') {
    headline = `Goal smashed — ${money(earned)} of your ${money(goal)} target.`;
    tip = 'Bank the momentum: line up next month\u2019s deals now while you\u2019re in demand.';
  } else if (status === 'ahead') {
    headline = `Ahead of pace — on track for ${money(projected)} vs your ${money(goal)} goal.`;
    tip = `You need just ${money(perDayNeeded)}/day from here. Consider raising your rate on new invites.`;
  } else if (status === 'on-track') {
    headline = `On track — ${money(earned)} in, tracking to about ${money(projected)}.`;
    tip = coveredByPending
      ? `Your pending deals already cover the gap — chase those payments to lock it in.`
      : `Keep it up: ${money(perDayNeeded)}/day over the last ${daysLeft} day${daysLeft === 1 ? '' : 's'} closes the ${money(remaining)} gap.`;
  } else {
    headline = `Behind pace — ${money(earned)} of ${money(goal)}, projecting ${money(projected)}.`;
    tip = coveredByPending
      ? `Good news: your pending deals (${money(pending)}) would cover the ${money(remaining)} gap once paid.`
      : `To still hit it you\u2019d need ${money(perDayNeeded)}/day — pitch one or two more collabs this week.`;
  }

  return {
    has_goal: true, goal, earned, pending,
    progress_pct: progressPct, remaining, covered_by_pending: coveredByPending,
    projected, projected_pct: projectedPct, status, days_left: daysLeft,
    per_day_needed: perDayNeeded, headline, tip,
  };
}
