import React, { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { blockRelocationWhileTrading } from '../Replay/replayGuards';

const DISMISSED_KEY = 'onboarding-dismissed-v1';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Stockage indisponible : le guide réapparaîtra, rien de plus.
  }
}

/**
 * First-run guide: data → starting point → order → journal.
 *
 * The app loads EUR/USD on its own at start-up, so the empty-state welcome
 * almost never showed and a newcomer faced a chart with no hint that the
 * product is a *replay*: nothing said to pick a start, then trade, then read
 * the journal. Each step ticks itself from the real state of the stores — no
 * separate progress to keep in sync — and the guide stays out of the way once
 * dismissed or completed.
 */
export const OnboardingGuide: React.FC = () => {
  const [dismissed, setDismissed] = useState(readDismissed);

  const hasData = useMarketStore((s) => s.displayCandles.length > 0);
  const isReplayActive = useReplayStore((s) => s.isActive);
  const isPicking = useReplayStore((s) => s.isPicking);
  const hasTraded = useTradeStore(
    (s) => s.openPositions.length > 0 || s.pendingOrders.length > 0 || s.closedPositions.length > 0
  );
  const hasClosed = useTradeStore((s) => s.closedPositions.length > 0);
  const activeModal = useUIStore((s) => s.activeModal);

  if (dismissed || activeModal !== null || isPicking) return null;

  const steps = [
    {
      done: hasData,
      title: 'Choisir des données',
      detail: 'Un instrument du catalogue ou votre propre fichier CSV.',
      actions: [
        { label: 'Instrument', run: () => useUIStore.getState().openModal('live') },
        { label: 'Importer', run: () => useUIStore.getState().openModal('import') },
      ],
    },
    {
      done: isReplayActive,
      title: 'Choisir un point de départ',
      detail: 'Le graphique est masqué au-delà : vous découvrez la suite bougie par bougie.',
      actions: [
        {
          label: 'Démarrer',
          run: () => {
            if (blockRelocationWhileTrading('Démarrer un replay')) return;
            useReplayStore.getState().setIsPicking(true);
          },
        },
      ],
    },
    {
      done: hasTraded,
      title: 'Passer un ordre',
      detail: 'Acheter ou Vendre dans la barre du bas, avec un stop : le volume se calcule depuis votre risque.',
      actions: [],
    },
    {
      done: hasClosed,
      title: 'Lire vos résultats',
      detail: 'Espérance, drawdown et courbe du capital dans le journal.',
      actions: [{ label: 'Journal', run: () => useUIStore.getState().openModal('trade-history') }],
    },
  ];

  if (steps.every((s) => s.done)) return null;
  const current = steps.findIndex((s) => !s.done);

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <aside className="onboarding" aria-label="Premiers pas">
      <div className="onboarding-header">
        <span>Premiers pas</span>
        <button type="button" className="onboarding-close" onClick={dismiss} aria-label="Masquer le guide">
          <X size={13} strokeWidth={2.4} />
        </button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={`onboarding-step${step.done ? ' is-done' : ''}${i === current ? ' is-current' : ''}`}
          >
            <span className="onboarding-marker" aria-hidden>
              {step.done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <div className="onboarding-body">
              <div className="onboarding-title">
                {step.title}
                {step.done && <span className="sr-only"> — fait</span>}
              </div>
              {i === current && (
                <>
                  <p className="onboarding-detail">{step.detail}</p>
                  {step.actions.length > 0 && (
                    <div className="onboarding-actions">
                      {step.actions.map((action) => (
                        <button key={action.label} type="button" className="btn-sm" onClick={action.run}>
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
};
