import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, ScrollArea, Select, Stack, Table, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import Section from "./Section";
import { stripSnPrefix } from "../utils/names";
import { useAppStore, type View } from "../store/appStore";

export interface EntityLinkSource {
  id: string;
  name: string;
}

export interface EntityLinkTarget {
  sysId: string;
  name: string;
  /** How many other ServiceNow records are already linked to the same PagerDuty entity (existing links only). */
  moreCount?: number;
}

interface Row {
  source: EntityLinkSource;
  /** Current dropdown options for this row — starts as its name-matched
   *  suggestions, refined by whatever the user searches for. Always includes
   *  the selected target (if any) so its label stays visible. */
  options: EntityLinkTarget[];
  selected: EntityLinkTarget | null;
  link: boolean;
  searching: boolean;
  status: "idle" | "linking" | "done" | "error";
  /** True when the link was already in place before this run (as opposed to applied here). */
  preexisting?: boolean;
  /** Non-fatal follow-up problem from applying the link (the link itself succeeded). */
  note?: string;
  /** Set when the target was proposed automatically by name: "prefix" if the app's "SN:" prefix had to be ignored. */
  auto?: "name" | "prefix";
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function withSelected(options: EntityLinkTarget[], selected: EntityLinkTarget | null): EntityLinkTarget[] {
  if (!selected || options.some((o) => o.sysId === selected.sysId)) return options;
  return [selected, ...options];
}

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

interface EntityLinkSectionProps {
  title: string;
  description: string;
  sourceColumnLabel: string;
  targetColumnLabel: string;
  targetPlaceholder: string;
  emptyMessage: string;
  /** Pulls the rows to link. Called once on mount. */
  loadSources: () => Promise<EntityLinkSource[]>;
  /** Server-side search for target candidates — never loads a whole table up front. */
  searchTargets: (query: string) => Promise<EntityLinkTarget[]>;
  /**
   * Finds links that already exist in ServiceNow, keyed by source id (the first record found if several point
   * at the same PagerDuty entity). Those rows are shown as already linked instead of being offered again.
   */
  findExistingLinks?: (sources: EntityLinkSource[]) => Promise<Record<string, EntityLinkTarget>>;
  /**
   * Performs the actual write (and any change-log entry) for one confirmed pairing. May return a warning string
   * when the link was written but a follow-up action couldn't be completed; it's shown on the row.
   */
  applyLink: (source: EntityLinkSource, target: EntityLinkTarget) => Promise<void | string>;
  /** The tab this section lives on; once loaded, it shows how many proposed matches are waiting to be applied. */
  tabView?: View;
  /**
   * Extra content above the table. `appliedCount` changes as links are applied and `applying` is true while that's
   * happening, so it can react once a batch finishes.
   */
  extra?: (ctx: { appliedCount: number; applying: boolean }) => ReactNode;
}

/**
 * Shared "pull entities from PagerDuty, suggest a ServiceNow match by name,
 * let the user review/override, then apply" flow — used for both
 * service→CI and escalation-policy→assignment-group linking. Target
 * candidates are always searched server-side (never a bulk table pull),
 * since a CI table can run into the thousands of rows.
 */
export default function EntityLinkSection({
  title,
  description,
  sourceColumnLabel,
  targetColumnLabel,
  targetPlaceholder,
  emptyMessage,
  loadSources,
  searchTargets,
  findExistingLinks,
  applyLink,
  tabView,
  extra,
}: EntityLinkSectionProps) {
  const setTabCount = useAppStore((s) => s.setTabCount);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadSources()
      .then(async (sources) => {
        // Look up a name-matched suggestion for every row in parallel — the
        // browser naturally caps concurrency per origin, so this stays fast
        // even for dozens of rows against a large ServiceNow table.
        const existing = await (
          findExistingLinks?.(sources) ?? Promise.resolve({} as Record<string, EntityLinkTarget>)
        ).catch(() => ({}) as Record<string, EntityLinkTarget>);
        const suggestions = await Promise.all(
          sources.map((source) =>
            existing[source.id]
              ? Promise.resolve([] as EntityLinkTarget[])
              : searchTargets(stripSnPrefix(source.name)).catch(() => [] as EntityLinkTarget[]),
          ),
        );
        if (cancelled) return;
        const built = sources.map((source, i): Row => {
          const linked = existing[source.id];
          if (linked) {
            return {
              source,
              options: [linked],
              selected: linked,
              link: true,
              searching: false,
              status: "done",
              preexisting: true,
            };
          }
          const options = suggestions[i];
          const wanted = normalize(stripSnPrefix(source.name));
          const exact = options.find((t) => normalize(t.name) === wanted);
          const auto = exact ? (stripSnPrefix(source.name) !== source.name ? "prefix" : "name") : undefined;
          return { source, options, selected: exact ?? null, link: !!exact, searching: false, status: "idle", auto };
        });
        // Rows that need a decision first: proposed matches, then unmatched, then already-linked ones.
        const rank = (r: Row) => (r.preexisting ? 2 : r.auto ? 0 : 1);
        built.sort((a, b) => rank(a) - rank(b));
        if (cancelled) return;
        setRows(built);
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Runs once per mount; the section stays mounted while you move between tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (sourceId: string, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.source.id === sourceId ? { ...r, ...patch } : r)));
  };

