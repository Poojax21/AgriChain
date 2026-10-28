import React, { useState, useEffect } from 'react';
import { UserRound, BadgeCheck, ShieldAlert } from 'lucide-react';
import { BACKEND_URL } from '../contracts';
import { getAuthHeaders } from '../web3/wallet';
import type { WalletProfile } from '../web3/wallet';

interface AccountPanelProps {
  profile: WalletProfile | null;
  walletAddress: string | null;
  suggestedRole?: 'FARMER' | 'BUYER';
  onRegistered: () => void;
  onSwitchAccount: () => void;
  onDisconnect: () => void;
  switching: boolean;
}

// Farmer / buyer account: the connected wallet IS the login credential.
// Registration binds a human identity to it; an admin badge verifies it.
export const AccountPanel: React.FC<AccountPanelProps> = ({ profile, walletAddress, suggestedRole, onRegistered, onSwitchAccount, onDisconnect, switching }) => {
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'FARMER' | 'BUYER'>(suggestedRole || 'FARMER');
  const [location, setLocation] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Follow the door the user came through (farmer vs buyer login).
  useEffect(() => {
    if (!profile?.account?.displayName && suggestedRole) setRole(suggestedRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedRole]);

  if (!walletAddress) return null;
  const acct = profile?.account;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) { setError('Display name is required.'); return; }
    try {
      setSaving(true);
      const res = await fetch(`${BACKEND_URL}/api/users/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ walletAddress, role, displayName: displayName.trim(), location: location.trim(), contact: contact.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Registration failed.');
      onRegistered();
    } catch (err: any) {
      setError(err?.message || 'Registration failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <UserRound size={18} color="var(--primary)" />
        <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Account · wallet is your login
        </span>
      </div>

      {acct?.displayName ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '1.4rem', color: '#01472e' }}>{acct.displayName}</h3>
            {acct.verified ? (
              <span className="badge badge-grade-a"><BadgeCheck size={13} /> Verified {acct.role === 'FARMER' ? 'Farmer' : 'Buyer'}</span>
            ) : (
              <span className="badge badge-neutral"><ShieldAlert size={13} /> Pending verification</span>
            )}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '6px' }}>
            {acct.role} {[acct.location, acct.contact].filter(Boolean).join(' · ')}
          </p>
          {!acct.verified && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>
              An admin verifies farmer/buyer identities. Unverified accounts can still trade, but listings
              and orders show no verification badge.
            </p>
          )}
          <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '16px', paddingTop: '14px' }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
              Account settings
            </p>
            <p className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: '10px' }}>
              {walletAddress}
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={onSwitchAccount} disabled={switching}>
                {switching ? 'Waiting for MetaMask…' : 'Switch account'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onDisconnect}>Sign out</button>
            </div>
            <p className="ed-meta" style={{ marginTop: '8px' }}>Switch opens the MetaMask chooser — pick any imported wallet to continue as that identity.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleRegister}>
          <h3 style={{ fontSize: '1.3rem', color: '#01472e', marginBottom: '4px' }}>Create your account</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Your connected wallet <span className="font-mono">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span> is
            your login — no password to lose. Bind a name to it so counterparties know who they trade with.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label className="form-label">Display name *</label>
              <input className="form-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ramesh Patel" required maxLength={80} />
            </div>
            <div>
              <label className="form-label">I am a… *</label>
              <select className="form-input" value={role} onChange={(e) => setRole(e.target.value as 'FARMER' | 'BUYER')}>
                <option value="FARMER">Farmer (seller)</option>
                <option value="BUYER">Buyer</option>
              </select>
            </div>
            <div>
              <label className="form-label">Location</label>
              <input className="form-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Karnal, Haryana" maxLength={120} />
            </div>
            <div>
              <label className="form-label">Contact</label>
              <input className="form-input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="e.g. phone or shop name" maxLength={120} />
            </div>
          </div>
          {error && <p style={{ color: '#8f1d1d', fontSize: '0.85rem', marginBottom: '10px' }}>{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </div>
  );
};
