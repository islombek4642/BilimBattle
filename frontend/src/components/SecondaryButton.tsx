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
      className={`w-full rounded-full bg-ios-divider py-3.5 font-semibold text-ios-label transition-transform duration-150 active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
