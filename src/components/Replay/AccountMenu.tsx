import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { ACCOUNT_CURRENCIES, AccountCurrency, formatMoney } from '../../domain/instruments';

export const ACCOUNT_MENU_ID = 'rp-account';

const CURRENCY_NAMES: Record<AccountCurrency, string> = {
  USD: 'Dollar américain',
  EUR: 'Euro',
  GBP: 'Livre sterling',
  CHF: 'Franc suisse',
  JPY: 'Yen',
  CAD: 'Dollar canadien',
  AUD: 'Dollar australien',
};

/**
 * The balance, and the currency it is counted in.
 *
 * Every amount of the account is in that currency, so changing it opens a new
 * account. With trades or orders on it, the menu says what would be lost and
 * asks a second time.
 */
export const AccountMenu: React.FC = () => {
  const { balance, accountCurrency, openPositions, pendingOrders, closedPositions, setAccountCurrency } = useTradeStore();
  const { activeDropdown, toggleDropdown, closeAllDropdowns, showToast } = useUIStore();
  const isOpen = activeDropdown === ACCOUNT_MENU_ID;
  const [pending, setPending] = useState<AccountCurrency | null>(null);

  const lost = [
    closedPositions.length > 0 ? `${closedPositions.length} trade(s) au journal` : null,
    openPositions.length > 0 ? `${openPositions.length} position(s) ouverte(s)` : null,
    pendingOrders.length > 0 ? `${pendingOrders.length} ordre(s) en attente` : null,
  ].filter((part): part is string => part !== null);

  const apply = (currency: AccountCurrency) => {
    setAccountCurrency(currency);
    setPending(null);
    closeAllDropdowns();
    showToast(`Nouveau compte en ${currency} : solde de ${formatMoney(10_000)}.`, 'success', 3000);
  };

  const choose = (currency: AccountCurrency) => {
    if (currency === accountCurrency) return;
    if (lost.length > 0) setPending(currency);
    else apply(currency);
  };

  return (
    <div className="tv-dropdown rp-account">
      <button
        type="button"
        className="rp-account-btn"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => {
          setPending(null);
          toggleDropdown(ACCOUNT_MENU_ID);
        }}
        title="Solde du compte — cliquez pour changer de devise"
      >
        <span className="rp-stat-label">Solde · {accountCurrency}</span>
        <span id="rp-balance" className="rp-stat-val">
          {formatMoney(balance)}
          <ChevronDown size={9} strokeWidth={2.5} aria-hidden />
        </span>
      </button>

      {isOpen && (
        <div className="tv-dropdown-menu show rp-account-menu">
          <div className="dropdown-section-label">Devise du compte</div>
          {pending === null ? (
            <div role="radiogroup" aria-label="Devise du compte">
              {ACCOUNT_CURRENCIES.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  role="radio"
                  aria-checked={currency === accountCurrency}
                  className={`tv-dropdown-item rp-account-currency ${currency === accountCurrency ? 'active' : ''}`}
                  onClick={() => choose(currency)}
                >
                  <span className="rp-account-code">{currency}</span>
                  <span>{CURRENCY_NAMES[currency]}</span>
                </button>
              ))}
              <p className="rp-account-hint">Changer de devise ouvre un nouveau compte de 10 000.</p>
            </div>
          ) : (
            <div className="rp-account-confirm" role="alertdialog" aria-label="Confirmer le changement de devise">
              <p>
                Passer en {pending} ouvre un nouveau compte : {lost.join(', ')} seront effacés.
                Enregistrez une session pour les garder.
              </p>
              <div className="rp-account-confirm-actions">
                <button type="button" className="btn-sm" onClick={() => setPending(null)}>
                  Annuler
                </button>
                <button type="button" className="btn-sm btn-danger" onClick={() => apply(pending)}>
                  Passer en {pending}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
