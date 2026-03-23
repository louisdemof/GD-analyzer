// PDF generation placeholder — will be implemented with @react-pdf/renderer
// This module exports functions to generate PDF proposal documents

import type { Project, SimulationResult } from './types';

export interface PDFData {
  project: Project;
  result: SimulationResult;
  generatedAt: string;
}

export function preparePDFData(project: Project, result: SimulationResult): PDFData {
  return {
    project,
    result,
    generatedAt: new Date().toISOString(),
  };
}
