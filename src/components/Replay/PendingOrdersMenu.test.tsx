import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingOrdersMenu } from './PendingOrdersMenu';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';

const trade = () => useTradeStore.getState();
const place = (targetPrice: number, orderType: 'LIMIT' | 'STOP') =>
  trade().placePendingOrder({ symbol: 'EURUSD', type: 'LONG', orderType, targetPrice, entry: targetPrice, sl: null, tp: null, time: 1, lots: 0.1 });

describe('<PendingOrdersMenu>', () => {
  beforeEach(() => {
    trade().resetAccount();
    useUIStore.getState().closeAllDropdowns();
    useMarketStore.getState().setSymbol('EURUSD');
  });

  it('shows nothing without a pending order', () => {
    const { container } = render(<PendingOrdersMenu />);
    expect(container.innerHTML).toBe('');
  });

  it('lists each order and cancels the one asked', async () => {
    place(1.08, 'LIMIT');
    place(1.12, 'STOP');
    const user = userEvent.setup();
    render(<PendingOrdersMenu />);
    await user.click(screen.getByRole('button', { name: /2 en attente/ }));
    expect(screen.getByText(/Achat limite à 1.08000/)).toBeTruthy();
    expect(screen.getByText(/Achat stop à 1.12000/)).toBeTruthy();

    await user.click(screen.getAllByTitle('Annuler cet ordre')[0]);
    expect(trade().pendingOrders.map((o) => o.targetPrice)).toEqual([1.12]);
  });

  it('cancels them all at once', async () => {
    place(1.08, 'LIMIT');
    place(1.07, 'LIMIT');
    const user = userEvent.setup();
    render(<PendingOrdersMenu />);
    await user.click(screen.getByRole('button', { name: /2 en attente/ }));
    await user.click(screen.getByRole('button', { name: 'Tout annuler' }));
    expect(trade().pendingOrders).toHaveLength(0);
  });
});
