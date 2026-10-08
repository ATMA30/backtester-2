import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TradeHistoryModal } from './TradeHistoryModal';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';

const trade = () => useTradeStore.getState();

function closeTrade(type: 'LONG' | 'SHORT', exit: number, setup?: string) {
  trade().openTrade({ symbol: 'EURUSD', type, entry: 1.1, sl: null, tp: null, time: 1, lots: 0.1 });
  const { id } = trade().openPositions[0];
  if (setup) trade().annotate(id, { setup });
  trade().closeAtMarket(id, exit, 2);
}

describe('<TradeHistoryModal>', () => {
  beforeEach(() => {
    trade().setAccountCurrency('USD');
    trade().setCosts({ enabled: false });
    closeTrade('LONG', 1.11, 'cassure'); // +$100
    closeTrade('SHORT', 1.105, 'cassure'); // −$50
    closeTrade('LONG', 1.09); // −$100
    useUIStore.getState().openModal('trade-history');
  });

  const netResult = () => screen.getByTitle(/Gains moins pertes/).textContent;

  it('recomputes the figures on the filtered trades', async () => {
    const user = userEvent.setup();
    render(<TradeHistoryModal />);
    expect(netResult()).toContain('-$50.00');

    await user.selectOptions(screen.getByLabelText('Setup'), 'cassure');
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);
    expect(netResult()).toContain('+$50.00');

    await user.click(screen.getByRole('radio', { name: 'Achats' }));
    expect(netResult()).toContain('+$100.00');
  });

  it('keeps the trade being edited in view when it stops matching the filter', async () => {
    const user = userEvent.setup();
    render(<TradeHistoryModal />);
    await user.selectOptions(screen.getByLabelText('Setup'), 'cassure');
    const [first] = screen.getAllByRole('button', { expanded: false });
    await user.click(first);

    const field = screen.getByPlaceholderText('cassure, retour sur zone…');
    await user.clear(field);
    await user.type(field, 'range');
    await user.tab();
    // Still listed while open, though no longer a "cassure"...
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
    // ...and the menu still says which filter is on.
    expect((screen.getByLabelText('Setup', { selector: 'select' }) as HTMLSelectElement).value).toBe('cassure');

    await user.click(screen.getByRole('button', { expanded: true }));
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
  });

  it('exports what is shown', async () => {
    const user = userEvent.setup();
    render(<TradeHistoryModal />);
    await user.click(screen.getByRole('radio', { name: 'Ventes' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Exporter la sélection en CSV' })).toBeTruthy();
  });
});
