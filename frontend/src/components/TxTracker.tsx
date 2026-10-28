import React from 'react';
import type { TxState } from '../web3/tx';

const STAGE_LABEL: Record<string, string> = {
  idle: 'Idle',
  waiting: 'Waiting for MetaMask…',
  submitted: 'Transaction submitted',
  confirming: 'Confirming on-chain…',
  confirmed: 'Confirmed on-chain',
  failed: 'Failed',
};

export const TxTracker: React.FC<{ tx: TxState }> = ({ tx }) => {
  if (tx.stage === 'idle') return null;
  const ok = tx.stage === 'confirmed';
  const bad = tx.stage === 'failed';
  return (
    <div
      className="glass-panel"
      style={{
        padding: '14px 18px',
        marginBottom: '16px',
        borderColor: ok ? 'rgba(1,71,46,0.5)' : bad ? 'rgba(127,29,29,0.5)' : undefined,
      }}
    >
      <p className="ed-label">{tx.label} · {STAGE_LABEL[tx.stage]}</p>
      {tx.hash && (
        <code className="font-mono" style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: '#01472e' }}>
          tx {tx.hash}
        </code>
      )}
      {bad && <p style={{ color: '#7f1d1d', fontSize: '0.85rem', marginTop: '6px' }}>{tx.error}</p>}
      {ok && <p className="ed-meta" style={{ marginTop: '6px' }}>Chain-confirmed — backend indexer will follow.</p>}
      {!ok && !bad && <p className="ed-meta" style={{ marginTop: '6px' }}>Do not close MetaMask. Success shows only after receipt.</p>}
    </div>
  );
};
