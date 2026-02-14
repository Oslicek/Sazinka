import React from 'react';
import i18n from '@/i18n';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Intentionally keep this as console.error for production diagnostics.
    console.error('Unhandled React render error:', error, errorInfo);
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '12px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <h1>{i18n.t('nav:error_title')}</h1>
          <p>{i18n.t('nav:error_message')}</p>
          <button type="button" onClick={this.handleReload}>
            {i18n.t('nav:error_reload')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
