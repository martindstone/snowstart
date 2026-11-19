/**
 * Every ServiceNow table/field/property/role name this app writes to,
 * confirmed live against a real instance with the PagerDuty ServiceNow app
 * (v8.4.2, scope x_pd_integration) installed. Keep this file as the single
 * source of truth — if a future app version renames something, this is the
 * only place that needs to change.
 */

export const SN_TABLES = {
  sysUser: "sys_user",
  sysUserGroup: "sys_user_group",
  cmdbCi: "cmdb_ci",
  sysProperties: "sys_properties",
  sysUpdateSet: "sys_update_set",
  sysUserPreference: "sys_user_preference",
  sysUserRole: "sys_user_role",
  sysUserHasRole: "sys_user_has_role",
  sysAppModule: "sys_scope",
  pagerdutyWebhooks: "x_pd_integration_pagerduty_webhooks",
} as const;

/** sys_properties.name values used by the PagerDuty app. */
export const SN_PROPERTIES = {
  apiKey: "x_pd_integration.api_key",
  instanceUrl: "x_pd_integration.instance_url",
  defaultUser: "x_pd_integration.default_user",
  defaultService: "x_pd_integration.default_service",
  sn2pdMapping: "x_pd_integration.sn2pd_mapping",
  autoProvisionUsers: "x_pd_integration.auto_provision_users",
  snAuthUser: "x_pd_integration.sn_auth_user",
  snAuthUserPwd: "x_pd_integration.sn_auth_userpwd",
} as const;

/** Custom fields the PagerDuty app adds to global tables. */
export const SN_FIELDS = {
  sysUser: {
    pagerdutyId: "x_pd_integration_pagerduty_id",
    webServiceAccessOnly: "web_service_access_only",
    internalIntegrationUser: "internal_integration_user",
  },
  cmdbCi: {
    pagerdutyService: "x_pd_integration_pagerduty_service",
    pagerdutyWebhook: "x_pd_integration_pagerduty_webhook",
    pagerdutyChangeEventToken: "x_pd_integration_pagerduty_change_event_token",
  },
  sysUserGroup: {
    pagerdutyService: "x_pd_integration_pagerduty_service",
    pagerdutyTeam: "x_pd_integration_pagerduty_team",
    pagerdutySchedule: "x_pd_integration_pagerduty_schedule",
    pagerdutyEscalation: "x_pd_integration_pagerduty_escalation",
  },
} as const;

/** Roles required on the ServiceNow integration user PagerDuty authenticates as. */
export const SN_INTEGRATION_USER_ROLES = ["itil", "x_pd_integration.admin", "snc_basic_auth_api_access"] as const;

export const PD_APP_SCOPE = "x_pd_integration";

/** The app's sys_id is the same across store and sideloaded builds; its scope name is not
 *  (sideloaded dev builds declare x_pd_integration_dev). */
export const PD_APP_SYS_ID = "39a9d9664f834e00dd657bb28110c77b";

export const SN2PD_MAPPING_DEFAULT = "Configuration Items and Assignment Groups map to PagerDuty";
