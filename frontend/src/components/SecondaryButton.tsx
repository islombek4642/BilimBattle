// frontend/src/components/SecondaryButton.tsx
import { ButtonHTMLAttributes } from 'react';

export function SecondaryButton({
  children,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`w-full rounded-lg bg-gray-200 py-3 font-semibold text-gray-800 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
