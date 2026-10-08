import React from 'react';
import { Globe } from 'lucide-react';
import { useMarketStore, TIMEFRAME_DEFS } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';
import { supportsSessions } from '../../domain/timeframes';

type SessionKey = 'sydney' | 'tokyo' | 'london' | 'newyork' | 'asianRange' | 'londonOpenKZ' | 'nyOpenKZ' | 'londonCloseKZ';

interface SessionRow {
  readonly key: SessionKey;
  readonly name: string;
  readonly hours: string;
  /** Class giving the dot the colour the chart paints the session in. */
  readonly dot: string;
}

const MAJOR_SESSIONS: readonly SessionRow[] = [
  { key: 'sydney', name: 'Sydney', hours: '22h – 07h', dot: 'session-dot-sydney' },
  { key: 'tokyo', name: 'Tokyo', hours: '00h – 09h', dot: 'session-dot-tokyo' },
  { key: 'london', name: 'Londres', hours: '08h – 17h', dot: 'session-dot-london' },
  { key: 'newyork', name: 'New York', hours: '13h – 22h', dot: 'session-dot-newyork' },
];

const KILLZONES: readonly SessionRow[] = [
  { key: 'asianRange', name: 'Asian Range', hours: '00h – 06h', dot: 'session-dot-asian-range' },
  { key: 'londonOpenKZ', name: 'London Open KZ', hours: '07h – 10h', dot: 'session-dot-london-open' },
  { key: 'nyOpenKZ', name: 'NY Open KZ', hours: '12h – 15h', dot: 'session-dot-ny-open' },
  { key: 'londonCloseKZ', name: 'London Close KZ', hours: '15h – 17h', dot: 'session-dot-london-close' },
];

const ALL_SESSIONS = [...MAJOR_SESSIONS, ...KILLZONES];

/** A menu row must not close the menu: it is a label, and labels bubble. */
const keepOpen = (e: React.MouseEvent) => e.stopPropagation();

/** Market sessions and ICT killzones drawn over intraday charts. */
export const SessionsMenu: React.FC = () => {
  const forexSessions = useMarketStore((m) => m.forexSessions);
  const activeTF = useMarketStore((m) => m.activeTF);
  const toggleForexSession = useMarketStore((m) => m.toggleForexSession);
  const toggleForexLocalTz = useMarketStore((m) => m.toggleForexLocalTz);
  const { activeDropdown, toggleDropdown } = useUIStore();

  /** Les séances de marché exigent une résolution intraday. */
  const sessionsAvailable = supportsSessions(activeTF);
  /** Au moins une séance ou killzone cochée. */
  const anySessionOn = ALL_SESSIONS.some((s) => forexSessions[s.key]);
  const currentTFDef = TIMEFRAME_DEFS.find((t) => t.s === activeTF) || { label: '1D' };

  const sessionRow = (s: SessionRow) => (
    <label key={s.key} className="forex-session-row" onClick={keepOpen}>
      <span className={`forex-dot ${s.dot}`} />
      <span className="forex-name">{s.name}</span>
      <span className="forex-hours">{s.hours}</span>
      <input type="checkbox" checked={forexSessions[s.key]} onChange={() => toggleForexSession(s.key)} />
    </label>
  );

  const optionRow = (name: string, checked: boolean, onChange: () => void) => (
    <label className="forex-session-row" onClick={keepOpen}>
      <span className="forex-name">{name}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  );

  return (
    <div className="tv-dropdown">
      <button
        className={`tv-icon-btn ${anySessionOn ? 'active' : ''}`}
        id="btn-forex"
        onClick={() => toggleDropdown('forex')}
        title="Séances de marché"
      >
        <Globe size={16} strokeWidth={1.8} />
      </button>
      {activeDropdown === 'forex' && (
        <div
          className={`tv-dropdown-menu forex-menu show ${sessionsAvailable ? '' : 'sessions-unavailable'} sessions-menu-list`}
        >
          {/* Une bougie journalière couvre Tokyo, Londres et New York à la
              fois : les séances n'ont alors aucun sens. Les cases étaient
              malgré tout cochables et ne produisaient rien. */}
          {!sessionsAvailable && (
            <div className="sessions-notice">
              Les séances demandent une unité de temps de <strong>1 h ou moins</strong>.
              En {currentTFDef.label}, une bougie couvre toutes les séances à la fois.
            </div>
          )}

          <div className="sep-menu-title sessions-group-title">
            <span>Séances principales</span>
            <span className="sessions-toggle-all"
              onClick={(e) => { e.stopPropagation(); toggleForexSession('all'); }}
            >
              Tout basculer
            </span>
          </div>
          {MAJOR_SESSIONS.map(sessionRow)}

          <div className="dropdown-divider" />

          <div className="sep-menu-title sessions-group-title">
            <span>Killzones ICT / SMC</span>
            <span className="sessions-toggle-all"
              onClick={(e) => { e.stopPropagation(); toggleForexSession('all_kz'); }}
            >
              Tout basculer
            </span>
          </div>
          {KILLZONES.map(sessionRow)}

          <div className="dropdown-divider" />

          {/* Séance active mais rien à voir : sans ces deux options, seul
              l'ombrage subsiste et rien n'explique la disparition des
              boîtes et des étiquettes. */}
          {sessionsAvailable && anySessionOn && !forexSessions.showHighLow && !forexSessions.showLabels && (
            <div className="sessions-notice">
              Séance active, mais ni extrêmes ni étiquettes : seul l’ombrage s’affiche.
              Cochez une option ci-dessous.
            </div>
          )}

          <div className="sep-menu-title">Affichage</div>
          {optionRow('Extrêmes de séance', forexSessions.showHighLow !== false, () => toggleForexSession('showHighLow'))}
          {optionRow('Étiquettes de séance', forexSessions.showLabels !== false, () => toggleForexSession('showLabels'))}
          {optionRow(
            `Mon fuseau horaire (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
            forexSessions.useLocalTz,
            () => toggleForexLocalTz()
          )}
        </div>
      )}
    </div>
  );
};
