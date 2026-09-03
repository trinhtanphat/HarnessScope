import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../core/csv.mjs';

function pathOf(input) { return input instanceof URL ? fileURLToPath(input) : input; }
function parseTimestamp(time, date) {
  const m = String(time).match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!m) return new Date().toISOString();
  const ms = (m[4] ?? '').slice(0, 3).padEnd(3, '0');
  return `${date}T${m[1]}:${m[2]}:${m[3]}.${ms}Z`;
}
function kindFor(operation) {
  if (/process create/i.test(operation)) return 'ProcessStarted';
  if (/process exit/i.test(operation)) return 'ProcessExited';
  if (/readfile/i.test(operation)) return 'FileRead';
  if (/writefile/i.test(operation)) return 'FileWritten';
  if (/setrenameinformationfile|rename/i.test(operation)) return 'FileRenamed';
  return 'Unknown';
}

export function importProcmon(input, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = parseCsv(readFileSync(pathOf(input), 'utf8'));
  return rows.map((row) => {
    const kind = kindFor(row.Operation);
    const data = {
      processName: row['Process Name'] || null,
      pid: Number(row.PID) || null,
      operation: row.Operation || null,
      path: row.Path || null,
      result: row.Result || null,
      detail: row.Detail || null
    };
    if (kind === 'ProcessStarted') {
      const pid = row.Detail?.match(/PID:\s*(\d+)/i)?.[1];
      const commandLine = row.Detail?.match(/Command line:\s*(.+)$/i)?.[1];
      if (pid) data.childPid = Number(pid);
      if (commandLine) data.commandLine = commandLine;
    }
    return { timestampUtc: parseTimestamp(row['Time of Day'], date), source: 'procmon', kind, correlationId: row.PID || null, data };
  });
}
