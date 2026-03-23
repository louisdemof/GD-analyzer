import { optimiseRateio } from './optimiser';
import { computeDerivedTariffs } from './tariff';
import type { Project } from './types';

self.onmessage = (e: MessageEvent<{ project: Project }>) => {
  const project = {
    ...e.data.project,
    distributor: computeDerivedTariffs(e.data.project.distributor),
  };

  const result = optimiseRateio(project, (p) => {
    self.postMessage({ type: 'progress', ...p });
  });

  self.postMessage({ type: 'done', result });
};
