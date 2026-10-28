import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, MapPin, Thermometer, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { BACKEND_URL } from '../contracts';

interface Checkpoint {
  id: number;
  location: string;
  timestamp: number;
  temperature: number;
  status_note: string;
  latitude?: number | null;
  longitude?: number | null;
  weather_temp?: number | null;
  leaf_hash: string;
  proof?: string[];
}

interface TransitModalProps {
  orderId: number | null;
  onClose: () => void;
  onVerifyProofOnChain?: (orderId: number, leaf: string, proof: string[]) => Promise<boolean>;
  onReadChainProof?: (orderId: number) => Promise<{ merkleRoot: string; deliveryLeaf: string }>;
  onCommitCheckpoints?: (checkpoints: Array<{ location: string; temperature?: number; statusNote?: string; latitude?: string; longitude?: string; weatherTemp?: number }>) => Promise<any>;
}

export const TransitModal: React.FC<TransitModalProps> = ({
  orderId,
  onClose,
  onVerifyProofOnChain,
  onReadChainProof,
  onCommitCheckpoints,
}) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [merkleRoot, setMerkleRoot] = useState<string | null>(null);
  const [onchainRoot, setOnchainRoot] = useState<string | null>(null);
  const [onchainDeliveryLeaf, setOnchainDeliveryLeaf] = useState<string | null>(null);
  const [verifiedLeaves, setVerifiedLeaves] = useState<Record<string, boolean>>({});
  const [verifyError, setVerifyError] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);
  const [checkpointLocation, setCheckpointLocation] = useState('');
  const [checkpointTemperature, setCheckpointTemperature] = useState('');
  const [checkpointNote, setCheckpointNote] = useState('');
  const [commitError, setCommitError] = useState('');
  const [checkpointLat, setCheckpointLat] = useState('');
  const [checkpointLon, setCheckpointLon] = useState('');
  const [checkpointWeather, setCheckpointWeather] = useState<any>(null);
  const [loadingGps, setLoadingGps] = useState(false);

  // Phone-as-telemetry: GPS fix + observed route weather (Open-Meteo, no key).
  // Recorded as checkpoint evidence for jurors/buyers — NOT an IoT sensor,
  // and it never auto-adjusts payouts (that would need a price oracle).
  const handleUseGps = () => {
    if (!navigator.geolocation) { setCommitError('Geolocation unavailable on this device.'); return; }
    setLoadingGps(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCheckpointLat(String(p.coords.latitude.toFixed(5)));
        setCheckpointLon(String(p.coords.longitude.toFixed(5)));
        setCommitError('');
        setLoadingGps(false);
      },
      () => { setCommitError('GPS fix failed — enter the location manually.'); setLoadingGps(false); },
      { timeout: 8000 }
    );
  };
  const handleFetchWeather = async () => {
    if (!checkpointLat || !checkpointLon) { setCommitError('Capture a GPS fix first.'); return; }
    try {
      setLoadingGps(true);
      const w = await fetch(`${BACKEND_URL}/api/weather?lat=${checkpointLat}&lon=${checkpointLon}`).then((r) => r.json());
      if (!w?.success || w.temperatureC === null) throw new Error(w?.error || 'No weather data.');
      setCheckpointWeather(w);
      setCheckpointTemperature(String(w.temperatureC));
      setCommitError('');
    } catch (e: any) {
      setCommitError(e?.message || 'Weather lookup failed.');
    } finally {
      setLoadingGps(false);
    }
  };
  const [shipQr, setShipQr] = useState('');

  // QR for the shipping box: scans to the read-only audit page for this order.
  useEffect(() => {
    if (!orderId) { setShipQr(''); return; }
    QRCode.toDataURL(`${window.location.origin}/?inspect=order:${orderId}`, { width: 140, margin: 1 })
      .then(setShipQr).catch(() => setShipQr(''));
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;

    const fetchCheckpoints = async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`${BACKEND_URL}/api/checkpoints/${orderId}`);
        const data = await res.json();
        if (data.success && data.checkpoints.length > 0) {
          setCheckpoints(data.checkpoints);
          setMerkleRoot(data.merkleRoot);
        } else {
          // Honest empty state: no off-chain checkpoints indexed yet, and nothing
          // is claimed to be on-chain. Farmer/courier commits via the button below.
          setCheckpoints([]);
          setMerkleRoot(null);
        }
      } catch (err) {
        console.warn('Failed to load checkpoints:', err);
        setCheckpoints([]);
        setMerkleRoot(null);
      } finally {
        if (onReadChainProof) {
          try {
            const proofState = await onReadChainProof(orderId);
            setOnchainRoot(proofState.merkleRoot);
            setOnchainDeliveryLeaf(proofState.deliveryLeaf);
          } catch { setOnchainRoot(null); setOnchainDeliveryLeaf(null); }
        }
        setIsLoading(false);
      }
    };

    fetchCheckpoints();
  }, [orderId]);

  if (!orderId) return null;

  const handleVerify = async (cp: Checkpoint) => {
    if (!onVerifyProofOnChain || !orderId || !cp.leaf_hash || !cp.proof) {
      setVerifyError((prev) => ({ ...prev, [cp.leaf_hash]: 'No proof available — commit checkpoints on-chain first.' }));
      return;
    }
    try {
      const ok = await onVerifyProofOnChain(orderId, cp.leaf_hash, cp.proof);
      if (ok) setVerifiedLeaves((prev) => ({ ...prev, [cp.leaf_hash]: true }));
      else setVerifyError((prev) => ({ ...prev, [cp.leaf_hash]: 'On-chain verification returned false.' }));
    } catch (e: any) {
      setVerifyError((prev) => ({ ...prev, [cp.leaf_hash]: e?.message || 'Verification failed.' }));
    }
  };

  const handleCommitDemoRoute = async () => {
    if (!onCommitCheckpoints) return;
    try {
      setIsCommitting(true);
      await onCommitCheckpoints([
        { location: 'Farm Gate dispatch', temperature: 22, statusNote: 'Loaded into reefer transport' },
        { location: 'Highway Hub checkpoint', temperature: 4, statusNote: 'Cold chain stabilized at 4C' },
        { location: 'Distribution Dock arrival', temperature: 5, statusNote: 'Arrived at delivery terminal' },
      ]);
      const res = await fetch(`${BACKEND_URL}/api/checkpoints/${orderId}`);
      const data = await res.json();
      if (data?.success) { setCheckpoints(data.checkpoints); setMerkleRoot(data.merkleRoot); }
      if (onReadChainProof) {
        const proofState = await onReadChainProof(orderId);
        setOnchainRoot(proofState.merkleRoot);
        setOnchainDeliveryLeaf(proofState.deliveryLeaf);
      }
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCommitDeliveryCheckpoint = async () => {
    if (!onCommitCheckpoints || !checkpointLocation.trim() || !checkpointTemperature || !/deliver/i.test(checkpointNote)) {
      setCommitError('Enter the actual delivery location, temperature, and a note containing “delivered”.');
      return;
    }
    try {
      setCommitError('');
      setIsCommitting(true);
      await onCommitCheckpoints([{
        location: checkpointLocation.trim(),
        temperature: Number(checkpointTemperature),
        statusNote: checkpointNote.trim(),
        latitude: checkpointLat || undefined,
        longitude: checkpointLon || undefined,
        weatherTemp: checkpointWeather?.temperatureC ?? undefined,
      }]);
      const res = await fetch(`${BACKEND_URL}/api/checkpoints/${orderId}`);
      const data = await res.json();
      if (data?.success) { setCheckpoints(data.checkpoints); setMerkleRoot(data.merkleRoot); }
    } catch (e: any) {
      setCommitError(e?.message || 'Could not commit this checkpoint.');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} color="var(--primary)" />
              <h3 style={{ fontSize: '1.4rem', color: '#01472e' }}>Shipment #{orderId} Transit Provenance</h3>
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
              Merkle Root (checkpoint payload is off-chain; root is committed on-chain)
          </span>
          <code className="font-mono" style={{ fontSize: '0.78rem', color: '#01472e', display: 'block', marginTop: '4px', wordBreak: 'break-all' }}>
              On-chain root: {onchainRoot && !/^0x0{64}$/i.test(onchainRoot) ? onchainRoot : 'not committed'}
          </code>
          <p className="ed-meta" style={{ marginTop: '6px', wordBreak: 'break-all' }}>
            Off-chain payload root: {merkleRoot || 'No indexed checkpoint payload'}<br />
            On-chain designated delivery leaf: {onchainDeliveryLeaf && !/^0x0{64}$/i.test(onchainDeliveryLeaf) ? onchainDeliveryLeaf : 'not designated'}
          </p>
          {shipQr && (
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '10px' }}>
              <img src={shipQr} alt={`Audit QR for order ${orderId}`} style={{ width: '120px', height: '120px' }} />
              <p className="ed-meta">Box QR — the buyer scans this to open the read-only audit page for order #{orderId}.</p>
            </div>
          )}
          {checkpoints.length === 0 && !isLoading && (
            <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
              <strong style={{ color: '#01472e', fontSize: '0.85rem' }}>Record delivery checkpoint</strong>
              <input className="form-input" aria-label="Delivery location" placeholder="Actual delivery location" value={checkpointLocation} onChange={(e) => setCheckpointLocation(e.target.value)} />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={loadingGps} onClick={handleUseGps}>
                  {loadingGps ? 'Locating…' : checkpointLat ? `GPS ${checkpointLat}, ${checkpointLon}` : 'Use my GPS'}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={loadingGps || !checkpointLat} onClick={handleFetchWeather}>
                  Fetch route weather
                </button>
              </div>
              {checkpointWeather && (
                <p className="ed-meta">Observed at checkpoint: {checkpointWeather.temperatureC}°C, humidity {checkpointWeather.humidity}% (Open-Meteo, {checkpointWeather.observedAt || 'now'}).</p>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input className="form-input" aria-label="Temperature Celsius" type="number" step="0.1" placeholder="Temperature °C" value={checkpointTemperature} onChange={(e) => setCheckpointTemperature(e.target.value)} />
                <input className="form-input" aria-label="Delivery status note" placeholder="Status note must include delivered" value={checkpointNote} onChange={(e) => setCheckpointNote(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-sm" disabled={isCommitting || !onCommitCheckpoints} onClick={handleCommitDeliveryCheckpoint}>
                {isCommitting ? 'Committing delivery proof…' : 'Commit actual delivery checkpoint'}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={isCommitting || !onCommitCheckpoints} onClick={handleCommitDemoRoute}>
                {isCommitting ? 'Committing sample…' : 'Add synthetic sample route (DEMO)'}
              </button>
              <p className="ed-meta">The root is immutable for this order. Check values before submitting; this carrier-entered checkpoint is not independent proof of physical delivery.</p>
              {commitError && <span style={{ color: '#8f1d1d', fontSize: '0.78rem' }}>{commitError}</span>}
            </div>
          )}
          <p className="ed-meta" style={{ marginTop: '8px' }}>Sample route values are synthetic and do not prove a real shipment. Only the Merkle root is placed on-chain; checkpoint records remain in the local SQLite index.</p>
        </div>

        {/* Timeline */}
        <div style={{ position: 'relative', paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Vertical line */}
          <div style={{ position: 'absolute', left: '7px', top: '10px', bottom: '10px', width: '2px', background: 'rgba(1,71,46,0.15)' }} />

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

                <div style={{ background: 'rgba(1,71,46,0.05)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ color: '#01472e', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MapPin size={14} color="var(--primary)" />
                      {cp.location}
                    </strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{dateStr}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Thermometer size={14} color={cp.temperature <= 8 ? '#34d399' : '#f59e0b'} />
                      Temp: <strong style={{ color: '#01472e' }}>{cp.temperature}°C</strong>
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {cp.status_note}
                    </span>
                    {(cp.latitude || cp.weather_temp) && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {cp.latitude ? `GPS ${Number(cp.latitude).toFixed(3)}, ${Number(cp.longitude).toFixed(3)}` : ''}
                        {cp.weather_temp != null ? ` · route weather ${cp.weather_temp}°C (API)` : ''}
                      </span>
                    )}
                    {cp.weather_temp != null && Number(cp.weather_temp) >= 38 && (
                      <span style={{ fontSize: '0.75rem', color: '#8f1d1d', fontWeight: 700 }}>
                        🔥 heat exposure — flag for buyer/juror review
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(1,71,46,0.1)', paddingTop: '8px' }}>
                    <code className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Leaf: {cp.leaf_hash ? cp.leaf_hash.slice(0, 14) : '0x...'}...
                    </code>

                    {isVerified ? (
                      <span style={{ color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={13} /> Inclusion Proven On-Chain
                      </span>
                    ) : (
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleVerify(cp)}
                      >
                        Verify Proof On-Chain
                      </button>
                    )}
                    {verifyError[cp.leaf_hash] && (
                      <span style={{ color: '#8f1d1d', fontSize: '0.72rem' }}>{verifyError[cp.leaf_hash]}</span>
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
