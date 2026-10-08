import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpenPositionsMenu } from './OpenPositionsMenu';
import { useTradeStore } from '../../store/useTradeStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';

const trade = () => useTradeStore.getState();

describe('<OpenPositionsMenu>', () => {
  beforeEach(() => {
    trade().setAccountCurrency('USD');
    trade().setCosts({ enabled: false });
    useReplayStore.getState().resetReplay();
    useUIStore.getState().closeAllDropdowns();
    trade().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: 1.09, tp: null, time: 1, lots: 0.1 });
    trade().openTrade({ symbol: 'EURUSD', type: 'SHORT', entry: 1.1, sl: 1.12, tp: null, time: 1, lots: 0.2 });
  });

  const openMenu = async () => {
    const user = userEvent.setup();
    render(<OpenPositionsMenu symbol="EURUSD" price={1.101} time={5} />);
    await user.click(screen.getByRole('button', { name: /2 positions/ }));
    return { user, rows: screen.getAllByRole('group') };
  };

  it('lists every position with its own result at the current price', async () => {
    const { rows } = await openMenu();
    expect(rows).toHaveLength(2);
    // +10 pips on 0.1 lot, −10 pips on 0.2 lot.
    expect(rows[0].textContent).toContain('+$10.00');
    expect(rows[1].textContent).toContain('-$20.00');
  });

  it('closes only the position of the row', async () => {
    const { user, rows } = await openMenu();
    await user.click(within(rows[1]).getByRole('button', { name: 'Fermer' }));
    expect(trade().openPositions.map((p) => p.type)).toEqual(['LONG']);
    expect(trade().closedPositions[0]).toMatchObject({ type: 'SHORT', closeTime: 5 });
  });

  it('moves one stop to entry', async () => {
    const { user, rows } = await openMenu();
    await user.click(within(rows[0]).getByRole('button', { name: 'Stop à l’entrée' }));
    expect(trade().openPositions.map((p) => p.sl)).toEqual([1.1, 1.12]);
  });

  it('refuses to act while reviewing a candle already passed', async () => {
    const replay = useReplayStore.getState();
    replay.setIsActive(true);
    replay.setCurrentIndex(10);
    replay.setCurrentIndex(4);
    const { user, rows } = await openMenu();

    await user.click(within(rows[0]).getByRole('button', { name: 'Fermer' }));
    expect(trade().openPositions).toHaveLength(2);
    expect(useUIStore.getState().toasts.at(-1)?.message).toContain('déjà dépassée');
  });
});
