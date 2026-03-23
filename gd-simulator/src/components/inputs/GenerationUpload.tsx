import { useCallback } from 'react';
import Papa from 'papaparse';

interface Props {
  onDataLoaded: (profile: number[]) => void;
}

export function GenerationUpload({ onDataLoaded }: Props) {
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const profile: number[] = [];
        for (const row of results.data as Record<string, string>[]) {
          const kwh = parseFloat(row.kwh || row.kWh || row.generation || '0') || 0;
          profile.push(kwh);
        }

        // Pad or trim to 24 months
        while (profile.length < 24) {
          const avg = profile.length > 0
            ? profile.reduce((a, b) => a + b, 0) / profile.length
            : 0;
          profile.push(avg);
        }

        onDataLoaded(profile.slice(0, 24));
      },
    });
  }, [onDataLoaded]);

  const downloadTemplate = () => {
    const header = 'month,kwh';
    const rows = Array.from({ length: 24 }, (_, i) => {
      const date = new Date(2026, 5 + i, 1);
      return `${date.toISOString().slice(0, 7)},0`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generation_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-3">
      <label className="flex-1 cursor-pointer">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-3 text-center hover:border-teal-400 transition-colors">
          <p className="text-xs text-slate-500">Upload CSV perfil de geração (kWh/mês)</p>
          <input type="file" accept=".csv,.xlsx" onChange={handleFile} className="hidden" />
        </div>
      </label>
      <button onClick={downloadTemplate} className="text-xs text-teal-600 hover:text-teal-800 underline">
        Template
      </button>
    </div>
  );
}
