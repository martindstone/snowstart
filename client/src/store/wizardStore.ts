import { create } from "zustand";
import type { SNCredentials, SNScope, SNUpdateSet, SNUser } from "../types/servicenow";
import type { PDConnectionInfo, PDCredentials, PDService, PDUser } from "../types/pagerduty";
import type { ChangeLogEntry, UserMatch } from "../types/wizard";
import { pullDirectory } from "../api/directory";

interface IntegrationUserRecord {
  snUser: SNUser;
  /** null when an existing user was found and left untouched — its real
   *  password isn't known to us, so it can't be displayed or copied. */
  password: string | null;
  linkedPdUser: PDUser;
  /** True when this run updated a pre-existing account rather than creating one. */
  isExisting: boolean;
}

interface WizardState {
  step: number;

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

  integrationUser: IntegrationUserRecord | null;
  /** PagerDuty user chosen in Base Settings; it is both the app's default user and the user the integration account is linked to. */
  defaultPdUserId: string | null;

  changeLog: ChangeLogEntry[];

  setStep: (step: number) => void;
  next: () => void;
  back: () => void;

  setSnConnection: (creds: SNCredentials, adminUser: SNUser, scope: SNScope | null) => void;
  setSnScope: (scope: SNScope | null) => void;
  setPdConnection: (creds: PDCredentials, connection: PDConnectionInfo) => void;
  setDirectoryData: (snUsers: SNUser[], pdUsers: PDUser[], matches: UserMatch[]) => void;
  /** Pulls and matches users from both systems (needs both connections). Safe to call repeatedly. */
  loadDirectory: () => Promise<void>;
  setPdServices: (services: PDService[]) => void;
  setUpdateSet: (updateSet: SNUpdateSet) => void;
  setIntegrationUser: (record: IntegrationUserRecord) => void;
  setDefaultPdUserId: (id: string | null) => void;
  updateSnUser: (snUser: SNUser) => void;
  addPdUser: (pdUser: PDUser) => void;

  logChange: (entry: Omit<ChangeLogEntry, "id" | "timestamp">) => void;
}

export const useWizardStore = create<WizardState>((set, get) => ({
  step: 0,

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
  integrationUser: null,
  defaultPdUserId: null,

  changeLog: [],

  setStep: (step) => set({ step }),
  next: () => set((s) => ({ step: s.step + 1 })),
  back: () => set((s) => ({ step: Math.max(0, s.step - 1) })),

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
  setUpdateSet: (updateSet) => set({ updateSet }),
  setIntegrationUser: (integrationUser) => set({ integrationUser }),
  setDefaultPdUserId: (defaultPdUserId) => set({ defaultPdUserId }),

  updateSnUser: (snUser) =>
    set((s) => ({
      snUsers: [...s.snUsers.filter((u) => u.sys_id !== snUser.sys_id), snUser],
    })),
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
  const creds = useWizardStore.getState().snCreds;
  if (!creds) throw new Error("Not connected to ServiceNow yet");
  return creds;
}

export function currentPdCreds(): PDCredentials {
  const creds = useWizardStore.getState().pdCreds;
  if (!creds) throw new Error("Not connected to PagerDuty yet");
  return creds;
}

export function currentAdminId(): string {
  const admin = useWizardStore.getState().snAdminUser;
  if (!admin) throw new Error("Not connected to ServiceNow");
  return admin.sys_id;
}
