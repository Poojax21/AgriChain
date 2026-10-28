import React, { useState, useEffect } from 'react';
import { Settings, Shield, Percent, Clock, PlusCircle, CheckCircle2, Truck, BadgeCheck } from 'lucide-react';
import { CONTRACT_ADDRESSES, BACKEND_URL } from '../contracts';
import { getAuthHeaders } from '../web3/wallet';

interface AdminDashboardProps {
  walletAddress: string | null;
  onWhitelistOracle: (oracleAddress: string) => Promise<void>;
  onGrantLogistics: (account: string) => Promise<void>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  walletAddress,
  onWhitelistOracle,
  onGrantLogistics,
}) => {
  const [candidateAddress, setCandidateAddress] = useState('');
  const [logisticsAddress, setLogisticsAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [verifying, setVerifying] = useState('');

  const loadPending = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/users`).then((r) => r.json());
      setPendingUsers(res?.users || []);
    } catch { /* indexer offline */ }
  };
  useEffect(() => { loadPending(); }, []);

  const handleVerify = async (addr: string, v: boolean) => {
    try {
      setVerifying(addr);
      await fetch(`${BACKEND_URL}/api/admin/verify-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ walletAddress: addr, verified: v }),
      });
      await loadPending();
    } finally {
      setVerifying('');
    }
  };

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
        <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>Protocol Governance & Security</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
          Manage AI oracle whitelist registries, protocol fees, and review on-chain contract deployments.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '28px' }}>

        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <Truck size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.25rem', color: '#01472e' }}>Authorize Shipment Recorder</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Grant LOGISTICS_ROLE to the farmer or carrier account that will commit shipment checkpoint roots.
          </p>
          <input type="text" className="form-input font-mono" placeholder="0x..." value={logisticsAddress}
            onChange={(e) => setLogisticsAddress(e.target.value)} />
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '12px' }}
            disabled={!/^0x[a-fA-F0-9]{40}$/.test(logisticsAddress)}
            onClick={async () => { await onGrantLogistics(logisticsAddress); setLogisticsAddress(''); }}>
            Grant shipment logging role
          </button>
        </div>
        
        {/* Whitelist Oracle Tool */}
        <div className="glass-panel" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <Shield size={20} color="var(--primary)" />
            <h3 style={{ fontSize: '1.25rem', color: '#01472e' }}>Whitelist Oracle Node</h3>
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
            <h3 style={{ fontSize: '1.25rem', color: '#01472e' }}>Protocol Parameters</h3>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
            Active smart contract constants and escrow timeout safeguards.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Marketplace Fee:</span>
              <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>2.0% (200 bps)</strong>
            </div>

            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Auto-Release Timeout:</span>
              <strong style={{ color: '#01472e', fontSize: '1.1rem' }}>3 Days (72 hrs)</strong>
            </div>

            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Minimum Oracle Bond:</span>
              <strong style={{ color: 'var(--accent-gold)', fontSize: '1.1rem' }}>5,000 AGRI</strong>
            </div>

            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Minimum Juror Stake:</span>
              <strong style={{ color: '#01472e', fontSize: '1.1rem' }}>1,000 AGRI</strong>
            </div>
          </div>
        </div>

      </div>

      {/* Account verification queue */}
      <div className="glass-panel" style={{ padding: '28px', marginTop: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <BadgeCheck size={20} color="var(--primary)" />
          <h3 style={{ fontSize: '1.25rem', color: '#01472e' }}>Farmer & Buyer Verification</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
          Review registered identities and grant the verification badge shown on listings and orders.
          Revoking removes the badge (off-chain trust flag only — never touches chain state).
        </p>
        {pendingUsers.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No registered accounts yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {pendingUsers.map((u) => {
              const verified = Number(u.verified) === 1;
              return (
              <div key={u.wallet_address} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', background: 'rgba(1,71,46,0.05)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <div>
                  <strong style={{ color: '#01472e' }}>{u.display_name || '(unnamed)'}</strong>
                  <span className="badge badge-neutral" style={{ marginLeft: '8px', fontSize: '0.7rem' }}>{u.role}</span>
                  {verified && <span className="badge badge-grade-a" style={{ marginLeft: '6px', fontSize: '0.7rem' }}>Verified</span>}
                  <p className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {u.wallet_address} {[u.location, u.contact].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {u.display_name && (
                  <button
                    className={`btn ${verified ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                    disabled={verifying === u.wallet_address}
                    onClick={() => handleVerify(u.wallet_address, !verified)}
                  >
                    <BadgeCheck size={14} /> {verifying === u.wallet_address ? 'Updating…' : verified ? 'Revoke badge' : 'Verify identity'}
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Deployed Smart Contract Registry */}      <div className="glass-panel" style={{ padding: '28px', marginTop: '28px' }}>
        <h3 style={{ fontSize: '1.25rem', color: '#01472e', marginBottom: '14px' }}>
          Deployed Contract Registry (Local Hardhat 31337 — TEST/DEMO, no real money)
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
          {Object.entries(CONTRACT_ADDRESSES).map(([name, address]) => (
            <div key={name} style={{ background: 'rgba(1,71,46,0.05)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ color: 'var(--primary)', fontSize: '0.88rem' }}>{name}</strong>
                <span className="badge badge-grade-a" style={{ fontSize: '0.65rem' }}>Local Config</span>
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