  const handleSearchChange = (sourceId: string, query: string) => {
    clearTimeout(searchTimers.current[sourceId]);
    if (query.trim().length < MIN_SEARCH_LENGTH) return;
    searchTimers.current[sourceId] = setTimeout(async () => {
      updateRow(sourceId, { searching: true });
      try {
        const results = await searchTargets(query);
        setRows((prev) =>
          prev.map((r) =>
            r.source.id === sourceId ? { ...r, options: withSelected(results, r.selected), searching: false } : r,
          ),
        );
      } catch {
        updateRow(sourceId, { searching: false });
      }
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSelect = (sourceId: string, targetSysId: string | null) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.source.id !== sourceId) return r;
        const target = r.options.find((t) => t.sysId === targetSysId) ?? null;
        // Picking a target implies intent to link it — otherwise it'd silently
        // sit unchecked and get skipped by Apply with no indication why.
        return { ...r, selected: target, link: !!target, auto: undefined };
      }),
    );
  };

  const handleApply = async () => {
    const toApply = rows.filter((r) => r.link && r.selected && r.status !== "done");
    if (toApply.length === 0) return;
    setApplying(true);
    setError(null);

    for (const row of toApply) {
      updateRow(row.source.id, { status: "linking" });
      try {
        const warning = await applyLink(row.source, row.selected!);
        updateRow(row.source.id, { status: "done", note: warning || undefined });
      } catch (e) {
        updateRow(row.source.id, { status: "error" });
        setError(e instanceof Error ? e.message : "Failed to link a row");
      }
    }
    setApplying(false);
  };

  // Checked but not yet successfully applied — Next must not imply these
  // took effect when they haven't (or failed and were never retried).
  const pendingCount = rows.filter((r) => r.link && r.status !== "done").length;
  const appliedCount = rows.filter((r) => r.status === "done" && !r.preexisting).length;
  const waitingCount = rows.filter((r) => r.auto && r.status !== "done").length;
  useEffect(() => {
    if (tabView && loaded) setTabCount(tabView, waitingCount);
  }, [tabView, loaded, waitingCount, setTabCount]);

  // Rows proposed automatically by name (the app's "SN:" prefix ignored) that can still be applied.
  const matchedRows = rows.filter((r) => r.auto && r.selected && r.status !== "done" && r.status !== "linking");
  const selectMatched = () =>
    setRows((prev) => prev.map((r) => (r.auto && r.selected && r.status === "idle" ? { ...r, link: true } : r)));
  const clearSelection = () =>
    setRows((prev) => prev.map((r) => (r.status === "idle" || r.status === "error" ? { ...r, link: false } : r)));

  return (
    // Linking is optional — always let the user move on with nothing checked
    // (or if the initial load failed outright) — but never past unapplied
    // checked rows, which "Next" would otherwise silently discard.
    <Section title={title} description={description}>
      <Stack>
        {loading && <Text c="dimmed">Loading…</Text>}
        {!loading && loaded && rows.length === 0 && <Text c="dimmed">{emptyMessage}</Text>}

        {!loading && rows.length > 0 && (
          <>
            <Group>
              <Button onClick={handleApply} loading={applying} variant="light">
                Apply linked rows
              </Button>
              <Button onClick={selectMatched} variant="default" disabled={applying || matchedRows.length === 0}>
                Select matched ({matchedRows.length})
              </Button>
              <Button onClick={clearSelection} variant="subtle" color="gray" disabled={applying || pendingCount === 0}>
                Clear selection
              </Button>
              {pendingCount > 0 && (
                <Text size="sm" c="yellow.7">
                  {pendingCount} row{pendingCount === 1 ? "" : "s"} checked but not applied yet
                </Text>
              )}
            </Group>
            {extra?.({ appliedCount, applying })}
            <ScrollArea h={420}>
              <Table stickyHeader highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th />
                    <Table.Th>{sourceColumnLabel}</Table.Th>
                    <Table.Th>{targetColumnLabel}</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row) => (
                    <Table.Tr key={row.source.id}>
                      <Table.Td>
                        <Checkbox
                          checked={row.link}
                          disabled={row.status === "linking" || row.status === "done"}
                          onChange={(e) => updateRow(row.source.id, { link: e.currentTarget.checked })}
                        />
                      </Table.Td>
                      <Table.Td>{row.source.name}</Table.Td>
                      <Table.Td>
                        <Select
                          placeholder={targetPlaceholder}
                          searchable
                          nothingFoundMessage={row.searching ? "Searching…" : "Type to search"}
                          rightSection={row.searching ? <Loader size={14} /> : undefined}
                          filter={({ options }) => options}
                          disabled={row.status === "linking" || row.status === "done"}
                          data={row.options.map((t) => ({
                            value: t.sysId,
                            label: t.moreCount ? `${t.name} (+${t.moreCount} more)` : t.name,
                          }))}
                          value={row.selected?.sysId ?? null}
                          onChange={(v) => handleSelect(row.source.id, v)}
                          onSearchChange={(q) => handleSearchChange(row.source.id, q)}
                        />
                      </Table.Td>
                      <Table.Td>
                        {row.status === "idle" &&
                          (row.auto ? (
                            <Badge
                              color="teal"
                              variant="light"
                              title={
                                row.auto === "prefix"
                                  ? 'Matched by name once the app\'s "SN:" prefix is ignored'
                                  : "Matched by exact name"
                              }
                            >
                              {row.auto === "prefix" ? "matched (SN: prefix)" : "matched by name"}
                            </Badge>
                          ) : (
                            <Text c="dimmed">—</Text>
                          ))}
                        {row.status === "linking" && <Badge color="blue">linking…</Badge>}
                        {row.status === "done" && (
                          <Badge
                            color="green"
                            title={row.preexisting ? "Already linked in ServiceNow before this run" : undefined}
                          >
                            linked
                          </Badge>
                        )}
                        {row.status === "error" && <Badge color="red">failed</Badge>}
                        {row.note && (
                          <Text size="xs" c="orange.7" mt={4}>
                            {row.note}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}

        {pendingCount > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Unapplied changes">
            You've checked {pendingCount} row{pendingCount === 1 ? "" : "s"} that{" "}
            {pendingCount === 1 ? "hasn't" : "haven't"} been applied yet. Click "Apply linked rows" (or uncheck{" "}
            {pendingCount === 1 ? "it" : "them"}) before moving on.
          </Alert>
        )}

        {loadError && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Couldn't load the list">
            {loadError}
          </Alert>
        )}

        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Some rows failed to link">
            {error}
          </Alert>
        )}
      </Stack>
    </Section>
  );
}
