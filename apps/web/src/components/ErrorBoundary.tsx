import React from 'react';
import i18n from '@/i18n';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('failed to fetch')
  );
}

const RELOAD_KEY = 'errorBoundaryReload';

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Unhandled React render error:', error, errorInfo);

    if (isChunkLoadError(error)) {
      const attempts = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
      if (attempts < 1) {
        sessionStorage.setItem(RELOAD_KEY, String(attempts + 1));
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(RELOAD_KEY);
    }
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
