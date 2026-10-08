import React from 'react';
import { EMPTY_FILTER, JournalFilter, NO_SETUP, isFilterActive } from '../../../domain/journal';
import { PositionType } from '../../../types/trading';

/** `YYYY-MM-DD` of an epoch-seconds instant, in UTC like every date of the journal. */
function toDateInput(epochSeconds: number | null): string {
  return epochSeconds === null ? '' : new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** Start or end of the UTC day typed in a date field; `null` when emptied. */
function fromDateInput(value: string, edge: 'start' | 'end'): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T${edge === 'start' ? '00:00:00' : '23:59:59'}Z`);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

const SIDES: ReadonlyArray<{ value: PositionType | null; label: string }> = [
  { value: null, label: 'Tous' },
  { value: 'LONG', label: 'Achats' },
  { value: 'SHORT', label: 'Ventes' },
];

interface JournalFiltersProps {
  readonly filter: JournalFilter;
  readonly onChange: (filter: JournalFilter) => void;
  readonly setups: readonly string[];
  /** Trades shown and trades in the account, for the summary line. */
  readonly shown: number;
  readonly total: number;
}

/** Date range, side and setup: the three questions a trader asks their history. */
export const JournalFilters: React.FC<JournalFiltersProps> = ({ filter, onChange, setups, shown, total }) => {
  const active = isFilterActive(filter);
  return (
    <fieldset className="journal-filters">
      <legend className="sr-only">Filtrer les trades</legend>
      <div className="journal-filter-row">
        <label className="journal-filter">
          <span>Du</span>
          <input
            type="date"
            value={toDateInput(filter.from)}
            max={toDateInput(filter.to) || undefined}
            onChange={(e) => onChange({ ...filter, from: fromDateInput(e.target.value, 'start') })}
          />
        </label>
        <label className="journal-filter">
          <span>Au</span>
          <input
            type="date"
            value={toDateInput(filter.to)}
            min={toDateInput(filter.from) || undefined}
            onChange={(e) => onChange({ ...filter, to: fromDateInput(e.target.value, 'end') })}
          />
        </label>
      </div>
      <div className="journal-filter-row">
        <div className="journal-side-toggle" role="radiogroup" aria-label="Sens">
          {SIDES.map((side) => (
            <button
              key={side.label}
              type="button"
              role="radio"
              aria-checked={filter.side === side.value}
              className={filter.side === side.value ? 'active' : ''}
              onClick={() => onChange({ ...filter, side: side.value })}
            >
              {side.label}
            </button>
          ))}
        </div>
        <label className="journal-filter">
          <span className="sr-only">Setup</span>
          <select value={filter.setup ?? ''} onChange={(e) => onChange({ ...filter, setup: e.target.value || null })}>
            <option value="">Tous les setups</option>
            {/* A setup renamed since it was chosen stays selectable: without it,
                the menu read "Tous les setups" while still filtering. */}
            {(filter.setup !== null && filter.setup !== NO_SETUP && !setups.includes(filter.setup)
              ? [filter.setup, ...setups]
              : setups
            ).map((setup) => (
              <option key={setup} value={setup}>
                {setup}
              </option>
            ))}
            <option value={NO_SETUP}>Sans setup</option>
          </select>
        </label>
      </div>
      {active && (
        <div className="journal-filter-summary">
          <span>
            {shown} trade{shown > 1 ? 's' : ''} sur {total} · statistiques de cette sélection
          </span>
          <button type="button" className="journal-filter-reset" onClick={() => onChange(EMPTY_FILTER)}>
            Tout afficher
          </button>
        </div>
      )}
    </fieldset>
  );
};
