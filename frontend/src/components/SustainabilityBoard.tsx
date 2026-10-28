import React, { useState, useEffect } from 'react';
import { Leaf } from 'lucide-react';
import { BACKEND_URL } from '../contracts';

// Leaderboard of self-reported sustainability credits per farmer.
// Demo units, openly not audited — the value is transparency, not offsets.
export const SustainabilityBoard: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/sustainability`).then((r) => r.json())
      .then((d) => setRows(d?.leaderboard || [])).catch(() => setRows([]));
  }, []);
  if (rows.length === 0) return null;
  return (
    <div className="glass-panel" style={{ padding: '24px', marginTop: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Leaf size={18} color="var(--primary)" />
        <h3 style={{ fontSize: '1.2rem', color: '#01472e' }}>Sustainability leaderboard</h3>
      </div>
      <p className="ed-meta" style={{ marginBottom: '12px' }}>Self-reported practices · demo credits, not audited offsets.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rows.map((r) => (
          <div key={r.farmer_address} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', background: 'rgba(1,71,46,0.05)', padding: '8px 14px', borderRadius: '10px' }}>
            <span>{r.display_name || `${r.farmer_address.slice(0, 6)}…${r.farmer_address.slice(-4)}`} · {r.batches} batch{Number(r.batches) === 1 ? '' : 'es'}</span>
            <strong>🌱 {Number(r.total_credits).toFixed(1)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};
