export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export type FixOutcome = 'FIXED' | 'PARTIAL' | 'SKIPPED' | 'FAILED';

export interface FixResult {
  outcome: FixOutcome;
  detail?: string;
}

export interface CheckResult {
  status: CheckStatus;
  label: string;
  detail?: string;
  fix?: () => Promise<FixResult>;
}

export interface CheckSummary {
  pass: number;
  warn: number;
  fail: number;
}
