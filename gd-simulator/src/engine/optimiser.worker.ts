import { optimiseRateio } from './optimiser';
import { computeDerivedTariffs } from './tariff';
import type { Project } from './types';

self.onmessage = (e: MessageEvent<{ project: Project }>) => {
  // Strip runAttribution before optimization: the 5-scenario decomposition is for
  // display only, never for fitness evaluation. Leaving it on makes each evaluator
  // call 2.5× slower and pushes the optimizer past the 60s timeout.
  const project = {
    ...e.data.project,
    scenarios: { ...e.data.project.scenarios, runAttribution: false },
    distributor: computeDerivedTariffs(e.data.project.distributor),
  };

  const result = optimiseRateio(project, (p) => {
    self.postMessage({ type: 'progress', ...p });
  });

  self.postMessage({ type: 'done', result });
};
