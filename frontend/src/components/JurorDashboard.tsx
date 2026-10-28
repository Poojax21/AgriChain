import React, { useState } from 'react';
import { Scale, Award, ShieldAlert, Check, X, Divide, CheckCircle2, Clock } from 'lucide-react';

interface Dispute {
  dispute_id: number;
  order_id: number;
  buyer_address: string;
  farmer_address: string;
  oracle_node: string;
  evidence_hash: string;
  verdict: string;
  is_resolved: number;
}

interface JurorDashboardProps {
  disputes: Dispute[];
  walletAddress: string | null;
  jurorStakedBalance: string;
  onStakeJurorTokens: (amount: string) => Promise<void>;
  onUnstakeJurorTokens: (amount: string) => Promise<void>;
  onCastVote: (disputeId: number, choice: number) => Promise<void>;
  onResolveDispute: (disputeId: number) => Promise<void>;
}

export const JurorDashboard: React.FC<JurorDashboardProps> = ({
  disputes,
  walletAddress,
  jurorStakedBalance,
  onStakeJurorTokens,
  onUnstakeJurorTokens,
  onCastVote,
  onResolveDispute,
}) => {
  const [stakeInput, setStakeInput] = useState('1000');
  const [isProcessing, setIsProcessing] = useState(false);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      
      {/* Header & Staking Banner */}
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
              <Scale size={20} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DisputeDAO Governance
              </span>
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#fff' }}>Stake-Weighted Juror Arbitration</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
              Stake AGRI tokens to become an active juror. Vote honestly on disputed harvests to earn rewards and slash dishonest actors.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 20px', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Your Staked Collateral</p>
              <h3 style={{ fontSize: '1.5rem', color: '#fff' }}>
                {parseFloat(jurorStakedBalance).toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>AGRI</span>
              </h3>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 20px', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Voting Power Weight</p>
              <h3 style={{ fontSize: '1.5rem', color: 'var(--accent-gold)' }}>
                {parseFloat(jurorStakedBalance).toLocaleString()} Votes
              </h3>
            </div>
          </div>
        </div>

        {/* Staking Controls */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '24px', paddingTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Minimum Juror Stake: <strong style={{ color: '#fff' }}>1,000 AGRI</strong>
          </span>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input
              type="number"
              className="form-input"
              style={{ width: '140px', padding: '8px 12px' }}
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={isProcessing}
              onClick={async () => {
                try {
                  setIsProcessing(true);
                  await onStakeJurorTokens(stakeInput);
                } finally {
                  setIsProcessing(false);
                }
              }}
            >
              {isProcessing ? 'Staking...' : 'Stake Tokens'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={isProcessing}
              onClick={async () => {
                try {
                  setIsProcessing(true);
                  await onUnstakeJurorTokens(stakeInput);
                } finally {
                  setIsProcessing(false);
                }
              }}
            >
              Unstake
            </button>
          </div>
        </div>
      </div>

      {/* Active Disputes Section */}
      <div className="glass-panel" style={{ padding: '32px' }}>
        <h3 style={{ fontSize: '1.4rem', color: '#fff', marginBottom: '8px' }}>
          Active Arbitration Cases
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
          Review evidence, compare photographic proof with oracle reports, and cast your stake-weighted verdict.
        </p>

        {disputes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={48} color="var(--primary)" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
            <h4 style={{ color: '#fff', marginBottom: '6px' }}>Zero Active Disputes</h4>
            <p style={{ fontSize: '0.9rem' }}>All marketplace shipments are currently fulfilled smoothly with zero unresolved claims.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {disputes.map((dispute) => (
              <div
                key={dispute.dispute_id}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '16px',
                  padding: '24px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h4 style={{ fontSize: '1.25rem', color: '#fff' }}>Dispute #{dispute.dispute_id}</h4>
                      <span className={`badge ${dispute.is_resolved ? 'badge-grade-a' : 'badge-grade-c'}`}>
                        {dispute.is_resolved ? 'SETTLED' : 'VOTING ACTIVE'}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '4px' }}>
                      Linked Order #{dispute.order_id} • Buyer: {dispute.buyer_address.slice(0, 6)}...{dispute.buyer_address.slice(-4)} • Farmer: {dispute.farmer_address.slice(0, 6)}...{dispute.farmer_address.slice(-4)}
                    </p>
                  </div>

                  {dispute.oracle_node && (
                    <div className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                      Assigned Oracle: {dispute.oracle_node.slice(0, 6)}...{dispute.oracle_node.slice(-4)}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    Photographic Defect Claim & IPFS Evidence Digest:
                  </span>
                  <code className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--accent-gold)', wordBreak: 'break-all' }}>
                    {dispute.evidence_hash}
                  </code>
                </div>

                {/* Voting Choices */}
                {!dispute.is_resolved ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onCastVote(dispute.dispute_id, 1)}
                      >
                        <Check size={14} />
                        Vote: Refund Buyer (1)
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCastVote(dispute.dispute_id, 2)}
                      >
                        <X size={14} />
                        Vote: Pay Farmer (2)
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onCastVote(dispute.dispute_id, 3)}
                      >
                        <Divide size={14} />
                        Vote: Split 50/50 (3)
                      </button>
                    </div>

                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => onResolveDispute(dispute.dispute_id)}
                    >
                      <Clock size={14} />
                      Tally & Execute Verdict
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)' }}>
                    <CheckCircle2 size={16} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Verdict Executed: {dispute.verdict}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};
