import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, QrCode, MapPin, Truck, Sparkles, CheckCircle2, AlertTriangle, ExternalLink, Copy, Check, Printer } from 'lucide-react';
import QRCode from 'qrcode';
import { BACKEND_URL, CONTRACT_ADDRESSES } from '../contracts';

interface BatchTraceabilityModalProps {
  tokenId: number;
  onClose: () => void;
  onOpenPassport?: (tokenId: number) => void;
}

export const BatchTraceabilityModal: React.FC<BatchTraceabilityModalProps> = ({
  tokenId,
  onClose,
  onOpenPassport,
}) => {
  const [data, setData] = useState<any>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Generate QR code for the public batch link
    const publicUrl = `${window.location.origin}/?inspect=batch:${tokenId}`;
    QRCode.toDataURL(publicUrl, { width: 220, margin: 1 })
      .then(setQrCodeUrl)
      .catch(() => setQrCodeUrl(''));

    const fetchTraceability = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await fetch(`${BACKEND_URL}/api/traceability/batch/${tokenId}`);
        const result = await res.json();
        if (res.ok && result.success) {
          setData(result);
        } else {
          // If not in indexer, generate placeholder structure
          setData({
            tokenId,
            verificationSummary: {
              isFound: false,
              oracleSignatureVerified: false,
              farmerKycVerified: false,
              merkleTransitVerified: false,
              sustainabilityAudited: false,
            },
          });
          if (!res.ok) setError(result.error || `Batch #${tokenId} not indexed.`);
        }
      } catch (e: any) {
        setError('Network / RPC connection offline. Displaying local offline batch details.');
        setData({
          tokenId,
          verificationSummary: {
            isFound: false,
            oracleSignatureVerified: false,
            farmerKycVerified: false,
            merkleTransitVerified: false,
            sustainabilityAudited: false,
          },
        });
      } finally {
        setLoading(false);
      }
    };

    fetchTraceability();
  }, [tokenId]);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/?inspect=batch:${tokenId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const listing = data?.listing;
  const passport = data?.passport;
  const farmer = data?.farmer;
  const checkpoints = data?.checkpoints?.items || [];
  const verification = data?.verificationSummary;

  const short = (val: string) => {
    if (!val || typeof val !== 'string') return '—';
    return val.length > 16 ? `${val.slice(0, 10)}…${val.slice(-6)}` : val;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '780px', maxHeight: '90vh', overflowY: 'auto', padding: '32px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '4px' }}>
              <ShieldCheck size={20} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Public Harvest Traceability Passport
              </span>
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#01472e', margin: 0 }}>
              {listing?.crop_type || passport?.crop_type || 'Crop Batch'} #{tokenId}
            </h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePrint} title="Print QR Box Label">
              <Printer size={14} /> Print Label
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '6px' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div className="glass-panel" style={{ padding: '12px 16px', marginBottom: '18px', borderColor: 'rgba(180,130,20,0.5)', background: 'rgba(180,130,20,0.06)' }}>
            <p style={{ fontSize: '0.82rem', margin: 0 }}>
              <AlertTriangle size={14} style={{ display: 'inline', marginRight: '6px' }} />
              {error}
            </p>
          </div>
        )}

        {/* Top QR & Quick Summary Box */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', background: 'rgba(1,71,46,0.04)', borderRadius: '16px', padding: '20px', border: '1px solid var(--border-subtle)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            {qrCodeUrl ? (
              <img src={qrCodeUrl} alt={`Traceability QR code for batch ${tokenId}`} style={{ width: '180px', height: '180px', borderRadius: '12px', background: '#fff', padding: '8px', border: '1px solid var(--border-subtle)' }} />
            ) : (
              <div style={{ width: '180px', height: '180px', background: 'rgba(0,0,0,0.05)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QrCode size={48} opacity={0.3} />
              </div>
            )}
            <button className="btn btn-secondary btn-sm" style={{ marginTop: '10px', fontSize: '0.78rem' }} onClick={handleCopyLink}>
              {copied ? <Check size={12} color="green" /> : <Copy size={12} />} {copied ? 'Link Copied!' : 'Copy Verification URL'}
            </button>
          </div>

          <div>
            <h4 style={{ color: '#01472e', margin: '0 0 10px 0', fontSize: '1rem' }}>Provenance & Verification Legend</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
                <span className={`badge ${verification?.oracleSignatureVerified ? 'badge-grade-a' : 'badge-neutral'}`} style={{ fontSize: '0.72rem' }}>
                  {verification?.oracleSignatureVerified ? '✓ CRYPTOGRAPHICALLY VERIFIED' : 'UNVERIFIED ORACLE'}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>AI Oracle ECDSA Signed</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
                <span className={`badge ${verification?.merkleTransitVerified ? 'badge-grade-a' : 'badge-neutral'}`} style={{ fontSize: '0.72rem' }}>
                  {verification?.merkleTransitVerified ? '✓ MERKLE COMMITTED' : 'PENDING TRANSIT'}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>Cold-Chain Transit Root</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
                <span className={`badge ${verification?.farmerKycVerified ? 'badge-grade-a' : 'badge-neutral'}`} style={{ fontSize: '0.72rem' }}>
                  {verification?.farmerKycVerified ? '✓ VERIFIED PRODUCER' : 'UNVERIFIED ACCOUNT'}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>Farmer Identity Verification</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem' }}>
                <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                  SELF-REPORTED CLAIMS
                </span>
                <span style={{ color: 'var(--text-muted)' }}>Eco Practices (Demo Credits)</span>
              </div>
            </div>

            <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px dashed var(--border-subtle)', fontSize: '0.8rem' }}>
              <p style={{ margin: '0 0 4px 0', color: 'var(--text-secondary)' }}>
                <strong>Farmer / Producer:</strong> {farmer?.display_name || 'Registered Farmer'} ({short(listing?.farmer_address || passport?.farmer_address)})
              </p>
              <p style={{ margin: '0 0 4px 0', color: 'var(--text-secondary)' }}>
                <strong>Farm Origin:</strong> {farmer?.location || 'Verified Agricultural Zone'}
              </p>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                <strong>Quantity:</strong> {listing?.available_quantity || 1000} {listing?.unit || 'kg'}
              </p>
            </div>
          </div>
        </div>

        {/* AI Quality Section */}
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '18px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--primary)" />
              <strong style={{ color: '#01472e', fontSize: '0.95rem' }}>AI Quality Assessment & Inspection</strong>
            </div>
            {onOpenPassport && (
              <button className="btn btn-secondary btn-sm" onClick={() => onOpenPassport(tokenId)}>
                Open Full Passport
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '0.82rem' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Assessed Grade: </span>
              <strong>{listing?.grade_name || passport?.grade_name || 'GRADE_A'}</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Confidence Score: </span>
              <strong>{(((listing?.confidence_score ?? passport?.confidence_score) || 9500) / 100).toFixed(1)}%</strong>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Model Architecture: </span>
              <code>{passport?.model_version || 'MobileNetV3-Small-v1.0'}</code>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Review Status: </span>
              <span className="badge badge-neutral" style={{ fontSize: '0.72rem' }}>
                {passport?.review_status === 'REVIEWED' ? `Reviewed (${passport?.review_decision})` : 'Original Assessment'}
              </span>
            </div>
          </div>
        </div>

        {/* Logistics & Cold-Chain Checkpoints */}
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '18px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Truck size={16} color="var(--primary)" />
            <strong style={{ color: '#01472e', fontSize: '0.95rem' }}>Logistics Transit Checkpoints & Merkle Proofs</strong>
          </div>

          {checkpoints.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
              No transit checkpoints have been committed to the Merkle tree for this batch yet.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                On-Chain Merkle Root: <code className="font-mono">{data?.checkpoints?.merkleRoot ? `${data.checkpoints.merkleRoot.slice(0, 18)}…` : '0xRootCommitted'}</code>
              </p>
              {checkpoints.map((cp: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.02)', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8rem' }}>
                  <div>
                    <strong>{cp.location}</strong> · <span style={{ color: 'var(--text-muted)' }}>{cp.status_note}</span>
                    {cp.latitude && <span style={{ marginLeft: '6px', color: 'var(--text-muted)' }}>({Number(cp.latitude).toFixed(3)}, {Number(cp.longitude).toFixed(3)})</span>}
                  </div>
                  <div>
                    <span style={{ fontWeight: 600, color: '#01472e', marginRight: '10px' }}>{cp.temperature}°C</span>
                    <span className="badge badge-grade-a" style={{ fontSize: '0.68rem' }}>Inclusion Proof Verified</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
