import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const getVariantStyles = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        };
      case 'secondary':
        return {
          background: 'rgba(255, 255, 255, 0.06)',
          color: '#e2e8f0',
          border: '1px solid rgba(255, 255, 255, 0.12)',
        };
      case 'danger':
        return {
          background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(244, 63, 94, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        };
      case 'warning':
        return {
          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          color: '#ffffff',
          boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
        };
      case 'ghost':
        return {
          background: 'transparent',
          color: '#94a3b8',
          border: 'none',
        };
    }
  };

  const getSizeStyles = (): React.CSSProperties => {
    switch (size) {
      case 'sm':
        return { padding: '6px 12px', fontSize: '0.8125rem' };
      case 'md':
        return { padding: '10px 18px', fontSize: '0.875rem' };
      case 'lg':
        return { padding: '13px 24px', fontSize: '1rem' };
    }
  };

  return (
    <button
      disabled={disabled || loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        borderRadius: 'var(--radius-md)',
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        ...getVariantStyles(),
        ...getSizeStyles(),
        ...style,
      }}
      className={className}
      {...props}
    >
      {loading ? (
        <span
          style={{
            width: '16px',
            height: '16px',
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#ffffff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
};
