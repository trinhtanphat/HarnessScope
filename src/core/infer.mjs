function finding(title, category, confidence, events, statement) {
  return { title, category, confidence, evidenceEventIds: events.map((e) => e.id).filter(Boolean), statement };
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

function pathOf(event) { return event.data?.path ?? event.data?.file ?? null; }

export function inferFindings(events) {
  const ordered = [...events].sort((a, b) => String(a.timestampUtc).localeCompare(String(b.timestampUtc)));
  const findings = [];

  const firstAction = ordered.findIndex((e) => ['ToolCall','FileWritten'].includes(e.kind));
  const skillReads = ordered.filter((e, i) => ['SkillRead','InstructionRead'].includes(e.kind) && (firstAction < 0 || i <= firstAction));
  if (skillReads.length) {
    const paths = skillReads.map(pathOf).filter(Boolean);
    findings.push(finding(
      'Progressive instruction/skill loading', 'skill_loading', 0.92, skillReads,
      `Observed ${skillReads.length} instruction/skill read(s) before the first execution action${paths.length ? `: ${paths.join(', ')}` : ''}.`
    ));
  }

  const prompts = ordered.filter((e) => e.kind === 'PermissionPrompt');
  for (const prompt of prompts) {
    const decision = ordered.find((e) => e.kind === 'PermissionDecision' && e.correlationId && e.correlationId === prompt.correlationId);
    if (decision) {
      findings.push(finding(
        `Permission gate ${prompt.correlationId ?? ''}`.trim(), 'permission_gate', 0.97, [prompt, decision],
        `Observed an action permission prompt followed by decision '${decision.data?.decision ?? 'unknown'}' before continuing.`
      ));
    }
  }

  const toolCalls = ordered.filter((e) => e.kind === 'ToolCall' && e.data?.name);
  for (const [name, calls] of groupBy(toolCalls, (e) => e.data.name)) {
    const keys = [...new Set(calls.flatMap((e) => Object.keys(e.data?.args ?? {})))].sort();
    findings.push(finding(
      `Observed tool schema: ${name}`, 'tool_schema', Math.min(0.99, 0.82 + calls.length * 0.03), calls,
      `Observed tool '${name}' with argument key(s): ${keys.length ? keys.join(', ') : '(none observed)'}.`
    ));
  }

  const resultsByCorrelation = new Set(ordered.filter((e) => e.kind === 'ToolResult' && e.correlationId).map((e) => e.correlationId));
  const pairedCalls = toolCalls.filter((e) => e.correlationId && resultsByCorrelation.has(e.correlationId));
  const mutationEvents = ordered.filter((e) => ['FileWritten','FileRenamed'].includes(e.kind));
  if (pairedCalls.length >= 2 && mutationEvents.length) {
    const evidence = [...pairedCalls.slice(0, 3), ...mutationEvents.slice(0, 3), ...ordered.filter((e) => e.kind === 'ToolResult' && pairedCalls.some((c) => c.correlationId === e.correlationId)).slice(0, 3)];
    findings.push(finding(
      'Inspect / mutate / execute / verify loop', 'execution_loop', 0.88, evidence,
      `Observed ${pairedCalls.length} correlated tool call/result pair(s) alongside ${mutationEvents.length} mutation event(s), consistent with an execution-and-verification loop.`
    ));
  }

  const context = ordered.filter((e) => ['ContextMarker','CompactionMarker','ResumeMarker'].includes(e.kind));
  if (context.length) {
    const kinds = [...new Set(context.map((e) => e.kind))].join(', ');
    findings.push(finding(
      'Visible context/session management', 'context_management', 0.96, context,
      `Observed explicit context/session marker(s): ${kinds}. No private token counts are inferred.`
    ));
  }

  const exitIndex = ordered.findIndex((e) => e.kind === 'ProcessExited');
  if (exitIndex >= 0) {
    const writtenBeforeExit = ordered.slice(0, exitIndex).filter((e) => e.kind === 'FileWritten' && pathOf(e));
    const startedAfter = ordered.findIndex((e, i) => i > exitIndex && e.kind === 'ProcessStarted');
    if (startedAfter >= 0) {
      for (const write of writtenBeforeExit) {
        const read = ordered.slice(startedAfter + 1).find((e) => e.kind === 'FileRead' && pathOf(e) === pathOf(write));
        if (read) {
          findings.push(finding(
            'Session state persisted across restart', 'session_persistence', 0.94, [write, ordered[exitIndex], ordered[startedAfter], read],
            `Observed '${pathOf(write)}' written before process exit and read after a subsequent process start.`
          ));
          break;
        }
      }
    }
  }

  return findings.sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}
