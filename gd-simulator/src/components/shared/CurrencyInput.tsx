import { useState, useCallback, useEffect } from 'react';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  prefix?: string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  decimals?: number;
  showOverride?: boolean;
}

export function CurrencyInput({
  value,
  onChange,
  label,
  prefix,
  suffix,
  className = '',
  disabled,
  decimals = 4,
  showOverride,
}: CurrencyInputProps) {
  const [display, setDisplay] = useState(value.toFixed(decimals));
  const [focused, setFocused] = useState(false);

  // Sync display when value changes externally (not during user editing)
  useEffect(() => {
    if (!focused) {
      setDisplay(value.toFixed(decimals));
    }
  }, [value, decimals, focused]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    const parsed = parseFloat(display.replace(',', '.'));
    if (!isNaN(parsed)) {
      onChange(parsed);
      setDisplay(parsed.toFixed(decimals));
    } else {
      setDisplay(value.toFixed(decimals));
    }
  }, [display, onChange, value, decimals]);

  return (
    <div className={className}>
      {label && (
        <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700 mb-1.5">
          {label}
          {showOverride && (
            <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Valor modificado do padrão ANEEL" />
          )}
        </label>
      )}
      <div className="relative flex items-center">
        {prefix && (
          <span className="absolute left-3 text-slate-400 text-xs pointer-events-none select-none">
            {prefix}
          </span>
        )}
        <input
          type="text"
          value={display}
          onChange={e => setDisplay(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          disabled={disabled}
          className={`w-full py-2 border border-slate-300 rounded-lg text-sm font-mono text-right
            focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
            disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed
            ${prefix ? 'pl-14' : 'pl-3'}
            ${suffix ? 'pr-16' : 'pr-3'}`}
        />
        {suffix && (
          <span className="absolute right-3 text-slate-400 text-xs pointer-events-none select-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
