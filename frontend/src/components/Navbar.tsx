import React from 'react';
import { Wallet, Bell } from 'lucide-react';
import type { WalletRole } from '../web3/wallet';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  viewMode: 'buyer' | 'farmer';
  setViewMode: (m: 'buyer' | 'farmer') => void;
  walletAddress: string | null;
  displayName: string | null;
  verified: boolean;
  agriBalance: string;
  reputationScore: number;
  cartCount: number;
  unreadNotificationsCount?: number;
  networkOk: boolean;
  roles: WalletRole[];
  onConnectWallet: () => void;
  onClaimFaucet: () => void;
  onOpenNotifications?: () => void;
  isFauceting: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  viewMode,
  setViewMode,
  walletAddress,
  displayName,
  verified,
  agriBalance,
  reputationScore,
  cartCount,
  unreadNotificationsCount,
  networkOk,
  roles,
  onConnectWallet,
  onClaimFaucet,
  onOpenNotifications,
  isFauceting,
}) => {
  const tabs = viewMode === 'farmer'
    ? [
        { id: 'marketplace', label: 'Market' },
        { id: 'farmer', label: 'Sell' },
        { id: 'shipments', label: 'Ship' },
        { id: 'wallet', label: 'Wallet' },
        { id: 'oracle', label: 'Oracle' },
        { id: 'juror', label: 'DAO' },
        { id: 'audit', label: 'Audit' },
        { id: 'admin', label: 'Gov' },
      ]
    : [
        { id: 'marketplace', label: 'Market' },
        { id: 'wallet', label: 'Wallet' },
        { id: 'juror', label: 'DAO' },
        { id: 'audit', label: 'Audit' },
        { id: 'admin', label: 'Gov' },
      ];

  const go = (id: string) => {
    setCurrentTab(id);
    window.scrollTo({ top: 0 });
  };

  return (
    <header className="ed-nav">
      <div className="ed-logo" onClick={() => go('marketplace')} style={{ cursor: 'pointer' }}>
        -AgriChain
      </div>

      <nav className="ed-pill" aria-label="Interface mode">
        <button
          className={viewMode === 'buyer' ? 'active' : ''}
          onClick={() => setViewMode('buyer')}
          title="Buyer interface: browse, buy, receive, dispute"
        >
          Buyer
        </button>
        <button
          className={viewMode === 'farmer' ? 'active' : ''}
          onClick={() => setViewMode('farmer')}
          title="Farmer interface: verify, mint, list, ship"
        >
          Farmer
        </button>
      </nav>

      <nav className="ed-pill">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={currentTab === t.id ? 'active' : ''}
            onClick={() => go(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {onOpenNotifications && (
          <button className="ed-cart" onClick={onOpenNotifications} title="Activity & Notifications">
            <Bell size={14} />
            {unreadNotificationsCount !== undefined && unreadNotificationsCount > 0 && (
              <span className="ed-cart-badge" style={{ background: '#0284c7' }}>{unreadNotificationsCount}</span>
            )}
          </button>
        )}
        <button className="ed-cart" onClick={() => go('marketplace')} title="Orders / Cart">
          Cart
          <span className="ed-cart-badge">{cartCount}</span>
        </button>
        {walletAddress ? (
          <>
            {!networkOk && (
              <span className="ed-cart" style={{ background: '#7f1d1d', color: '#fefae0', borderColor: '#7f1d1d' }}>
                Wrong Network
              </span>
            )}
            {roles.slice(0, 2).map((r) => (
              <span key={r} className="ed-cart" style={{ padding: '8px 12px' }} title={`Detected role: ${r}`}>
                {r}
              </span>
            ))}
            <button
              className="ed-cart"
              onClick={() => go('wallet')}
              title={`AGRI ${agriBalance} | Trust ${reputationScore}`}
            >
              <Wallet size={14} />
              {isFauceting ? '...' : displayName ? `${displayName}${verified ? ' ✓' : ''}` : `${walletAddress!.slice(0, 4)}..${walletAddress!.slice(-2)}`}
            </button>
            <button className="ed-cart" onClick={onClaimFaucet} title="Claim 1,000 AGRI faucet">
              {isFauceting ? '...' : '+Faucet'}
            </button>
          </>
        ) : (
          <button className="ed-cart" onClick={onConnectWallet}>
            <Wallet size={14} /> Connect
          </button>
        )}
      </div>
    </header>
  );
};
