import { create } from "zustand";
import type { SNCredentials, SNScope, SNUpdateSet, SNUser } from "../types/servicenow";
import type { PDConnectionInfo, PDCredentials, PDService, PDUser } from "../types/pagerduty";
import type { ChangeLogEntry, UserMatch } from "../types/app";
import { pullDirectory } from "../api/directory";
import { checkReadiness, type Readiness } from "../api/readiness";
import { checkConfiguration, type ConfigStatus } from "../api/configStatus";

interface IntegrationUserRecord {
  snUser: SNUser;
  /** null when an existing user was found and left untouched — its real
   *  password isn't known to us, so it can't be displayed or copied. */
  password: string | null;
  linkedPdUser: PDUser;
  /** True when this run updated a pre-existing account rather than creating one. */
  isExisting: boolean;
}

/** The sections of the app, shown as tabs. */
export type View = "setup" | "configuration" | "users" | "services" | "escalations" | "verify";

interface AppState {
  view: View;

  snCreds: SNCredentials | null;
  snAdminUser: SNUser | null;
  snScope: SNScope | null;

  pdCreds: PDCredentials | null;
  pdConnection: PDConnectionInfo | null;

  snUsers: SNUser[];
  pdUsers: PDUser[];
  pdServices: PDService[];
  matches: UserMatch[];
  directoryStatus: "idle" | "loading" | "loaded" | "error";
  directoryError: string | null;

  updateSet: SNUpdateSet | null;
  /** The user chose to work without an update set, so the nudge to pick one is dismissed. */
  updateSetSkipped: boolean;

  integrationUser: IntegrationUserRecord | null;
  /** The app's default PagerDuty user; it is also the user the integration account is linked to. */
  defaultPdUserId: string | null;

  /** Live "is this instance set up?" answer, recomputed from ServiceNow by refreshReadiness(). */
  readiness: Readiness | null;
  readinessStatus: "idle" | "loading" | "ready" | "error";
  readinessError: string | null;
  /** The first readiness check after connecting has been made and the opening view chosen. */
  routed: boolean;

  /** Whether the Configuration tab's views and priority mappings are in place; null until checked (or if the app isn't installed). */
  configStatus: ConfigStatus | null;
  /** Counts shown on tab labels by sections that know what's waiting (services and escalations report once they've loaded). */
  tabCounts: Partial<Record<View, number>>;

  changeLog: ChangeLogEntry[];

  setView: (view: View) => void;
  /** Forgets both connections and everything loaded from them. */
  resetSession: () => void;
  /** Drops one connection from the connect screen so it can be re-entered (the other is kept). */
  clearSnConnection: () => void;
  clearPdConnection: () => void;
  /** Reloads users, then readiness, then (once) picks the opening view. */
  bootstrap: () => Promise<void>;
  refreshReadiness: () => Promise<void>;
  refreshConfigStatus: () => Promise<void>;
  setTabCount: (view: View, count: number) => void;

  setSnConnection: (creds: SNCredentials, adminUser: SNUser, scope: SNScope | null) => void;
  setSnScope: (scope: SNScope | null) => void;
  setPdConnection: (creds: PDCredentials, connection: PDConnectionInfo) => void;
  setDirectoryData: (snUsers: SNUser[], pdUsers: PDUser[], matches: UserMatch[]) => void;
  /** Pulls and matches users from both systems (needs both connections). Safe to call repeatedly. */
  loadDirectory: () => Promise<void>;
  setPdServices: (services: PDService[]) => void;
  setUpdateSet: (updateSet: SNUpdateSet | null) => void;
  setUpdateSetSkipped: (skipped: boolean) => void;
  setIntegrationUser: (record: IntegrationUserRecord) => void;
  setDefaultPdUserId: (id: string | null) => void;
  addPdUser: (pdUser: PDUser) => void;

  logChange: (entry: Omit<ChangeLogEntry, "id" | "timestamp">) => void;
}

let bootstrapInFlight: Promise<void> | null = null;

const EMPTY_SESSION = {
  snCreds: null,
  snAdminUser: null,
  snScope: null,
  pdCreds: null,
  pdConnection: null,
  snUsers: [],
  pdUsers: [],
  pdServices: [],
  matches: [],
  directoryStatus: "idle" as const,
  directoryError: null,
  updateSet: null,
  updateSetSkipped: false,
  integrationUser: null,
  defaultPdUserId: null,
  readiness: null,
  readinessStatus: "idle" as const,
  readinessError: null,
  routed: false,
  configStatus: null,
  tabCounts: {},
  changeLog: [],
  view: "setup" as View,
};

