// frontend/src/components/PrimaryButton.tsx
import { ButtonHTMLAttributes } from 'react';

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Adds a periodic light-sweep glint to draw attention to this CTA. */
  shiny?: boolean;
}

export function PrimaryButton({
  children,
  className = '',
  type = 'button',
  shiny = false,
  disabled,
  ...props
}: PrimaryButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={`w-full rounded-full bg-ios-blue py-3.5 font-semibold text-white transition-transform duration-150 active:scale-[0.97] active:bg-ios-blue-pressed disabled:opacity-40 disabled:active:scale-100 ${
        shiny && !disabled
          ? 'animate-shine bg-no-repeat bg-[length:200%_100%] bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.6)_50%,transparent_75%)]'
          : ''
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
