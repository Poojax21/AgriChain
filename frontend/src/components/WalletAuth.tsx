import React from 'react';
import { Wallet, AlertTriangle, RefreshCw, Award, Coins, Image, Receipt, Sprout, ShoppingCart } from 'lucide-react';
import { Reveal } from './Reveal';
import type { WalletProfile } from '../web3/wallet';
import { SUPPORTED_NETWORKS } from '../contracts';

interface WalletAuthProps {
  profile: WalletProfile | null;
  connecting: boolean;
  pendingSession: { address: string; displayName: string | null } | null;
  onContinueSession: () => void;
  onConnectFarmer: () => void;
  onConnectBuyer: () => void;
  onSwitchNetwork: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
}

export const WalletAuth: React.FC<WalletAuthProps> = ({
  profile, connecting, pendingSession, onContinueSession, onConnectFarmer, onConnectBuyer, onSwitchNetwork, onRefresh, onDisconnect,
}) => {
  if (!profile) {
    return (
      <div id="section-wallet">
        <Reveal>
          <div className="glass-panel" style={{ padding: '48px 32px', textAlign: 'center' }}>
            <p className="ed-label">00 — Entry Point · Sign in first</p>
            <h2 style={{ fontSize: '2.4rem', margin: '12px 0' }}>LOGIN TO AGRICHAIN</h2>
            {pendingSession && (
              <div style={{ maxWidth: '520px', margin: '0 auto 24px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--border-active)', borderRadius: '1rem', padding: '20px' }}>
                <p style={{ fontWeight: 700, color: '#01472e' }}>
                  Continue as {pendingSession.displayName || `${pendingSession.address.slice(0, 6)}…${pendingSession.address.slice(-4)}`}?
                </p>
                <p className="ed-meta" style={{ margin: '6px 0 14px' }}>Your last wallet is still authorized in MetaMask. One click, no popup.</p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={onContinueSession} disabled={connecting}>
                  <Wallet size={16} /> {connecting ? 'Signing in...' : 'Continue sign-in'}
                </button>
              </div>
            )}
            <p className="ed-label" style={{ marginBottom: '12px' }}>{pendingSession ? 'Or connect a different wallet' : 'Choose your door'}</p>
            <p className="ed-meta" style={{ marginBottom: '24px' }}>MetaMask · Hardhat Local · Chain ID 31337. Each door checks the wallet's registered role.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', maxWidth: '640px', margin: '0 auto', textAlign: 'left' }}>
              <div style={{ background: 'rgba(1,71,46,0.05)', borderRadius: '1rem', padding: '20px' }}>
                <p style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 700, color: '#01472e' }}>
                  <Sprout size={16} /> Farmer login
                </p>
                <p className="ed-meta" style={{ margin: '8px 0 14px' }}>List harvests, verify quality, ship orders, track earnings.</p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={onConnectFarmer} disabled={connecting}>
                  <Wallet size={16} /> {connecting ? 'Connecting...' : 'Login as Farmer'}
                </button>
              </div>
              <div style={{ background: 'rgba(1,71,46,0.05)', borderRadius: '1rem', padding: '20px' }}>
                <p style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 700, color: '#01472e' }}>
                  <ShoppingCart size={16} /> Buyer login
                </p>
                <p className="ed-meta" style={{ margin: '8px 0 14px' }}>Browse lots, escrow payment, receive, confirm or dispute.</p>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={onConnectBuyer} disabled={connecting}>
                  <Wallet size={16} /> {connecting ? 'Connecting...' : 'Login as Buyer'}
                </button>
              </div>
            </div>
            <p className="ed-meta" style={{ marginTop: '18px' }}>New here? Either door works — you'll create your named account right after.</p>
          </div>
        </Reveal>
      </div>
    );
  }

  const netName = SUPPORTED_NETWORKS[profile.chainId]?.chainName || `Chain ${profile.chainId}`;

  return (
    <div id="section-wallet">
      <Reveal><p className="ed-label">00 — Wallet Profile · {profile.roles.length ? profile.roles.join(' · ') : 'No recognized role'}</p></Reveal>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px', marginTop: '16px' }}>
        {/* Identity + network */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '1.4rem' }}>WALLET</h3>
            <span className="badge" style={{ background: profile.networkOk ? '#01472e' : '#7f1d1d', color: '#fefae0' }}>
              {profile.networkOk ? 'Correct Network' : 'Wrong Network'}
            </span>
          </div>
          <code className="font-mono" style={{ fontSize: '0.8rem', wordBreak: 'break-all', color: '#01472e' }}>{profile.address}</code>
          <p className="ed-meta" style={{ marginTop: '10px' }}>{netName} · Chain ID {profile.chainId} · txs {profile.txCount}</p>
          {!profile.networkOk && (
            <div style={{ marginTop: '16px', background: 'rgba(127,29,29,0.08)', borderRadius: '1rem', padding: '14px' }}>
              <p style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.85rem', fontWeight: 700 }}>
                <AlertTriangle size={15} /> Wrong network. Please switch to Hardhat Local.
              </p>
              <button className="btn btn-primary" style={{ marginTop: '12px', width: '100%' }} onClick={onSwitchNetwork}>
                Switch Network
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={onRefresh}><RefreshCw size={13} /> Refresh</button>
            <button className="btn btn-secondary btn-sm" onClick={onDisconnect}>Disconnect</button>
          </div>
        </div>

        {/* Balances + reputation */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '1.4rem', marginBottom: '14px' }}>PROFILE</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'rgba(1,71,46,0.06)', borderRadius: '1rem', padding: '12px' }}>
              <p className="ed-meta">Local ETH</p>
              <strong style={{ fontSize: '1.2rem' }}>{Number(profile.ethBalance).toFixed(4)} ETH</strong>
            </div>
            <div style={{ background: 'rgba(1,71,46,0.06)', borderRadius: '1rem', padding: '12px' }}>
              <p className="ed-meta"><Coins size={12} /> AGRI</p>
              <strong style={{ fontSize: '1.2rem' }}>{parseFloat(profile.agriBalance).toLocaleString()}</strong>
            </div>
            <div style={{ background: 'rgba(1,71,46,0.06)', borderRadius: '1rem', padding: '12px' }}>
              <p className="ed-meta"><Image size={12} /> NFTs</p>
              <strong style={{ fontSize: '1.2rem' }}>{profile.nftCount}</strong>
            </div>
            <div style={{ background: 'rgba(1,71,46,0.06)', borderRadius: '1rem', padding: '12px' }}>
              <p className="ed-meta"><Award size={12} /> Reputation</p>
              <strong style={{ fontSize: '1.2rem' }}>{profile.reputation.score}</strong>
              <p className="ed-meta">trades {profile.reputation.trades} · W{profile.reputation.won}/L{profile.reputation.lost}</p>
            </div>
            <div style={{ background: 'rgba(1,71,46,0.06)', borderRadius: '1rem', padding: '12px' }}>
              <p className="ed-meta">Staked</p>
              <strong style={{ fontSize: '1.2rem' }}>{parseFloat(profile.stakedBalance).toLocaleString()}</strong>
              <p className="ed-meta">oracle {parseFloat(profile.oracle.staked).toLocaleString()}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
            {profile.roles.map((r) => (
              <span key={r} className="badge badge-grade-a">{r}</span>
            ))}
          </div>
        </div>

        {/* History */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <h3 style={{ fontSize: '1.4rem', marginBottom: '14px' }}><Receipt size={16} /> HISTORY</h3>
          {profile.history.orders.length === 0 ? (
            <p className="ed-meta">No on-chain-indexed trades yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
              {profile.history.orders.slice(0, 8).map((o: any) => (
                <div key={o.order_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', background: 'rgba(1,71,46,0.05)', padding: '8px 12px', borderRadius: '0.8rem' }}>
                  <span>Order #{o.order_id} · {o.status}</span>
                  <strong>{(parseFloat(o.total_amount) / 1e18).toFixed(1)} AGRI</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
