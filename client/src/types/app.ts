import type { SNUser } from "./servicenow";
import type { PDUser } from "./pagerduty";

export type MatchStatus = "matched" | "sn-only" | "pd-only";

export interface UserMatch {
  email: string;
  status: MatchStatus;
  snUser?: SNUser;
  pdUser?: PDUser;
}

export interface ChangeLogEntry {
  id: string;
  timestamp: number;
  system: "servicenow" | "pagerduty";
  table?: string;
  recordId: string;
  description: string;
  link?: string;
}
