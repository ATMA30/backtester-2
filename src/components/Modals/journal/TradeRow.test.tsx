import { useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TradeRow } from './TradeRow';
import { useTradeStore } from '../../../store/useTradeStore';

const trade = () => useTradeStore.getState();
const closed = () => trade().closedPositions[0];

/** The row of the one closed trade, fed from the store like the journal does. */
function Harness() {
  const current = useTradeStore((s) => s.closedPositions[0]);
  const [expanded, setExpanded] = useState(false);
  return (
    <TradeRow trade={current} fallbackSymbol="EURUSD" setups={['cassure']} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
  );
}

const renderRow = () => render(<Harness />);

describe('<TradeRow>', () => {
  beforeEach(() => {
    trade().setAccountCurrency('USD');
    trade().setCosts({ enabled: false });
    trade().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: 1.095, tp: null, time: 1, lots: 0.1 });
    trade().closeAtMarket(trade().openPositions[0].id, 1.11, 2);
  });

  it('opens its notes on click and closes them again', async () => {
    const user = userEvent.setup();
    renderRow();
    const row = screen.getByRole('button', { expanded: false });
    await user.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Setup')).toBeTruthy();
    await user.click(row);
    expect(screen.queryByLabelText('Setup')).toBeNull();
  });

  it('saves the setup and the note when the field is left, spaces between words kept', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { expanded: false }));

    await user.type(screen.getByLabelText('Setup'), 'retour sur zone ');
    // Nothing written while typing: the draft is committed on blur.
    expect(closed().annotation).toBeUndefined();
    await user.type(screen.getByLabelText('Note'), 'entrée trop tôt');
    expect(closed().annotation).toEqual({ setup: 'retour sur zone' });
    await user.tab();
    expect(closed().annotation).toEqual({ setup: 'retour sur zone', note: 'entrée trop tôt' });

    // The badge waits for the row to close: appearing on blur, it shifted the
    // editor under the pointer.
    expect(screen.queryByText('retour sur zone', { selector: '.th-trade-setup' })).toBeNull();
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(screen.getByText('retour sur zone', { selector: '.th-trade-setup' })).toBeTruthy();
  });

  it('sets an emotion, and clears it on a second click', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { expanded: false }));

    await user.click(screen.getByRole('radio', { name: 'impatient' }));
    expect(closed().annotation?.emotion).toBe('impatient');
    expect(screen.getByRole('radio', { name: 'impatient' }).getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('radio', { name: 'impatient' }));
    expect(closed().annotation).toBeUndefined();
  });

  it('shows the result in R', () => {
    renderRow();
    // +100 pips for a 50-pip stop.
    expect(screen.getByRole('button').textContent).toContain('+2.00 R');
  });
});
