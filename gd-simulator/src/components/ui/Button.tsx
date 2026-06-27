import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'navy' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

// Single source of truth for button styling. Replaces the many one-off button
// styles across the app so importance is legible at a glance.
const VARIANTS: Record<Variant, string> = {
  primary:   'bg-brand-teal text-white hover:bg-brand-teal-700 border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  navy:      'bg-brand-navy text-white hover:bg-brand-navy-700 border border-transparent',
  ghost:     'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent',
  danger:    'bg-white text-red-600 border border-red-300 hover:bg-red-50',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {children}
    </button>
  );
}
