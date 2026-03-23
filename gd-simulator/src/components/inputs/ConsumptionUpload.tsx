import { useCallback } from 'react';
import Papa from 'papaparse';

interface Props {
  ucId: string;
  ucName: string;
  isGrupoA: boolean;
  onDataLoaded: (fp: number[], pt: number[]) => void;
}

export function ConsumptionUpload({ ucId, ucName, isGrupoA, onDataLoaded }: Props) {
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fp: number[] = [];
        const pt: number[] = [];

        for (const row of results.data as Record<string, string>[]) {
          if (isGrupoA) {
            fp.push(parseFloat(row.kwh_fora_ponta || row.kWh_FP || '0') || 0);
            pt.push(parseFloat(row.kwh_ponta || row.kWh_PT || '0') || 0);
          } else {
            const total = parseFloat(row.kwh_total || row.kwh || row.kWh || '0') || 0;
            fp.push(total);
            pt.push(0);
          }
        }

        // Pad or trim to 24 months
        while (fp.length < 24) fp.push(fp[fp.length - 1] || 0);
        while (pt.length < 24) pt.push(pt[pt.length - 1] || 0);

        onDataLoaded(fp.slice(0, 24), pt.slice(0, 24));
      },
    });
  }, [isGrupoA, onDataLoaded]);

  const downloadTemplate = () => {
    const header = isGrupoA ? 'month,kwh_fora_ponta,kwh_ponta' : 'month,kwh_total';
    const rows = Array.from({ length: 24 }, (_, i) => {
      const date = new Date(2026, 5 + i, 1);
      const month = date.toISOString().slice(0, 7);
      return isGrupoA ? `${month},0,0` : `${month},0`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consumo_${ucName.toLowerCase().replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-3">
      <label className="flex-1 cursor-pointer">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-3 text-center hover:border-teal-400 transition-colors">
          <p className="text-xs text-slate-500">Upload CSV consumo — {ucName}</p>
          <input type="file" accept=".csv,.xlsx" onChange={handleFile} className="hidden" />
        </div>
      </label>
      <button
        onClick={downloadTemplate}
        className="text-xs text-teal-600 hover:text-teal-800 underline"
      >
        Template
      </button>
    </div>
  );
}
