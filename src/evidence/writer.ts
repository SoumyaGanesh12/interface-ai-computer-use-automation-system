/**
 * One event stream, two sinks: `/evidence/<runId>/events.jsonl` (this run, for
 * debugging it) and `/audit/events.jsonl` (every run, append-only, a different
 * consumer and retention story). No logging library -- one write() that redacts
 * unconditionally, so a caller can't forget to.
 *
 * A separate, plainer journal() stream lives alongside events.jsonl: one line per
 * step's dispatched/confirmed transition. `durable: true` (the executor sets this
 * before dispatching an irreversible action) opens the file, writes, and fsyncs before
 * returning; every other write is a plain buffered append.
 *
 * Per-instance state only (a seq counter): never module-level, so concurrent runs never
 * share it. Construction itself refuses to reopen a runId that already has a
 * run_finished event on disk: a finished run's log is a closed record, and silently
 * appending a second run's events into it is exactly the corruption a reused runId
 * causes.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { redactInputs, type InputDeclaration } from '../policy/redact';
import { runEvidenceDir } from './paths';

export type RunEventKind =
  | 'run_started'
  | 'step_succeeded'
  | 'step_failed'
  | 'recovery_attempted'
  | 'escalation_raised'
  | 'escalation_resolved'
  | 'run_finished';

export interface RunEventInput {
  kind: RunEventKind;
  stepId?: string;
  detail?: string;
  /** Redacted internally against `inputDeclarations` before this ever reaches disk. */
  inputs?: Record<string, string>;
  inputDeclarations?: InputDeclaration[];
  result?: unknown;
}

export interface JournalEntry {
  stepId: string;
  status: 'dispatched' | 'confirmed';
  reference?: string;
}

export interface EvidenceWriter {
  write(event: RunEventInput): void;
  /** `durable: true` fsyncs before returning -- required before dispatching an irreversible action, so dispatch state remains determinable from disk after a crash. Buffered otherwise. */
  journal(entry: JournalEntry, durable?: boolean): void;
}

function appendDurable(filePath: string, data: string): void {
  const fd = openSync(filePath, 'a');
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function alreadyFinished(eventsPath: string): boolean {
  if (!existsSync(eventsPath)) return false;
  const lines = readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
  return lines.some((line) => {
    try {
      return (JSON.parse(line) as { kind?: string }).kind === 'run_finished';
    } catch {
      return false;
    }
  });
}

export function createEvidenceWriter(runId: string, evidenceRoot = 'evidence', auditRoot = 'audit'): EvidenceWriter {
  let seq = 0;
  let journalSeq = 0;
  const evidenceDir = runEvidenceDir(runId, evidenceRoot);
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(auditRoot, { recursive: true });
  const evidencePath = path.join(evidenceDir, 'events.jsonl');
  const journalPath = path.join(evidenceDir, 'journal.jsonl');
  const auditPath = path.join(auditRoot, 'events.jsonl');

  if (alreadyFinished(evidencePath)) {
    throw new Error(`runId "${runId}" already has a finished run at ${evidencePath} -- generate a new runId rather than reusing this one`);
  }

  return {
    write(event) {
      const { inputs, inputDeclarations, ...rest } = event;
      const line =
        JSON.stringify({
          runId,
          seq: seq++,
          timestamp: new Date().toISOString(),
          ...rest,
          ...(inputs ? { inputs: inputDeclarations ? redactInputs(inputs, inputDeclarations) : inputs } : {}),
        }) + '\n';
      appendFileSync(evidencePath, line, 'utf-8');
      appendFileSync(auditPath, line, 'utf-8');
    },

    journal(entry, durable = false) {
      const line = JSON.stringify({ runId, seq: journalSeq++, timestamp: new Date().toISOString(), ...entry }) + '\n';
      if (durable) appendDurable(journalPath, line);
      else appendFileSync(journalPath, line, 'utf-8');
    },
  };
}
