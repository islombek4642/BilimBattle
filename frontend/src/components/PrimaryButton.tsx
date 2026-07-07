// frontend/src/components/PrimaryButton.tsx
import { ButtonHTMLAttributes } from 'react';

export function PrimaryButton({
  children,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`w-full rounded-lg bg-blue-600 py-3 font-semibold text-white disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
