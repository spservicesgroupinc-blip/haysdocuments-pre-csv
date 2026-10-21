/** Deployment gates only; stored workflow data and the revision protocol remain intact. */
export function parseWorkflowRelease(value: unknown): 0 | 1 | 2 | 3 {
  if (value === undefined || value === '') return 3;
  return ['0', '1', '2', '3'].includes(String(value)) ? Number(value) as 0 | 1 | 2 | 3 : 0;
}
export const WORKFLOW_RELEASE = parseWorkflowRelease(import.meta.env?.VITE_WORKFLOW_RELEASE);
export function workflowSectionEnabled(section: string): boolean {
  const minimum: Record<string, number> = { updates: 1, handoff: 1, selections: 2, changeOrder: 2, closeout: 3 };
  return minimum[section] === undefined || WORKFLOW_RELEASE >= minimum[section];
}
