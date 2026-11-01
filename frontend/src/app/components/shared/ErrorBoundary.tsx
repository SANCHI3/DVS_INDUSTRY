import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface State {
  failed: boolean;
}

/**
 * Last line of defence: a rendering error anywhere below shows a friendly
 * screen with a reload button instead of a blank white page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled rendering error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center p-6" style={{ background: "#FAFAFA", fontFamily: "'Inter', sans-serif" }}>
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#FFEBEE" }}>
            <AlertCircle size={26} color="#C0392B" />
          </div>
          <h1 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#1C1C1C", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ fontSize: "0.875rem", color: "#7A6C6A", lineHeight: 1.6, marginBottom: "1.25rem" }}>
            This page hit a problem it could not recover from. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg"
            style={{ background: "#A52A2A", color: "#fff", border: "none", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}
          >
            <RefreshCw size={15} /> Reload
          </button>
        </div>
      </div>
    );
  }
}
