import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCENARIOS, scenarioById } from '../src/events-help/lifecycle';

interface SyntaxEntry {
  owner: string;
  nameRu: string;
  kind: string;
}

const fullJsonPath = fileURLToPath(
  new URL('../public/reference/syntax-help-full.json', import.meta.url),
);

/** Все имена событий из выгрузки в виде `<owner>.<nameRu>`. */
const knownEventIds = new Set<string>(
  (
    JSON.parse(readFileSync(fullJsonPath, 'utf8')) as { entries: SyntaxEntry[] }
  ).entries
    .filter((e) => e.kind === 'event')
    .map((e) => `${e.owner}.${e.nameRu}`),
);

describe('SCENARIOS — целостность данных', () => {
  it('у каждого сценария уникальный id', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scenarioById возвращает сценарий', () => {
    expect(scenarioById('write-document')?.title).toBeTruthy();
    expect(scenarioById('nonexistent')).toBeNull();
  });

  it('у каждого шага уникальный id внутри сценария', () => {
    for (const s of SCENARIOS) {
      const ids = s.steps.map((st) => st.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('swimlane каждого шага существует в swimlanes сценария', () => {
    for (const s of SCENARIOS) {
      const lanes = new Set(s.swimlanes.map((l) => l.id));
      for (const step of s.steps) {
        expect(lanes.has(step.swimlane)).toBe(true);
      }
    }
  });

  it('каждое событие сценария существует в выгрузке СП', () => {
    const missing: string[] = [];
    for (const s of SCENARIOS) {
      for (const step of s.steps) {
        if (!knownEventIds.has(step.event)) missing.push(`${s.id}/${step.id}: ${step.event}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