export const useAppStore = create<AppState>((set, get) => ({
  view: "setup",

  snCreds: null,
  snAdminUser: null,
  snScope: null,

  pdCreds: null,
  pdConnection: null,

  snUsers: [],
  pdUsers: [],
  pdServices: [],
  matches: [],
  directoryStatus: "idle",
  directoryError: null,

  updateSet: null,
  updateSetSkipped: false,
  integrationUser: null,
  defaultPdUserId: null,

  readiness: null,
  readinessStatus: "idle",
  readinessError: null,
  routed: false,

  configStatus: null,
  tabCounts: {},

  changeLog: [],

  setView: (view) => set({ view }),
  resetSession: () => set({ ...EMPTY_SESSION }),
  clearSnConnection: () => set({ snCreds: null, snAdminUser: null, snScope: null }),
  clearPdConnection: () => set({ pdCreds: null, pdConnection: null }),
  bootstrap: () => {
    // One run at a time: React runs effects twice in development, and a second concurrent run would see a half-loaded directory.
    bootstrapInFlight ??= (async () => {
      await get().loadDirectory();
      await get().refreshReadiness();
      if (get().routed) return;
      const { readiness } = get();
      // Land on Setup when something essential is missing, otherwise on the work to do.
      set({ routed: true, view: !readiness || readiness.needsSetup ? "setup" : "users" });
    })().finally(() => {
      bootstrapInFlight = null;
    });
    return bootstrapInFlight;
  },
  refreshConfigStatus: async () => {
    const { snCreds, pdCreds, readiness } = get();
    if (!snCreds || !pdCreds || !readiness?.scope) return;
    set({ configStatus: await checkConfiguration(snCreds, pdCreds) });
  },
  setTabCount: (view, count) =>
    set((s) => (s.tabCounts[view] === count ? s : { tabCounts: { ...s.tabCounts, [view]: count } })),
  refreshReadiness: async () => {
    const { snCreds, pdUsers } = get();
    if (!snCreds) return;
    set({ readinessStatus: "loading", readinessError: null });
    try {
      const readiness = await checkReadiness(snCreds, pdUsers);
      const { config } = readiness;
      const integration = readiness.items.find((i) => i.id === "integration");
      const linkedPdUser = pdUsers.find((u) => u.id === config.defaultUser);
      const known = get().integrationUser;
      set({
        readiness,
        readinessStatus: "ready",
        snScope: readiness.scope,
        // The default user is whatever the app is configured with; keep the last known one if the property is blank.
        defaultPdUserId: config.defaultUser || get().defaultPdUserId,
        // A fully set-up integration user is adopted as is; a broken or missing one is left for the Integration user card.
        integrationUser:
          integration?.status === "ok" && config.integrationUser && linkedPdUser
            ? {
                snUser: config.integrationUser,
                password: known?.snUser.sys_id === config.integrationUser.sys_id ? known.password : null,
                linkedPdUser,
                isExisting: known?.snUser.sys_id === config.integrationUser.sys_id ? known.isExisting : true,
              }
            : integration?.status === "ok"
              ? known
              : null,
      });
      // The Configuration tab's status isn't needed to open the app, so it fills in behind it, once the app is installed.
      if (readiness.scope && !get().configStatus) void get().refreshConfigStatus();
    } catch (e) {
      set({ readinessStatus: "error", readinessError: e instanceof Error ? e.message : "Couldn't check this instance" });
    }
  },

  setSnConnection: (snCreds, snAdminUser, snScope) => set({ snCreds, snAdminUser, snScope }),
  setSnScope: (snScope) => set({ snScope }),
  setPdConnection: (pdCreds, pdConnection) => set({ pdCreds, pdConnection }),
  setDirectoryData: (snUsers, pdUsers, matches) => set({ snUsers, pdUsers, matches, directoryStatus: "loaded" }),
  loadDirectory: async () => {
    const { snCreds, pdCreds, directoryStatus } = get();
    if (!snCreds || !pdCreds || directoryStatus === "loading") return;
    set({ directoryStatus: "loading", directoryError: null });
    try {
      const { snUsers, pdUsers, matches } = await pullDirectory(snCreds, pdCreds);
      set({ snUsers, pdUsers, matches, directoryStatus: "loaded" });
    } catch (e) {
      set({ directoryStatus: "error", directoryError: e instanceof Error ? e.message : "Failed to pull users" });
    }
  },
  setPdServices: (pdServices) => set({ pdServices }),
  setUpdateSet: (updateSet) => set({ updateSet, updateSetSkipped: false }),
  setUpdateSetSkipped: (updateSetSkipped) => set({ updateSetSkipped }),
  setIntegrationUser: (integrationUser) => set({ integrationUser }),
  setDefaultPdUserId: (defaultPdUserId) => set({ defaultPdUserId }),

  addPdUser: (pdUser) => set((s) => ({ pdUsers: [...s.pdUsers, pdUser] })),

  logChange: (entry) =>
    set((s) => ({
      changeLog: [
        ...s.changeLog,
        { ...entry, id: `${entry.system}-${entry.recordId}-${Date.now()}`, timestamp: Date.now() },
      ],
    })),
}));

export function snRecordLink(instanceUrl: string, table: string, sysId: string): string {
  return `${instanceUrl}/nav_to.do?uri=${table}.do?sys_id=${sysId}`;
}

/** Opens any ServiceNow page or list inside the standard UI shell, e.g. "x_pd_integration_pd_settings_page.do". */
export function snNavLink(instanceUrl: string, target: string): string {
  return `${instanceUrl}/nav_to.do?uri=${encodeURIComponent(target)}`;
}

export function currentSnCreds(): SNCredentials {
  const creds = useAppStore.getState().snCreds;
  if (!creds) throw new Error("Not connected to ServiceNow yet");
  return creds;
}

export function currentPdCreds(): PDCredentials {
  const creds = useAppStore.getState().pdCreds;
  if (!creds) throw new Error("Not connected to PagerDuty yet");
  return creds;
}

export function currentAdminId(): string {
  const admin = useAppStore.getState().snAdminUser;
  if (!admin) throw new Error("Not connected to ServiceNow");
  return admin.sys_id;
}
