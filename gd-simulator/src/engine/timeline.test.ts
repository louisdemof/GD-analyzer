import { describe, it, expect } from 'vitest';
import { timelineWarnings, lastPpaEndIndex } from './timeline';
import type { Project, Plant } from './types';

function plant(over: Partial<Plant> = {}): Plant {
  return {
    id: 'p', name: 'Usina', capacityKWac: 1000, distributor: 'd',
    p50Profile: new Array(24).fill(1000), useActual: false,
    ppaRateRsBRLkWh: 0.45, contractStartMonth: '2026-06', contractMonths: 24,
    ...over,
  } as Plant;
}
function proj(over: Partial<Project> = {}): Project {
  return { id: 'x', clientName: 'C', plant: plant(), ucs: [], rateio: { periods: [], isOptimised: false }, ...over } as unknown as Project;
}

describe('timelineWarnings', () => {
  it('is clean for a well-formed future-dated project', () => {
    expect(timelineWarnings(proj(), '2026-01')).toEqual([]);
  });

  it('errors on a missing/invalid start date', () => {
    expect(timelineWarnings(proj({ plant: plant({ contractStartMonth: '' }) }))
      .some(w => w.level === 'error')).toBe(true);
    expect(timelineWarnings(proj({ plant: plant({ contractStartMonth: '2026-13' }) }))
      .some(w => w.level === 'error')).toBe(true);
  });

  it('warns when the start date is in the past', () => {
    const w = timelineWarnings(proj({ plant: plant({ contractStartMonth: '2026-04' }) }), '2026-06');
    expect(w.some(x => x.level === 'warning' && /passado/.test(x.message))).toBe(true);
  });

  it('warns when simulationMonths truncates a longer PPA', () => {
    const w = timelineWarnings(proj({ plant: plant({ contractMonths: 60 }), simulationMonths: 24 }), '2026-01');
    expect(w.some(x => /truncad/.test(x.message))).toBe(true);
  });

  it('warns when an additional plant has a different start date (no offset support)', () => {
    const w = timelineWarnings(proj({ additionalPlants: [plant({ contractStartMonth: '2027-01' })] }), '2026-01');
    expect(w.some(x => /início diferente/.test(x.message))).toBe(true);
  });

  it('flags an atypical (non-multiple-of-6) PPA term', () => {
    const w = timelineWarnings(proj({ plant: plant({ contractMonths: 15 }) }), '2026-01');
    expect(w.some(x => /atípico/.test(x.message))).toBe(true);
  });
});

describe('lastPpaEndIndex', () => {
  it('is the longest plant PPA (capped at horizon), 0-based', () => {
    expect(lastPpaEndIndex(proj({ plant: plant({ contractMonths: 24 }) }))).toBe(23);
    // additional plant longer than main → uses the longer one
    expect(lastPpaEndIndex(proj({ plant: plant({ contractMonths: 18 }), additionalPlants: [plant({ contractMonths: 24 })], simulationMonths: 24 }))).toBe(23);
  });
});
