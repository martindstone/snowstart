export interface SNCredentials {
  instanceUrl: string;
  username: string;
  password: string;
}

/** ServiceNow reference fields come back either as a plain string (display value)
 *  or as { link, value } when dot-walking / non-display requests are used. */
export type SNReference = string | { link: string; value: string };

export interface SNUser {
  sys_id: string;
  user_name: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  active: string; // "true" | "false"
  x_pd_integration_pagerduty_id?: string;
  web_service_access_only?: string;
  internal_integration_user?: string;
}

export interface SNGroup {
  sys_id: string;
  name: string;
  x_pd_integration_pagerduty_service?: string;
  x_pd_integration_pagerduty_team?: string;
  x_pd_integration_pagerduty_schedule?: string;
  x_pd_integration_pagerduty_escalation?: string;
}

export interface SNCi {
  sys_id: string;
  name: string;
  x_pd_integration_pagerduty_service?: string;
}

export interface SNUpdateSet {
  sys_id: string;
  name: string;
  description?: string;
  state?: string;
}

export interface SNScope {
  sys_id: string;
  scope: string;
  name: string;
  version: string;
  short_description?: string;
}

export interface SNProperty {
  sys_id?: string;
  name: string;
  value: string;
}

export interface SNTableResult<T> {
  result: T[];
}
