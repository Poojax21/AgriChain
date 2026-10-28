import React, { useState } from 'react';
import { Settings, Shield, Percent, Clock, PlusCircle, CheckCircle2 } from 'lucide-react';
import { CONTRACT_ADDRESSES } from '../contracts';

interface AdminDashboardProps {
  walletAddress: string | null;
  onWhitelistOracle: (oracleAddress: string) => Promise<void>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  walletAddress,
  onWhitelistOracle,
}) => {
  const [candidateAddress, setCandidateAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      
      {/* Header Banner */}
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
          <Settings size={20} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Platform Administration
          </span>
        </div>
        <h2 style={{ fontSize: '1.8rem', color: '#fff' }}>Protocol Governance & Security</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
          Manage AI oracle whitelist registries, protocol fees, and review on-chain contract deployments.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '28px' }}>
        
        {/* Whitelist Oracle Tool */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <Shield size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Whitelist Oracle Node</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Authorize a candidate node to stake AGRI bond and submit cryptographically verified quality ratings.
          </p>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!candidateAddress.startsWith('0x') || candidateAddress.length !== 42) {
                alert('Please enter a valid Ethereum address!');
                return;
              }
              try {
                setIsSubmitting(true);
                await onWhitelistOracle(candidateAddress);
                setCandidateAddress('');
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            <div style={{ marginBottom: '16px' }}>
              <label className="form-label">Oracle Node EVM Address</label>
              <input
                type="text"
                placeholder="0x..."
                className="form-input font-mono"
                value={candidateAddress}
                onChange={(e) => setCandidateAddress(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={isSubmitting}>
              <PlusCircle size={15} />
              {isSubmitting ? 'Whitelisting on-chain...' : 'Whitelist Oracle Node'}
            </button>
          </form>
        </div>

        {/* Protocol Settings */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <Percent size={20} color="var(--accent-gold)" />
            <h3 style={{ fontSize: '1.25rem', color: '#fff' }}>Protocol Parameters</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Active smart contract constants and escrow timeout safeguards.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Marketplace Fee:</span>
              <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>2.0% (200 bps)</strong>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Auto-Release Timeout:</span>
              <strong style={{ color: '#fff', fontSize: '1.1rem' }}>3 Days (72 hrs)</strong>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Minimum Oracle Bond:</span>
              <strong style={{ color: 'var(--accent-gold)', fontSize: '1.1rem' }}>5,000 AGRI</strong>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Minimum Juror Stake:</span>
              <strong style={{ color: '#fff', fontSize: '1.1rem' }}>1,000 AGRI</strong>
            </div>
          </div>
        </div>

      </div>

      {/* Deployed Smart Contract Registry */}
      <div className="glass-panel" style={{ padding: '28px', marginTop: '28px' }}>
        <h3 style={{ fontSize: '1.25rem', color: '#fff', marginBottom: '14px' }}>
          On-Chain Verified Deployments (Polygon L2 / Amoy)
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {Object.entries(CONTRACT_ADDRESSES).map(([name, address]) => (
            <div key={name} style={{ background: 'rgba(255,255,255,0.02)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ color: 'var(--primary)', fontSize: '0.88rem' }}>{name}</strong>
                <span className="badge badge-grade-a" style={{ fontSize: '0.65rem' }}>EVM Verified</span>
              </div>
              <code className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                {address}
              </code>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
