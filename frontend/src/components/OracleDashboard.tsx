import React, { useState } from 'react';
import { Cpu, ShieldCheck, Key, AlertTriangle, Layers, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { BACKEND_URL, CONTRACT_ADDRESSES } from '../contracts';

interface OracleDashboardProps {
  walletAddress: string | null;
  oracleProfile: { whitelisted: boolean; active: boolean; staked: string } | null;
  onStakeOracleBond: (amount: string) => Promise<void>;
}

export const OracleDashboard: React.FC<OracleDashboardProps> = ({
  walletAddress,
  oracleProfile,
  onStakeOracleBond,
}) => {
  const [stakeAmount, setStakeAmount] = useState('5000');
  const [isStaking, setIsStaking] = useState(false);

  // Inspection Studio State
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [cropType, setCropType] = useState('Apple');
  const [inspectionResult, setInspectionResult] = useState<any>(null);
  const [isInspecting, setIsInspecting] = useState(false);

  const handleRunStudioInspection = async () => {
    setIsInspecting(true);
    setInspectionResult(null);
    try {
      if (!selectedImage) throw new Error('Select an image first.');
      const form = new FormData();
      form.append('image', selectedImage);
      form.append('tokenId', '0');
      form.append('cropType', cropType);
      form.append('chainId', '31337');
      form.append('registryAddress', CONTRACT_ADDRESSES.OracleRegistry);
      const res = await fetch(`${BACKEND_URL}/api/ai/verify`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      setInspectionResult(res.ok ? data : { isFallback: true, error: data.error || data.detail || 'Image inspection failed.' });
    } catch (e) {
      // No fake signature: inspection studio is read-only without ai-service.
      setInspectionResult({ error: 'AI service unreachable. Start ai-service on :8001.', isFallback: true });
    } finally {
      setIsInspecting(false);
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      
      {/* Oracle Status Card */}
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
              <Cpu size={20} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Decentralized Oracle Node
              </span>
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>AI Verification & Staking Security</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
              Oracles must stake a minimum bond of 5,000 AGRI tokens. Fraudulent or disputed ratings are slashed by the DAO.
              Grading runs on the oracle server — the signing key never leaves it. The browser only relays the signed
              report, and the contract accepts it only from a whitelisted, bonded oracle.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '16px 20px', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Node Status</p>
              <span className={`badge ${oracleProfile?.active ? 'badge-grade-a' : 'badge-grade-c'}`} style={{ marginTop: '4px' }}>
                <CheckCircle2 size={12} /> {oracleProfile?.active ? 'Active & Bonded' : oracleProfile?.whitelisted ? 'Whitelisted; bond required' : 'Not whitelisted'}
              </span>
            </div>

            <div style={{ background: 'rgba(1,71,46,0.06)', padding: '16px 20px', borderRadius: '12px' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Minimum Required Bond</p>
              <strong style={{ color: '#01472e', fontSize: '1.2rem' }}>5,000 AGRI</strong>
            </div>
          </div>
        </div>

        {/* Staking Action Bar */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '24px', paddingTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={16} color="var(--primary)" />
            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Connected wallet oracle status: <code className="font-mono" style={{ color: '#01472e' }}>{walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'not connected'}</code> · {oracleProfile?.staked || '0'} AGRI staked
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input
              type="number"
              className="form-input"
              style={{ width: '140px', padding: '8px 12px' }}
              value={stakeAmount}
              onChange={(e) => setStakeAmount(e.target.value)}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={isStaking}
              onClick={async () => {
                try {
                  setIsStaking(true);
                  await onStakeOracleBond(stakeAmount);
                } finally {
                  setIsStaking(false);
                }
              }}
            >
              {isStaking ? 'Staking Bond...' : 'Deposit Oracle Bond'}
            </button>
          </div>
        </div>
      </div>

      {/* Live Inspection Studio */}
      <div className="glass-panel" style={{ padding: '32px' }}>
        <h3 style={{ fontSize: '1.4rem', color: '#01472e', marginBottom: '8px' }}>
          AI Quality Inspection Studio
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '24px' }}>
          Upload an image for a FruitNet-trained model preview. This token ID 0 preview does not verify an NFT; farmer verification is signed against the actual minted batch ID.
        </p>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <select className="form-input" style={{ maxWidth: '280px' }} value={cropType} onChange={(e) => setCropType(e.target.value)} aria-label="Fruit type">
            {['Apple', 'Banana', 'Guava', 'Lime', 'Orange', 'Pomegranate', 'Mango', 'Tomato', 'Potato', 'Strawberry', 'Bellpepper', 'Cucumber', 'Carrot', 'Wheat', 'Rice', 'Maize', 'Other'].map((crop) => <option key={crop}>{crop}</option>)}
          </select>
          <input className="form-input" style={{ maxWidth: '360px' }} type="file" accept="image/*" onChange={(e) => { setSelectedImage(e.target.files?.[0] || null); setInspectionResult(null); }} />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleRunStudioInspection}
          disabled={isInspecting || !selectedImage}
          style={{ marginBottom: '24px' }}
        >
          {isInspecting ? 'Analyzing uploaded image…' : 'Preview image grade'}
        </button>

        {/* Results Panel */}
        {inspectionResult && !inspectionResult.isFallback && (
          <div style={{ background: 'rgba(233,237,201,1)', border: '1px solid var(--border-subtle)', borderRadius: '16px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Classification Result</span>
                <h4 style={{ fontSize: '1.4rem', color: '#01472e', marginTop: '2px' }}>
                  {cropType}
                </h4>
              </div>
              <div>
                <span className={`badge ${
                  inspectionResult.grade === 1 ? 'badge-grade-a' :
                  inspectionResult.grade === 2 ? 'badge-grade-b' : 'badge-rejected'
                }`} style={{ fontSize: '1rem', padding: '6px 14px' }}>
                  {inspectionResult.qualityLabel} · {inspectionResult.gradingMethod === 'heuristic-screening' ? 'rule-based screening' : 'uncalibrated model score'} {inspectionResult.confidencePercent}%
                </span>
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Model</span>
                <h5 style={{ color: '#01472e', fontSize: '1.2rem', marginTop: '4px' }}>
                  MobileNetV3-Small
                </h5>
              </div>
              <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Training photos</span>
                <h5 style={{ color: '#01472e', fontSize: '1.2rem', marginTop: '4px' }}>
                  {inspectionResult.report?.metrics?.datasetImageCount ?? inspectionResult.datasetImageCount ?? 'FruitNet'}
                </h5>
              </div>
              <div style={{ background: 'rgba(1,71,46,0.06)', padding: '14px', borderRadius: '10px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Held-out test accuracy</span>
                <h5 style={{ color: '#01472e', fontSize: '1.2rem', marginTop: '4px' }}>
                  {inspectionResult.report?.metrics?.heldOutTestAccuracy != null ? `${(inspectionResult.report.metrics.heldOutTestAccuracy * 100).toFixed(1)}%` : '—'}
                </h5>
              </div>
            </div>

            {/* Cryptographic Artifacts */}
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '6px' }}>
                Canonical Report keccak256 Hash:
              </p>
              <code className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--accent-gold)', display: 'block', wordBreak: 'break-all' }}>
                {inspectionResult.reportHash}
              </code>

              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '12px', marginBottom: '6px' }}>
                Signature is generated for preview token ID 0 and is not a valid NFT verification:
              </p>
              <code className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--primary)', display: 'block', wordBreak: 'break-all' }}>
                Not for submission
              </code>
            </div>
          </div>
        )}
        {inspectionResult?.isFallback && (
          <div style={{ background: 'rgba(180,35,35,0.07)', border: '1px solid rgba(180,35,35,0.3)', borderRadius: '16px', padding: '24px' }}>
            <p style={{ color: '#8f1d1d', fontSize: '0.9rem' }}>{inspectionResult.error || 'Image inspection failed. No grade is shown.'}</p>
          </div>
        )}
      </div>

    </div>
  );
};
