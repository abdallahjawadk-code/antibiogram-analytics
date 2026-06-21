import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Without this, any render-time exception unmounts
 * the whole React tree and the user is left with a blank white window (and in
 * Electron, no way to recover short of restarting). Bilingual and standalone
 * because it sits above the LanguageProvider.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8fafc',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 480,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 24,
          padding: 32,
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Something went wrong · حدث خطأ غير متوقع
          </h1>
          <p style={{ color: '#64748b', marginTop: 12 }}>
            The application encountered an unexpected error.<br />
            واجه التطبيق خطأً غير متوقع. حاول إعادة التحميل.
          </p>
          <pre style={{
            textAlign: 'left',
            direction: 'ltr',
            background: '#f1f5f9',
            borderRadius: 12,
            padding: 12,
            marginTop: 16,
            fontSize: 12,
            color: '#475569',
            overflow: 'auto',
            maxHeight: 160,
          }}>{this.state.error.message}</pre>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: 20,
              padding: '12px 24px',
              border: 'none',
              borderRadius: 16,
              background: 'linear-gradient(to right, #14b8a6, #0891b2)',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload · إعادة التحميل
          </button>
        </div>
      </div>
    );
  }
}
