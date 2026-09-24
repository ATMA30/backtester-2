import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  /** Zone protégée, citée dans le message : « la barre de replay », … */
  label?: string;
  /**
   * Rendu réduit, pour une zone secondaire (barre, modale) : un encart qui ne
   * recouvre pas le reste de l'application encore fonctionnel.
   */
  compact?: boolean;
  /** Appelé par « Fermer » en mode réduit, avant la remise à zéro. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Render-error guard.
 *
 * It used to wrap the chart alone: a throw in the replay bar, the top bar or a
 * modal still unmounted the whole application and left a blank page. The root
 * now has one (`main.tsx`), and each secondary zone has its own compact one so
 * that a broken dialog does not take the chart and the account down with it.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[UI] Unhandled render error:', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  private handleHardReset = (): void => {
    try {
      localStorage.clear();
    } catch {
      // Storage may be unavailable; reloading is still worth attempting.
    }
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.compact) {
      return (
        <div className="error-boundary error-boundary-compact" role="alert">
          <AlertTriangle size={16} strokeWidth={2} aria-hidden />
          <p>
            {this.props.label ? `Erreur dans ${this.props.label}.` : 'Erreur d’affichage.'} Le graphique et
            votre compte ne sont pas affectés.
          </p>
          <div className="error-boundary-actions">
            <button type="button" onClick={this.handleReset}>
              Fermer
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="error-boundary" role="alert">
        <AlertTriangle size={30} strokeWidth={1.8} aria-hidden />
        <h2>Une erreur est survenue dans l’interface</h2>
        <p className="error-boundary-detail">{error.message}</p>
        <div className="error-boundary-actions">
          <button type="button" onClick={this.handleReset}>
            Réessayer
          </button>
          <button type="button" onClick={this.handleHardReset}>
            Réinitialiser la session
          </button>
        </div>
      </div>
    );
  }
}
