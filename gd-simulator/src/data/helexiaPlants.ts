import plantsData from './helexia-plants.json';

export interface HelexiaPlant {
  codigo: string;
  nome: string;
  distribuidora: string;
  status: string;
  cliente: string;
  potenciaAC: number;
  potenciaDC: number;
  anoExposicaoSolar: number;
  anoGeracao: number;
  geracaoMensalP50: number[]; // 12 months Jan-Dec, MWh
  geracaoAnualP50: number;
  geracaoAnualAtual: number;
}

export const HELEXIA_PLANTS: HelexiaPlant[] = plantsData.plants as HelexiaPlant[];

export function build24MonthProfile(
  plant: HelexiaPlant,
  contractStartMonth: string,
  annualDegradationPct: number = 0.005,
  annualLossPct: number = 0,
): number[] {
  const [, monthStr] = contractStartMonth.split('-');
  const startMonthIdx = parseInt(monthStr, 10) - 1; // 0=Jan
  const profile: number[] = [];
  for (let m = 0; m < 24; m++) {
    const calMonthIdx = (startMonthIdx + m) % 12;
    const operationYear = plant.anoGeracao + Math.floor(m / 12);
    const degradationFactor = Math.pow(
      1 - annualDegradationPct - annualLossPct,
      Math.max(0, operationYear - 1)
    );
    const baseGenKWh = plant.geracaoMensalP50[calMonthIdx] * 1000;
    profile.push(Math.round(baseGenKWh * degradationFactor));
  }
  return profile;
}

// Group plants by distribuidora for dropdown
export function getPlantsByDistribuidora(): Map<string, HelexiaPlant[]> {
  const grouped = new Map<string, HelexiaPlant[]>();
  for (const plant of HELEXIA_PLANTS) {
    const dist = plant.distribuidora || 'Outros';
    if (!grouped.has(dist)) grouped.set(dist, []);
    grouped.get(dist)!.push(plant);
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}
