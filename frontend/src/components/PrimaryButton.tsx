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
      className={`w-full rounded-full bg-ios-blue py-3.5 font-semibold text-white transition-transform duration-150 active:scale-[0.97] active:bg-ios-blue-pressed disabled:opacity-40 disabled:active:scale-100 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
