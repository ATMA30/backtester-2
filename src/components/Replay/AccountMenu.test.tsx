import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountMenu } from './AccountMenu';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';

const trade = () => useTradeStore.getState();

describe('<AccountMenu>', () => {
  beforeEach(() => {
    trade().setAccountCurrency('USD');
    useUIStore.getState().closeAllDropdowns();
  });

  it('switches an empty account at once', async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    expect(screen.getByText('$10,000.00')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Solde/ }));
    await user.click(screen.getByRole('radio', { name: /EUR/ }));

    expect(trade().accountCurrency).toBe('EUR');
    expect(screen.getByText('€10,000.00')).toBeTruthy();
  });

  it('asks before wiping a journal, and keeps it on cancel', async () => {
    trade().openTrade({ symbol: 'EURUSD', type: 'LONG', entry: 1.1, sl: null, tp: null, time: 1, lots: 0.1 });
    trade().closeAtMarket(trade().openPositions[0].id, 1.11, 2);
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(screen.getByRole('button', { name: /Solde/ }));
    await user.click(screen.getByRole('radio', { name: /GBP/ }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm.textContent).toContain('1 trade(s) au journal');

    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(trade().accountCurrency).toBe('USD');
    expect(trade().closedPositions).toHaveLength(1);

    await user.click(screen.getByRole('radio', { name: /GBP/ }));
    await user.click(screen.getByRole('button', { name: 'Passer en GBP' }));
    expect(trade().accountCurrency).toBe('GBP');
    expect(trade().closedPositions).toHaveLength(0);
  });

  it('marks the current currency as checked', async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /Solde/ }));
    expect(screen.getByRole('radio', { name: /USD/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /EUR/ }).getAttribute('aria-checked')).toBe('false');
  });
});
