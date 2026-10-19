import { createEmptyJob, type RestorationJobData } from '../types/jobData';
import {
  applyAiExtractionToJob, applyIntakeCandidates, getIntakeFieldValue, intakeValuesEqual, parseRawIntakeText,
  SECTION_LABELS, type AiIntakePayload, type ExtractedFieldSummary, type IntakeFieldCandidate,
  type IntakeParseResult, type ProvenanceRecord,
} from './intakeParser';

export type ExtractionStatus = 'idle' | 'running' | 'success' | 'empty' | 'error';
interface MethodOutcome { status: ExtractionStatus; fields: number; error?: string }
export interface IntakeConflict {
  key: string;
  candidate: IntakeFieldCandidate;
  currentValue: unknown;
}
export interface IntakeExtractionState {
  local: MethodOutcome;
  ai: MethodOutcome;
  conflicts: IntakeConflict[];
  result?: IntakeParseResult;
}
interface Dependencies {
  getJob: () => RestorationJobData;
  getProvenance: () => ProvenanceRecord;
  apply: (result: IntakeParseResult) => void;
  onChange: (state: IntakeExtractionState) => void;
  analyzeAi: (text: string, signal?: AbortSignal) => Promise<AiIntakePayload>;
  parseLocal?: typeof parseRawIntakeText;
}
const idle = (): MethodOutcome => ({ status: 'idle', fields: 0 });
export const emptyIntakeState = (): IntakeExtractionState => ({ local: idle(), ai: idle(), conflicts: [] });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Independent extraction lifetimes plus a conservative merge into the current job. */
export class IntakeCoordinator {
  state = emptyIntakeState();
  private generation = 0;
  private controller?: AbortController;
  private text = '';
  private baseline?: RestorationJobData;
  private defaults = createEmptyJob();
  private localKeys = new Set<string>();
  private reviewed = new Set<string>();
  private generated = new Set<string>();
  private found = new Map<string, IntakeFieldCandidate>();
  private summaries = new Map<string, ExtractedFieldSummary>();
  private localWarnings: string[] = [];
  private aiWarnings: string[] = [];
  private aiNotes?: string;

  constructor(private deps: Dependencies) {}

  cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
  }

  async start(text: string) {
    this.cancel();
    this.text = text.trim();
    this.state = emptyIntakeState();
    this.localKeys.clear();
    this.reviewed.clear();
    this.generated.clear();
    this.found.clear();
    this.summaries.clear();
    this.localWarnings = [];
    this.aiWarnings = [];
    this.aiNotes = undefined;
    if (!this.text) { this.publish(); return; }
    this.state.local = { status: 'running', fields: 0 };
    this.publish();
    try {
      // Extract independently of existing record values and generated defaults.
      const result = (this.deps.parseLocal ?? parseRawIntakeText)(this.text);
      const candidates = this.uniqueCandidates(result).filter(candidate => !candidate.onlyIfEmpty || !getIntakeFieldValue(this.deps.getJob(), candidate));
      this.localWarnings = result.extractionSummary.warnings;
      this.state.local = { status: candidates.length ? 'success' : 'empty', fields: candidates.length };
      for (const candidate of candidates) {
        this.localKeys.add(candidate.key);
        this.found.set(candidate.key, candidate);
      }
      this.commit(candidates, 'local');
    } catch (error) {
      this.state.local = { status: 'error', fields: 0, error: this.message(error) };
    }
    this.baseline = clone(this.deps.getJob());
    this.publish();
    await this.runAi();
  }

  async retryAi() {
    if (!this.text || this.state.ai.status === 'running') return;
    await this.runAi();
  }

  resolveConflict(key: string, useAi: boolean) {
    const conflict = this.state.conflicts.find(c => c.key === key);
    if (!conflict) return;
    // The user explicitly chooses this one field against the latest record.
    if (useAi) this.commit([conflict.candidate], 'ai');
    this.reviewed.add(key);
    this.state.conflicts = this.state.conflicts.filter(c => c.key !== key);
    this.publish();
  }

  private uniqueCandidates(result: IntakeParseResult) {
    return [...new Map((result.candidates ?? []).map(candidate => [candidate.key, candidate])).values()];
  }

  private async runAi() {
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.state.ai = { status: 'running', fields: 0 };
    this.aiWarnings = [];
    this.publish();
    // One deadline includes the request, body parsing, and all transport retries.
    const timer = setTimeout(() => controller.abort(new Error('AI analysis timed out after 60 seconds.')), 60_000);
    let onAbort: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new Error('AI analysis cancelled.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const payload = await Promise.race([this.deps.analyzeAi(this.text, controller.signal), aborted]);
      if (generation !== this.generation) return;
      const result = applyAiExtractionToJob(payload);
      const candidates = this.uniqueCandidates(result);
      this.aiWarnings = result.extractionSummary.warnings;
      this.aiNotes = result.extractionSummary.aiNotes;
      this.state.ai = { status: candidates.length ? 'success' : 'empty', fields: candidates.length };
      const job = this.deps.getJob();
      const provenance = this.deps.getProvenance();
      const accepted: IntakeFieldCandidate[] = [];
      for (const candidate of candidates) {
        this.found.set(candidate.key, candidate);
        if (this.reviewed.has(candidate.key)) continue;
        const current = getIntakeFieldValue(job, candidate);
        if (intakeValuesEqual(candidate, current)) continue;
        const baseline = getIntakeFieldValue(this.baseline!, candidate);
        const edited = !intakeValuesEqual({ ...candidate, value: baseline as IntakeFieldCandidate['value'] }, current);
        const blank = current === '' || current === null || current === undefined;
        const defaultValue = getIntakeFieldValue(this.defaults, candidate);
        const isDefault = current === defaultValue && provenance[candidate.key]?.source !== 'EXTRACTED';
        if (edited || this.localKeys.has(candidate.key) || (!blank && !isDefault && !this.generated.has(candidate.key))) {
          const conflict = { key: candidate.key, candidate, currentValue: current };
          this.state.conflicts = [...this.state.conflicts.filter(c => c.key !== candidate.key), conflict];
        } else accepted.push(candidate);
      }
      this.commit(accepted, 'ai');
    } catch (error) {
      if (generation !== this.generation) return;
      this.state.ai = { status: 'error', fields: 0, error: this.message(error) };
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort!);
      if (generation === this.generation) this.publish();
    }
  }

  private commit(candidates: IntakeFieldCandidate[], method: 'local' | 'ai') {
    if (!candidates.length) return;
    const result = applyIntakeCandidates(candidates, this.deps.getJob(), this.deps.getProvenance(), method, method === 'ai' ? this.baseline : undefined);
    for (const section of result.extractionSummary.sections) {
      for (const field of section.fields) {
        if (method === 'local' && field.source !== 'EXTRACTED' && field.changed) this.generated.add(field.key);
        this.summaries.set(field.key, { ...field, changed: field.changed || this.summaries.get(field.key)?.changed || false });
      }
    }
    this.deps.apply(result);
  }

  private publish() {
    if (this.found.size) {
      const result = applyIntakeCandidates([], this.deps.getJob(), this.deps.getProvenance(), 'local');
      result.extractionSummary = {
        fieldsExtractedCount: this.found.size,
        fieldsUpdatedCount: [...this.summaries.values()].filter(f => f.changed && this.found.has(f.key)).length,
        sections: (Object.keys(SECTION_LABELS) as Array<keyof typeof SECTION_LABELS>)
          .map(section => ({ section, label: SECTION_LABELS[section], fields: [...this.summaries.values()].filter(f => f.section === section) }))
          .filter(section => section.fields.length > 0),
        warnings: [...this.localWarnings, ...this.aiWarnings], aiNotes: this.aiNotes,
      };
      this.state.result = result;
    }
    this.state = { ...this.state };
    this.deps.onChange(this.state);
  }

  private message(error: unknown) { return error instanceof Error ? error.message : String(error); }
}
