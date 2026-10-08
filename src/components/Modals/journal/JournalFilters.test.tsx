import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JournalFilters } from './JournalFilters';
import { EMPTY_FILTER, JournalFilter, NO_SETUP } from '../../../domain/journal';

function setup(filter: JournalFilter = EMPTY_FILTER) {
  const onChange = vi.fn();
  render(<JournalFilters filter={filter} onChange={onChange} setups={['cassure', 'range']} shown={3} total={10} />);
  return onChange;
}

describe('<JournalFilters>', () => {
  it('turns the typed days into UTC day bounds', () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2024-03-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, from: Date.parse('2024-03-01T00:00:00Z') / 1000 });
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2024-03-31' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, to: Date.parse('2024-03-31T23:59:59Z') / 1000 });
  });

  it('filters by side and by setup', async () => {
    const user = userEvent.setup();
    const onChange = setup();
    await user.click(screen.getByRole('radio', { name: 'Ventes' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, side: 'SHORT' });
    await user.selectOptions(screen.getByLabelText('Setup'), 'Sans setup');
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FILTER, setup: NO_SETUP });
  });

  it('says how many trades a filter keeps, and resets', async () => {
    const user = userEvent.setup();
    const onChange = setup({ ...EMPTY_FILTER, side: 'LONG' });
    expect(screen.getByText(/3 trades sur 10/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }));
    expect(onChange).toHaveBeenLastCalledWith(EMPTY_FILTER);
  });

  it('stays quiet without a filter', () => {
    setup();
    expect(screen.queryByText(/sur 10/)).toBeNull();
  });
});
