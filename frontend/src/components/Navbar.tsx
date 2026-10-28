import React from 'react';
import { Sprout, ShieldCheck, Wallet, RefreshCw, Award, Scale, Cpu, Settings, ShoppingBag } from 'lucide-react';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  walletAddress: string | null;
  agriBalance: string;
  reputationScore: number;
  onConnectWallet: () => void;
  onClaimFaucet: () => void;
  isFauceting: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  walletAddress,
  agriBalance,
  reputationScore,
  onConnectWallet,
  onClaimFaucet,
  isFauceting,
}) => {
  const tabs = [
    { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
    { id: 'farmer', label: 'Farmer Portal', icon: Sprout },
    { id: 'oracle', label: 'AI Oracle', icon: Cpu },
    { id: 'juror', label: 'Dispute DAO', icon: Scale },
    { id: 'admin', label: 'Governance', icon: Settings },
  ];

  return (
    <header className="glass-panel" style={{ margin: '16px 24px', padding: '12px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Logo & Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => setCurrentTab('marketplace')}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)'
          }}>
            <Sprout size={24} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
                Agri<span style={{ color: 'var(--primary)' }}>Chain</span>
              </span>
              <span className="badge badge-grade-a" style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                Polygon L2
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Decentralized Agriculture & AI Verification
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`nav-tab ${isActive ? 'active' : ''}`}
                onClick={() => setCurrentTab(tab.id)}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* User Stats & Wallet */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {walletAddress ? (
            <>
              {/* Soulbound Reputation Pill */}
              <div className="badge badge-neutral" style={{ padding: '6px 12px', gap: '6px' }} title="Soulbound Trust Score">
                <Award size={14} color="#f59e0b" />
                <span style={{ color: 'var(--text-secondary)' }}>Trust:</span>
                <strong style={{ color: '#fff' }}>{reputationScore}</strong>
              </div>

              {/* AGRI Token Balance */}
              <div className="badge badge-neutral" style={{ padding: '6px 12px', gap: '6px' }} title="AGRI Token Balance">
                <span style={{ color: 'var(--primary)', fontWeight: 700 }}>AGRI:</span>
                <strong style={{ color: '#fff' }}>{parseFloat(agriBalance).toLocaleString()}</strong>
              </div>

              {/* Faucet Button */}
              <button
                className="btn btn-secondary btn-sm"
                onClick={onClaimFaucet}
                disabled={isFauceting}
                title="Claim 1,000 AGRI from demo faucet"
              >
                <RefreshCw size={13} className={isFauceting ? 'animate-spin' : ''} />
                {isFauceting ? 'Claiming...' : 'Faucet'}
              </button>

              {/* Wallet Address Chip */}
              <div className="btn btn-secondary btn-sm" style={{ cursor: 'default' }}>
                <Wallet size={14} color="var(--primary)" />
                <span className="font-mono">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
              </div>
            </>
          ) : (
            <button className="btn btn-primary" onClick={onConnectWallet}>
              <Wallet size={16} />
              Connect Wallet
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
