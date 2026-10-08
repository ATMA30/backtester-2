import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetAllModal } from './ResetAllModal';
import { useUIStore } from '../../store/useUIStore';
import * as resetAppModule from '../../services/resetApp';

describe('<ResetAllModal>', () => {
  beforeEach(() => {
    useUIStore.setState({ activeModal: 'reset-all' });
    vi.clearAllMocks();
  });

  it('renders nothing when activeModal is not reset-all', () => {
    useUIStore.setState({ activeModal: null });
    const { container } = render(<ResetAllModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders confirmation dialog with all categories to be wiped', () => {
    render(<ResetAllModal />);
    expect(screen.getByRole('dialog', { name: 'Tout réinitialiser & repartir de zéro' })).toBeTruthy();
    expect(screen.getByText(/Graphiques & tracés/)).toBeTruthy();
    expect(screen.getByText(/Fichiers & jeux de données/)).toBeTruthy();
    expect(screen.getByText(/Sessions de backtest/)).toBeTruthy();
    expect(screen.getByText(/Journal & compte de trading/)).toBeTruthy();
    expect(screen.getByText(/Réglages & préférences/)).toBeTruthy();
  });

  it('closes when clicking Annuler', async () => {
    const user = userEvent.setup();
    render(<ResetAllModal />);
    const cancelBtn = screen.getByRole('button', { name: 'Annuler' });
    await user.click(cancelBtn);
    expect(useUIStore.getState().activeModal).toBeNull();
  });

  it('invokes resetAllAppData when clicking confirm', async () => {
    const resetSpy = vi.spyOn(resetAppModule, 'resetAllAppData').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ResetAllModal />);

    const confirmBtn = screen.getByRole('button', { name: /Tout supprimer et repartir de zéro/ });
    await user.click(confirmBtn);

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().activeModal).toBeNull();
    resetSpy.mockRestore();
  });
});
