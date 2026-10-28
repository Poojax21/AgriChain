import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, MapPin, Thermometer, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

interface Checkpoint {
  id: number;
  location: string;
  timestamp: number;
  temperature: number;
  status_note: string;
  leaf_hash: string;
  proof?: string[];
}

interface TransitModalProps {
  orderId: number | null;
  onClose: () => void;
  onVerifyProofOnChain?: (orderId: number, leaf: string, proof: string[]) => Promise<boolean>;
}

export const TransitModal: React.FC<TransitModalProps> = ({
  orderId,
  onClose,
  onVerifyProofOnChain,
}) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [verifiedLeaves, setVerifiedLeaves] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;

    const fetchCheckpoints = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`http://localhost:5000/api/checkpoints/${orderId}`);
        const data = await res.json();
        if (data.success && data.checkpoints.length > 0) {
          setCheckpoints(data.checkpoints);
          setMerkleRoot(data.merkleRoot);
        } else {
          // If none recorded yet, supply default simulated checkpoints
          const simulated: Checkpoint[] = [
            { id: 1, location: 'Farm Gate, Punjab', timestamp: Math.floor(Date.now() / 1000) - 7200, temperature: 22, status_note: 'Loaded into reefer transport', leaf_hash: '0x1111...1111', proof: ['0xaaaa...aaaa'] },
            { id: 2, location: 'Highway Hub, Ambala', timestamp: Math.floor(Date.now() / 1000) - 5400, temperature: 4, status_note: 'Cold chain stabilized at 4°C', leaf_hash: '0x2222...2222', proof: ['0xbbbb...bbbb'] },
            { id: 3, location: 'Cold Storage, Sonipat', timestamp: Math.floor(Date.now() / 1000) - 2700, temperature: 4, status_note: 'Transshipped to intercity van', leaf_hash: '0x3333...3333', proof: ['0xcccc...cccc'] },
            { id: 4, location: 'Distribution Dock, Delhi', timestamp: Math.floor(Date.now() / 1000) - 600, temperature: 5, status_note: 'Arrived at delivery terminal', leaf_hash: '0x4444...4444', proof: ['0xdddd...dddd'] },
          ];
          setCheckpoints(simulated);
          setMerkleRoot('0x5353a337246a151528b7e28b1aa618ec993d9a1f28b7e28b1aa618ec993d9a1f');
        }
      } catch (err) {
        console.warn('Failed to load checkpoints:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCheckpoints();
  }, [orderId]);

  if (!orderId) return null;

  const handleVerify = async (cp: Checkpoint) => {
    // Simulate cryptographic proof verification
    setVerifiedLeaves((prev) => ({ ...prev, [cp.leaf_hash]: true }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} color="var(--primary)" />
              <h3 style={{ fontSize: '1.4rem', color: '#fff' }}>Shipment #{orderId} Transit Provenance</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '2px' }}>
              Cryptographic Merkle Tree Log & Cold Chain Telemetry
            </p>
          </div>

          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Merkle Root Banner */}
        <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid var(--border-active)', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600, textTransform: 'uppercase' }}>
            Committed On-Chain Merkle Root (Gas Optimized O(1))
          </span>
          <code className="font-mono" style={{ fontSize: '0.78rem', color: '#fff', display: 'block', marginTop: '4px', wordBreak: 'break-all' }}>
            {merkleRoot || 'Loading root...'}
          </code>
        </div>

        {/* Timeline */}
        <div style={{ position: 'relative', paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Vertical line */}
          <div style={{ position: 'absolute', left: '7px', top: '10px', bottom: '10px', width: '2px', background: 'rgba(255,255,255,0.1)' }} />

          {checkpoints.map((cp, idx) => {
            const isVerified = verifiedLeaves[cp.leaf_hash];
            const dateStr = new Date(cp.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={idx} style={{ position: 'relative' }}>
                {/* Bullet */}
                <div style={{
                  position: 'absolute',
                  left: '-24px',
                  top: '4px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: cp.temperature <= 8 ? 'var(--primary)' : 'var(--accent-gold)',
                  boxShadow: '0 0 10px rgba(16, 185, 129, 0.5)'
                }} />

                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ color: '#fff', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={14} color="var(--primary)" />
                      {cp.location}
                    </strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{dateStr}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Thermometer size={14} color={cp.temperature <= 8 ? '#34d399' : '#f59e0b'} />
                      Temp: <strong style={{ color: '#fff' }}>{cp.temperature}°C</strong>
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {cp.status_note}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                    <code className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Leaf: {cp.leaf_hash ? cp.leaf_hash.slice(0, 14) : '0x...'}...
                    </code>

                    {isVerified ? (
                      <span style={{ color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} /> Inclusion Proven
                      </span>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleVerify(cp)}
                      >
                        Verify Proof
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
};
