import React, { useState, useEffect } from 'react';
import { Scale, Award, ShieldAlert, Check, X, Divide, CheckCircle2, Clock, History } from 'lucide-react';
import { BACKEND_URL } from '../contracts';
import { readContracts, readOnlyProvider } from '../web3/tx';

interface Dispute {
  dispute_id: number;
  order_id: number;
  buyer_address: string;
  farmer_address: string;
  oracle_node: string;
  evidence_hash: string;
  evidence_url?: string;
  claim_text?: string;
  verdict: string;
  is_resolved: number;
}

interface JurorDashboardProps {
  disputes: Dispute[];
  orders: any[];
  listings: any[];
  walletAddress: string | null;
  jurorStakedBalance: string;
  onStakeJurorTokens: (amount: string) => Promise<void>;
  onUnstakeJurorTokens: (amount: string) => Promise<void>;
  onCastVote: (disputeId: number, choice: number) => Promise<void>;
  onResolveDispute: (disputeId: number) => Promise<void>;
}

export const JurorDashboard: React.FC<JurorDashboardProps> = ({
  disputes,
  orders,
  listings,
  walletAddress,
  jurorStakedBalance,
  onStakeJurorTokens,
  onUnstakeJurorTokens,
  onCastVote,
  onResolveDispute,
}) => {
  const [stakeInput, setStakeInput] = useState('1000');
  const [isProcessing, setIsProcessing] = useState(false);
  const [myVotes, setMyVotes] = useState<any[]>([]);

  // Voting history, read live from VoteCast events — not stored anywhere off-chain.
  useEffect(() => {
    if (!walletAddress) { setMyVotes([]); return; }
    (async () => {
      try {
        const dao = readContracts(readOnlyProvider()).dao as any;
        const events = await dao.queryFilter(dao.filters.VoteCast(null, walletAddress));
        setMyVotes(events.map((e: any) => ({
          disputeId: Number(e.args.disputeId),
          choice: Number(e.args.choice),
          weight: e.args.weight.toString(),
        })).reverse());
      } catch { setMyVotes([]); }
    })();
  }, [walletAddress, disputes]);

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
            <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>Stake-Weighted Juror Arbitration</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
              Stake AGRI tokens to become an active juror. Vote honestly on disputed harvests to earn rewards and slash dishonest actors.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '16px 20px', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Your Staked Collateral</p>
              <h3 style={{ fontSize: '1.5rem', color: '#01472e' }}>
                {parseFloat(jurorStakedBalance).toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>AGRI</span>
              </h3>
            </div>

            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '16px 20px', borderRadius: '12px' }}>
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
            Minimum Juror Stake: <strong style={{ color: '#01472e' }}>1,000 AGRI</strong>
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

      {/* Voting history */}
      {walletAddress && myVotes.length > 0 && (
        <div className="glass-panel" style={{ padding: '28px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <History size={18} color="var(--primary)" />
            <h3 style={{ fontSize: '1.2rem', color: '#01472e' }}>My voting record (on-chain events)</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {myVotes.map((v, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', background: 'rgba(1,71,46,0.05)', padding: '8px 14px', borderRadius: '10px' }}>
                <span>Case #{v.disputeId} · voted {['—', 'Refund Buyer', 'Pay Farmer', 'Split 50/50'][v.choice] || v.choice}</span>
                <strong>{(parseFloat(v.weight) / 1e18).toLocaleString()} weight</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Disputes Section */}
      <div className="glass-panel" style={{ padding: '32px' }}>
        <h3 style={{ fontSize: '1.4rem', color: '#01472e', marginBottom: '8px' }}>
          Active Arbitration Cases
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
              Review the claim hash and any evidence shared off-platform, then cast your stake-weighted verdict.
        </p>

        {disputes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={48} color="var(--primary)" style={{ margin: '0 auto 16px', opacity: 0.8 }} />
                  <h4 style={{ color: '#01472e', marginBottom: '6px' }}>No Dispute Cases</h4>
                  <p style={{ fontSize: '0.9rem' }}>No disputes have been opened on the connected network.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {disputes.map((dispute) => (
              <div
                key={dispute.dispute_id}
                style={{
                  background: 'rgba(1,71,46,0.05)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '16px',
                  padding: '24px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h4 style={{ fontSize: '1.25rem', color: '#01472e' }}>Dispute #{dispute.dispute_id}</h4>
                      <span className={`badge ${dispute.is_resolved ? 'badge-grade-a' : 'badge-grade-c'}`}>
                        {dispute.is_resolved ? 'SETTLED' : 'VOTING ACTIVE'}
                      </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '4px' }}>
                      Linked Order #{dispute.order_id} • Buyer: {(dispute.buyer_address || '').slice(0, 6)}...{(dispute.buyer_address || '').slice(-4)} • Farmer: {(dispute.farmer_address || '').slice(0, 6)}...{(dispute.farmer_address || '').slice(-4)}
                    </p>
                  </div>

                  {dispute.oracle_node && (
                    <div className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                      Assigned Oracle: {(dispute.oracle_node || '').slice(0, 6)}...{(dispute.oracle_node || '').slice(-4)}
                    </div>
                  )}
                </div>

                <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px', marginBottom: '20px' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                    On-chain evidence commitment (SHA-256 of the unboxing photo):
                  </span>
                  <code className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--accent-gold)', wordBreak: 'break-all' }}>
                    {dispute.evidence_hash}
                  </code>
                  {dispute.claim_text && (
                    <p style={{ fontSize: '0.85rem', color: '#01472e', marginTop: '8px' }}>
                      Buyer claim: “{dispute.claim_text}”
                    </p>
                  )}
                </div>

                {(() => {
                  const order = (orders || []).find((o: any) => o.order_id === dispute.order_id);
                  const listing = (listings || []).find((l: any) => order && l.listing_id === order.listing_id);
                  const originalImg = listing?.image_url;
                  const unboxingImg = dispute.evidence_url ? `${BACKEND_URL}${dispute.evidence_url}` : null;
                  if (!originalImg && !unboxingImg) return null;
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>AI-graded listing photo</span>
                        {originalImg ? (
                          <img src={originalImg} alt="AI-graded listing" style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '10px', marginTop: '6px' }} />
                        ) : (<p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Not available for this order.</p>)}
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Buyer unboxing photo (hash-committed)</span>
                        {unboxingImg ? (
                          <img src={unboxingImg} alt="Buyer unboxing evidence" style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '10px', marginTop: '6px' }} />
                        ) : (<p style={{ fontSize: '0.8rem', color: '#8f1d1d' }}>No photo attached — vote for the farmer.</p>)}
                      </div>
                    </div>
                  );
                })()}

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
