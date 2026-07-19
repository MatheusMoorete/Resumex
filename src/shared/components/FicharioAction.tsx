import type { ButtonHTMLAttributes, ReactNode } from 'react';

type FicharioActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  interactive?: boolean;
};

export default function FicharioAction({
  children,
  className = '',
  interactive = false,
  type = 'button',
  ...buttonProps
}: FicharioActionProps) {
  const classes = `fichario-action ${className}`.trim();

  if (!interactive) {
    return <span className={classes}>{children}</span>;
  }

  return (
    <button className={classes} type={type} {...buttonProps}>
      {children}
    </button>
  );
}
