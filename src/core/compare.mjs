function sortedSet(values) { return [...new Set(values.filter((v) => v !== undefined && v !== null))].sort(); }
function difference(a, b) { const bs = new Set(b); return a.filter((x) => !bs.has(x)); }

export function compareSessions(a, b) {
  const aKinds = sortedSet((a.events ?? []).map((e) => e.kind));
  const bKinds = sortedSet((b.events ?? []).map((e) => e.kind));
  const aTools = sortedSet((a.events ?? []).filter((e) => e.kind === 'ToolCall').map((e) => e.data?.name));
  const bTools = sortedSet((b.events ?? []).filter((e) => e.kind === 'ToolCall').map((e) => e.data?.name));
  const aFindings = sortedSet((a.findings ?? []).map((f) => f.category));
  const bFindings = sortedSet((b.findings ?? []).map((f) => f.category));
  return {
    sessionA: a.session ?? null,
    sessionB: b.session ?? null,
    sharedEventKinds: aKinds.filter((x) => bKinds.includes(x)),
    onlyAEventKinds: difference(aKinds, bKinds),
    onlyBEventKinds: difference(bKinds, aKinds),
    sharedToolNames: aTools.filter((x) => bTools.includes(x)),
    onlyAToolNames: difference(aTools, bTools),
    onlyBToolNames: difference(bTools, aTools),
    sharedFindingCategories: aFindings.filter((x) => bFindings.includes(x)),
    onlyAFindingCategories: difference(aFindings, bFindings),
    onlyBFindingCategories: difference(bFindings, aFindings)
  };
}
