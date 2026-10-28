import React, { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { ethers } from 'ethers';
import { BACKEND_URL, RPC_URL } from '../contracts';

// Platform Operator surface: liveness of every tier in one place.
// Read-only. The operator runs infrastructure; it holds no keys and signs nothing.
export const SystemPanel: React.FC = () => {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const s: any = { chain: null, backend: null, ai: null };
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const [net, block] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
        s.chain = { ok: true, label: `Chain ${Number(net.chainId)} · block ${block}` };
      } catch { s.chain = { ok: false, label: 'Chain unreachable' }; }
      try {
        const h = await fetch(`${BACKEND_URL}/health`).then((r) => r.json());
        s.backend = h?.status === 'healthy'
          ? { ok: true, label: `Indexer healthy` }
          : { ok: false, label: 'Indexer unhealthy' };
      } catch { s.backend = { ok: false, label: 'Indexer unreachable' }; }
      try {
        const h = await fetch(`${BACKEND_URL}/api/ai/health`).then((r) => r.json());
        const ai = h?.ai;
        s.ai = h?.success && ai?.status === 'healthy'
          ? { ok: true, label: `AI ${ai.model || 'oracle'} · acc ${ai.testAccuracy ?? '—'}` }
          : { ok: false, label: 'AI service unreachable' };
      } catch { s.ai = { ok: false, label: 'AI service unreachable' }; }
      setStatus(s);
    })();
  }, []);

  const rows = status
    ? [['Blockchain (source of truth)', status.chain], ['Backend indexer (cache)', status.backend], ['AI oracle service', status.ai]]
    : [];

  return (
    <div className="glass-panel" style={{ padding: '28px', marginTop: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <Activity size={20} color="var(--primary)" />
        <h3 style={{ fontSize: '1.25rem', color: '#01472e' }}>System Status · Operator View</h3>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
        Liveness of every tier. If backend and chain ever disagree, the chain wins.
      </p>
      {!status ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Probing services…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rows.map(([k, v]: any) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(1,71,46,0.05)', padding: '10px 16px', borderRadius: '10px' }}>
              <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{k}</span>
              <span className={`badge ${v.ok ? 'badge-grade-a' : 'badge-rejected'}`} style={{ fontSize: '0.75rem' }}>{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
