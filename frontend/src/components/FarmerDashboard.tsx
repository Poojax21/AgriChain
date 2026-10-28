import React, { useState, useEffect, useRef } from 'react';
import { Sprout, Upload, Sparkles, CheckCircle2, ShieldCheck, Truck, PackageCheck, AlertCircle, Mic, Leaf, Camera, MapPin, QrCode } from 'lucide-react';
import { BACKEND_URL, CONTRACT_ADDRESSES } from '../contracts';

interface Order {
  order_id: number;
  listing_id: number;
  token_id: number;
  buyer_address: string;
  farmer_address: string;
  quantity: number;
  total_amount: string;
  platform_fee: string;
  status: string;
}

interface FarmerDashboardProps {
  walletAddress: string | null;
  orders: Order[];
  onMintAndList: (batchData: any) => Promise<void>;
  onShipOrder: (orderId: number) => Promise<void>;
  onTraceBatch?: (tokenId: number) => void;
}

const DEMO_CROP_IMAGES = [
  { label: 'Apple · Good reference photo', file: 'apple-good.jpg', crop: 'Apple' },
  { label: 'Banana · Mixed reference photo', file: 'banana-mixed.jpg', crop: 'Banana' },
  { label: 'Guava · Bad reference photo', file: 'guava-bad.jpg', crop: 'Guava' },
  { label: 'Lime · Good reference photo', file: 'lime-good.jpg', crop: 'Lime' },
  { label: 'Orange · Mixed reference photo', file: 'orange-mixed.jpg', crop: 'Orange' },
  { label: 'Pomegranate · Bad reference photo', file: 'pomegranate-bad.jpg', crop: 'Pomegranate' },
  { label: 'Mango · Good reference photo', file: 'mango-good.jpg', crop: 'Mango' },
  { label: 'Tomato · Bad reference photo', file: 'tomato-bad.jpg', crop: 'Tomato' },
  { label: 'Potato · Good reference photo', file: 'potato-good.jpg', crop: 'Potato' },
  { label: 'Strawberry · Bad reference photo', file: 'strawberry-bad.jpg', crop: 'Strawberry' },
];

export const FarmerDashboard: React.FC<FarmerDashboardProps> = ({
  walletAddress,
  orders,
  onMintAndList,
  onShipOrder,
  onTraceBatch,
}) => {
  const [cropType, setCropType] = useState('Apple');
  const [quantity, setQuantity] = useState(2500);
  const [unit, setUnit] = useState('kg');
  const [farmLocation, setFarmLocation] = useState('FruitNet dataset sample · India');
  const [pricePerUnit, setPricePerUnit] = useState('2.5');

  // AI Verification State
  const [isVerifyingAI, setIsVerifyingAI] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);
  const [cropImage, setCropImage] = useState<File | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [isListing, setIsListing] = useState(false);
  const [ecoPractices, setEcoPractices] = useState<string[]>([]);
  const [priceStats, setPriceStats] = useState<any>(null);
  const [listening, setListening] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [captureInfo, setCaptureInfo] = useState<any>(null);
  // Which crop the LOADED PHOTO actually shows (sample photos only). The photo
  // determines the crop: picking a sample auto-sets the dropdown, and changing
  // the dropdown afterwards triggers a mismatch warning instead of silently
  // minting the wrong crop.
  const [sampleCrop, setSampleCrop] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live capture: camera photo + device GPS hashed together and bound into the
  // SIGNED report (tamper-evident attestation). Honest scope: this raises the
  // bar for gallery stock-photo fraud; it cannot prove physical presence —
  // a screen can always be re-photographed.
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  };
  useEffect(() => () => stopCamera(), []);
  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCaptureInfo(null);
      setAiReport(null);
      setShowCamera(true);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch {
      alert('Camera unavailable (permission denied or no camera on this device). Upload a file instead.');
    }
  };
  const snapPhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    try {
      setCapturing(true);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('capture failed'))), 'image/jpeg', 0.9));
      const ts = Math.floor(Date.now() / 1000);
      const pos: GeolocationPosition | null = await new Promise((res) => {
        if (!navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 8000 });
      });
      const lat = pos?.coords.latitude ?? null;
      const lon = pos?.coords.longitude ?? null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const preimage = new Uint8Array([...bytes, ...new TextEncoder().encode(`|${lat}|${lon}|${ts}`)]);
      const digest = await crypto.subtle.digest('SHA-256', preimage);
      const captureHash = '0x' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      setCropImage(new File([blob], 'live-capture.jpg', { type: 'image/jpeg' }));
      setSampleCrop(null);
      setCaptureInfo(lat !== null && lon !== null
        ? { lat, lon, capturedAt: ts, captureHash, method: 'live-photo-gps' }
        : { lat, lon, capturedAt: ts, captureHash, method: 'live-photo-no-gps' });
      stopCamera();
    } catch (e) {
      console.warn('Live capture failed:', e);
    } finally {
      setCapturing(false);
    }
  };

  // Filter orders for this farmer
  const farmerOrders = orders.filter(
    (o) => walletAddress && (o.farmer_address || '').toLowerCase() === walletAddress.toLowerCase()
  );

  // Offline draft: form fields survive reloads and dead connections (photo
  // File objects cannot persist — re-attach the image after reconnecting).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('agrichain:farmerDraft');
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.cropType) setCropType(d.cropType);
      if (Number.isFinite(Number(d.quantity))) setQuantity(Number(d.quantity));
      if (d.unit) setUnit(d.unit);
      if (d.farmLocation) setFarmLocation(d.farmLocation);
      if (d.pricePerUnit) setPricePerUnit(d.pricePerUnit);
      if (Array.isArray(d.ecoPractices)) setEcoPractices(d.ecoPractices);
    } catch { /* corrupted draft ignored */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('agrichain:farmerDraft', JSON.stringify({ cropType, quantity, unit, farmLocation, pricePerUnit, ecoPractices }));
    } catch { /* private mode */ }
  }, [cropType, quantity, unit, farmLocation, pricePerUnit, ecoPractices]);

  // Earnings: settled on-chain (DELIVERED) vs still locked in escrow.
  // Net received per order = total − 2% platform fee. Disputed orders are
  // excluded until the DAO verdict settles them.
  const toAgri = (wei: string) => {
    try {
      const v = BigInt(wei || '0');
      const neg = v < 0n;
      const a = neg ? -v : v;
      const whole = (a / 10n ** 18n).toString();
      const frac = (a % 10n ** 18n).toString().padStart(18, '0').slice(0, 2);
      return `${neg ? '-' : ''}${Number(whole).toLocaleString()}.${frac}`;
    } catch { return '0.00'; }
  };
  const settledOrders = farmerOrders.filter((o) => o.status === 'DELIVERED');
  const escrowOrders = farmerOrders.filter((o) => ['PLACED', 'SHIPPED', 'RECEIVED'].includes(o.status));
  const totalReceived = settledOrders.reduce((s, o) => s + (BigInt(o.total_amount || '0') - BigInt(o.platform_fee || '0')), 0n);
  const totalFees = settledOrders.reduce((s, o) => s + BigInt(o.platform_fee || '0'), 0n);
  const lockedInEscrow = escrowOrders.reduce((s, o) => s + (BigInt(o.total_amount || '0') - BigInt(o.platform_fee || '0')), 0n);

  const ECO_OPTIONS = [
    { id: 'organic', label: 'Organic (no synthetic pesticides)' },
    { id: 'no_till', label: 'No-till / low tillage' },
    { id: 'cover_crop', label: 'Cover cropping' },
    { id: 'agroforestry', label: 'Agroforestry / tree planting' },
    { id: 'renewable', label: 'Renewable-powered operations' },
  ];

  // Fair-price guidance from real settled orders — never synthesized.
  const loadPriceStats = async (crop: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/market/stats?cropType=${encodeURIComponent(crop)}`).then((r) => r.json());
      setPriceStats(res?.stats?.[0] || null);
    } catch { setPriceStats(null); }
  };
  useEffect(() => { loadPriceStats(cropType); }, [cropType]);

  // Voice fill for the listing form (browser speech recognition; English/Hindi
  // best-effort keyword parse — fills fields, never submits anything).
  const handleVoiceFill = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice input is not supported in this browser.'); return; }
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (e: any) => {
      const text: string = e.results[0][0].transcript || '';
      const num = text.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|quintal|ton|price|rupees|agri)?/i);
      const crops = ['apple', 'banana', 'guava', 'lime', 'orange', 'pomegranate', 'mango', 'tomato', 'potato', 'strawberry', 'bellpepper', 'cucumber', 'carrot', 'wheat', 'rice', 'maize'];
      const found = crops.find((c) => text.toLowerCase().includes(c));
      if (found) setCropType(found[0].toUpperCase() + found.slice(1));
      if (num) {
        const v = parseFloat(num[1]);
        if (/quintal/i.test(text)) setQuantity(Math.round(v * 100));
        else if (/ton/i.test(text)) setQuantity(Math.round(v * 1000));
        else if (v > 0 && v < 1000000) setQuantity(Math.round(v));
      }
      const price = text.match(/(?:price|rate|rupees|agri)\D*(\d+(?:\.\d+)?)/i);
      if (price) setPricePerUnit(price[1]);
      setListening(false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  };

  const handleUseSampleImage = async (filename: string) => {
    if (!filename) return;
    try {
      setSampleLoading(true);
      const response = await fetch(`/crop-photos/${filename}`);
      if (!response.ok) throw new Error('Local sample image could not be loaded.');
      const blob = await response.blob();
      setCropImage(new File([blob], filename, { type: 'image/jpeg' }));
      setCaptureInfo(null);
      const sample = DEMO_CROP_IMAGES.find((item) => item.file === filename);
      if (sample) {
        setCropType(sample.crop);
        setSampleCrop(sample.crop);
        setFarmLocation('FruitNet dataset sample · India');
      }
      setAiReport(null);
    } catch (error) {
      console.error('Could not load local crop sample:', error);
    } finally {
      setSampleLoading(false);
    }
  };

  const handleRunAIEvaluation = async () => {
    try {
      setIsVerifyingAI(true);
      setAiReport(null);
      if (!cropImage) throw new Error('Choose a fruit inspection image before running verification.');
      const form = new FormData();
      form.append('image', cropImage);
      form.append('tokenId', '0');
      form.append('cropType', cropType);
      form.append('chainId', '31337');
      form.append('registryAddress', (CONTRACT_ADDRESSES as any).OracleRegistry);
      if (captureInfo) {
        if (captureInfo.lat !== null) form.append('captureLat', String(captureInfo.lat));
        if (captureInfo.lon !== null) form.append('captureLon', String(captureInfo.lon));
        form.append('captureCapturedAt', String(captureInfo.capturedAt));
        form.append('captureHash', captureInfo.captureHash);
        form.append('captureMethod', captureInfo.method);
      }
      const res = await fetch(`${BACKEND_URL}/api/ai/verify`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (data?.isFallback || !data?.signature) {
        // Fallback grade is NOT oracle-signed and can never be submitted on-chain.
        setAiReport({ ...data, isFallback: true });
      } else {
        setAiReport(data);
      }
    } catch (err) {
      console.warn('AI service unreachable:', err);
      // No fake grade: surface the failure so the farmer cannot mint a "verified" batch.
      setAiReport({ isFallback: true, error: 'AI service unreachable. Start ai-service on :8001 and retry.' });
    } finally {
      setIsVerifyingAI(false);
    }
  };

  const handleMintAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiReport || aiReport.isFallback || !cropImage) {
      alert('Run image verification and select an image first.');
      return;
    }

    try {
      setIsListing(true);
      await onMintAndList({
        cropType,
        quantity,
        unit,
        farmLocation,
        pricePerUnit,
        grade: aiReport.grade,
        confidenceScore: aiReport.confidenceScore || aiReport.confidenceBasisPoints || 9500,
        reportHash: aiReport.reportHash,
        signature: aiReport.signature,
        imageHash: aiReport?.report?.imageHash,
        imageFile: cropImage,
        ecoPractices,
      });

      // Reset form
      setAiReport(null);
      setEcoPractices([]);
      setSampleCrop(null);
    } finally {
      setIsListing(false);
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      
      {/* Header Banner */}
      <div className="glass-panel" style={{ padding: '28px 32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '6px' }}>
              <Sprout size={18} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Farmer Producer Portal
              </span>
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>Tokenize & List Crop Harvests</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
                FruitNet + fresh-produce-trained quality classifier. The local oracle signs image reports for thirteen supported crop types.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '20px' }}>
            <div className="badge badge-neutral" style={{ padding: '10px 16px', borderRadius: '12px' }}>
              <div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Pending Dispatches</p>
                <strong style={{ color: '#01472e', fontSize: '1.2rem' }}>
                  {farmerOrders.filter((o) => o.status === 'PLACED').length}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '32px' }}>
        
        {/* LEFT COLUMN: MINT & LIST FORM */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '1.3rem', color: '#01472e', marginBottom: '6px' }}>
            List New Harvest Batch
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '24px' }}>
              This demonstration uses dataset photos; enter actual provenance only for a real harvest you own.
          </p>

          <form onSubmit={handleMintAndSubmit}>
            <div style={{ marginBottom: '18px' }}>
              <label className="form-label">Crop Type (AI-supported)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select className="form-input" value={cropType} onChange={(e) => setCropType(e.target.value)} required style={{ flex: 1 }}>
                  {['Apple', 'Banana', 'Guava', 'Lime', 'Orange', 'Pomegranate', 'Mango', 'Tomato', 'Potato', 'Strawberry', 'Bellpepper', 'Cucumber', 'Carrot', 'Wheat', 'Rice', 'Maize', 'Other'].map((crop) => <option key={crop} value={crop}>{crop}</option>)}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleVoiceFill} disabled={listening} title="Dictate crop, quantity and price">
                  <Mic size={14} /> {listening ? 'Listening…' : 'Voice fill'}
                </button>
              </div>
              <p className="ed-meta" style={{ marginTop: '6px' }}>Say e.g. “wheat two thousand kg price two” — fills the fields below, never submits.</p>
              {sampleCrop && (
                <p style={{ fontSize: '0.8rem', marginTop: '6px', color: cropType === sampleCrop ? 'var(--text-muted)' : '#8f1d1d', fontWeight: cropType === sampleCrop ? 400 : 700 }}>
                  {cropType === sampleCrop
                    ? `Loaded photo shows ${sampleCrop} — crop set from the photo.`
                    : `⚠ Loaded photo shows ${sampleCrop}, but listing as ${cropType} — the grade will describe the photo, not the label. Change the crop back or load a matching photo.`}
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '18px' }}>
              <div>
                <label className="form-label">Batch Quantity</label>
                <input
                  type="number"
                  className="form-input"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  required
                  min="1"
                />
              </div>
              <div>
                <label className="form-label">Unit</label>
                <select
                  className="form-input"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  <option value="kg">kg</option>
                  <option value="quintal">quintal</option>
                  <option value="ton">ton</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label className="form-label">Farm Location / Provenance</label>
              <input
                type="text"
                className="form-input"
                value={farmLocation}
                onChange={(e) => setFarmLocation(e.target.value)}
                required
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label className="form-label">Asking Price (AGRI per {unit})</label>
              <input
                type="number"
                step="0.1"
                className="form-input"
                value={pricePerUnit}
                onChange={(e) => setPricePerUnit(e.target.value)}
                required
              />
              {priceStats ? (
                <p className="ed-meta" style={{ marginTop: '6px' }}>
                  Recently settled {priceStats.crop}: avg {(parseFloat(priceStats.avg_per_unit) / 1e18).toFixed(2)} AGRI
                  /{unit} across {priceStats.sales} sale{Number(priceStats.sales) === 1 ? '' : 's'}
                  {(() => {
                    const avg = parseFloat(priceStats.avg_per_unit) / 1e18;
                    const ask = parseFloat(pricePerUnit);
                    if (!avg || !ask) return '';
                    const dev = ((ask - avg) / avg) * 100;
                    if (Math.abs(dev) <= 30) return ` — your price is within ${Math.abs(dev).toFixed(0)}% of average.`;
                    return dev > 0
                      ? ` — ⚠ ${dev.toFixed(0)}% ABOVE recent average; buyers may flag this as overpriced.`
                      : ` — ${Math.abs(dev).toFixed(0)}% below recent average; you may be underpricing.`;
                  })()}
                </p>
              ) : (
                <p className="ed-meta" style={{ marginTop: '6px' }}>No settled sales for {cropType} yet — your price sets the reference.</p>
              )}
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label className="form-label"><Leaf size={13} /> Sustainability practices (self-reported)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                {ECO_OPTIONS.map((o) => (
                  <label key={o.id} style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.82rem', background: 'rgba(1,71,46,0.05)', padding: '6px 12px', borderRadius: '16px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={ecoPractices.includes(o.id)}
                      onChange={() => setEcoPractices((prev) => prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id])}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <p className="ed-meta" style={{ marginTop: '6px' }}>Earns demo eco-credits and a leaf badge on the listing. Self-declared, not audited.</p>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label className="form-label">Fruit inspection image (required)</label>
              <input type="file" accept="image/*" className="form-input" required
                onChange={(e) => { setCropImage(e.target.files?.[0] || null); setAiReport(null); setCaptureInfo(null); setSampleCrop(null); }} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={openCamera}>
                  <Camera size={14} /> Capture live photo instead
                </button>
              </div>
              {showCamera && (
                <div style={{ marginTop: '10px', background: 'rgba(1,71,46,0.05)', padding: '12px', borderRadius: '10px' }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: '8px' }} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={snapPhoto} disabled={capturing}>
                      {capturing ? 'Capturing…' : 'Snap + record GPS'}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={stopCamera}>Cancel</button>
                  </div>
                  <p className="ed-meta" style={{ marginTop: '6px' }}>Live photo + GPS + time are hashed together and bound into the signed report. Raises the bar for stock-photo fraud; cannot prove physical presence.</p>
                </div>
              )}
              {captureInfo && (
                <p style={{ fontSize: '0.78rem', color: 'var(--primary)', marginTop: '6px' }}>
                  <MapPin size={12} /> Live-captured {captureInfo.lat !== null ? `@ ${Number(captureInfo.lat).toFixed(4)}, ${Number(captureInfo.lon).toFixed(4)}` : '(no GPS fix)'} — hash {captureInfo.captureHash.slice(0, 14)}…
                </p>
              )}
              <div className="sample-image-picker">
                <span>Use a real reference photo from the FruitNet dataset</span>
                <select className="form-input" disabled={sampleLoading} defaultValue="" onChange={(e) => handleUseSampleImage(e.target.value)}>
                  <option value="">Choose a sample fruit…</option>
                  {DEMO_CROP_IMAGES.map((sample) => <option key={sample.file} value={sample.file}>{sample.label}</option>)}
                </select>
              </div>
              <p className="sample-image-note">These are real dataset photos, not your own inventory. The trained model's Good/Mixed/Bad result is dataset-based and its score is not calibrated.</p>
              {cropImage && <p className="ed-meta">Selected: {cropImage.name} ({Math.ceil(cropImage.size / 1024)} KB)</p>}
            </div>

            {/* AI Grading Trigger Box */}
            <div style={{
              background: 'rgba(16, 185, 129, 0.05)',
              border: '1px dashed rgba(16, 185, 129, 0.3)',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px',
              textAlign: 'center'
            }}>
              <Sparkles size={28} color="var(--primary)" style={{ margin: '0 auto 8px' }} />
              <h4 style={{ color: '#01472e', fontSize: '1rem', marginBottom: '4px' }}>
                AI Fruit Quality Verification
              </h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '14px' }}>
                MobileNetV3-Small fine-tuned on FruitNet Good/Mixed/Bad photos. Score is an uncalibrated model score, not food-safety certification. Oracle signature is bound to the minted batch.
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '14px' }}>
                CNN model grades 13 trained crops (6 FruitNet fruits + Mango, Tomato, Potato, Strawberry, Bellpepper, Cucumber, Carrot). Anything else
                crop gets a transparent rule-based visual screening instead — clearly labelled, capped
                confidence, never presented as a model grade.
              </p>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRunAIEvaluation}
                disabled={isVerifyingAI || !cropImage}
              >
                {isVerifyingAI ? 'Analyzing Image...' : 'Run AI Quality Verification'}
              </button>

              {aiReport && !aiReport.isFallback && (
                <div style={{ marginTop: '16px', background: 'rgba(1,71,46,0.07)', padding: '14px', borderRadius: '8px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Assigned Grade:</span>
                    <span className={`badge ${aiReport.grade === 1 ? 'badge-grade-a' : aiReport.grade === 2 ? 'badge-grade-b' : 'badge-grade-c'}`}>
                      <ShieldCheck size={13} /> {aiReport.gradeLabel || aiReport.gradeName} ({aiReport.confidencePercent ?? ((aiReport.confidenceScore || aiReport.confidenceBasisPoints || 0) / 100)}%)
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Report Hash: <span className="font-mono">{aiReport.reportHash ? aiReport.reportHash.slice(0, 20) : '0x...'}...</span>
                  </div>
                  {aiReport.classScores && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Model raw scores: {Object.entries(aiReport.classScores).map(([k, v]) => `${k} ${(Number(v) * 100).toFixed(1)}%`).join(' · ')}
                    </div>
                  )}
                  {aiReport.gradingMethod && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Grading method: {aiReport.gradingMethod === 'fruitnet-cnn' ? 'FruitNet CNN model' : 'Rule-based screening (not a model grade)'}
                    </div>
                  )}
                  {aiReport.capture?.captureHash && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--primary)', marginTop: '4px' }}>
                      <MapPin size={12} /> Live-captured {aiReport.capture.lat !== null ? `@ ${Number(aiReport.capture.lat).toFixed(4)}, ${Number(aiReport.capture.lon).toFixed(4)}` : '(no GPS)'} · bound into signed report
                    </div>
                  )}
                  {aiReport.explanation?.maskDataUrl && (
                    <div style={{ marginTop: '10px' }}>
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        What the grader saw — red marks {(aiReport.explanation.defectRatio * 100).toFixed(1)}% defect pixels
                      </p>
                      <img src={aiReport.explanation.maskDataUrl} alt="Defect highlight overlay" style={{ width: '100%', maxWidth: '320px', borderRadius: '8px', marginTop: '4px' }} />
                    </div>
                  )}
                  {aiReport.gradeCappedByDefectCheck && (
                    <div style={{ fontSize: '0.78rem', color: '#8f6a1d', marginTop: '4px', fontWeight: 600 }}>
                      Defect safety cap applied: model output was downgraded due to visible decay. Raw scores above are unchanged.
                    </div>
                  )}
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Oracle signer: <span className="font-mono">{aiReport.oracleSigner || aiReport.oracleNode || 'signed'}</span> · signature present: {aiReport.signature ? 'yes' : 'no'}
                  </div>
                </div>
              )}
              {aiReport?.isFallback && (
                <div style={{ marginTop: '16px', background: 'rgba(180,35,35,0.08)', padding: '14px', borderRadius: '8px', textAlign: 'left', border: '1px solid rgba(180,35,35,0.3)' }}>
                  <span style={{ color: '#8f1d1d', fontSize: '0.85rem', fontWeight: 600 }}><AlertCircle size={13} /> AI service unreachable — no signed grade. Start ai-service (:8001) and retry. Minting is blocked.</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={isListing || !aiReport}
            >
              {isListing ? 'Minting NFT & Listing on Escrow...' : 'Mint & List on Marketplace'}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: ORDERS TO SHIP */}
        <div>
          <div className="glass-panel" style={{ padding: '32px', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <Truck size={20} color="var(--primary)" />
              <h3 style={{ fontSize: '1.3rem', color: '#01472e' }}>Orders to Dispatch</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
              When a buyer locks AGRI into escrow, mark the shipment as dispatched once it leaves your farm gate.
            </p>

            {/* EARNINGS SUMMARY */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid var(--border-active)', padding: '14px', borderRadius: '10px' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Received · net</p>
                <strong style={{ color: 'var(--primary)', fontSize: '1.25rem' }}>{toAgri(totalReceived.toString())} <span style={{ fontSize: '0.75rem' }}>AGRI</span></strong>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>{settledOrders.length} settled order{settledOrders.length === 1 ? '' : 's'}</p>
              </div>
              <div style={{ background: 'rgba(1,71,46,0.05)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Locked in escrow</p>
                <strong style={{ color: '#01472e', fontSize: '1.25rem' }}>{toAgri(lockedInEscrow.toString())} <span style={{ fontSize: '0.75rem' }}>AGRI</span></strong>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>{escrowOrders.length} open order{escrowOrders.length === 1 ? '' : 's'}</p>
              </div>
              <div style={{ background: 'rgba(1,71,46,0.05)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-subtle)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Platform fees paid</p>
                <strong style={{ color: '#01472e', fontSize: '1.25rem' }}>{toAgri(totalFees.toString())} <span style={{ fontSize: '0.75rem' }}>AGRI</span></strong>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>2% per settled order</p>
              </div>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '20px' }}>
              Net = order total minus 2% fee, as settled on-chain. Disputed orders are excluded until the DAO verdict pays out.
            </p>

            {farmerOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <PackageCheck size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>No active orders for your farm yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {farmerOrders.map((order) => {
                  const total = toAgri(order.total_amount);
                  const net = toAgri((BigInt(order.total_amount || '0') - BigInt(order.platform_fee || '0')).toString());
                  const fee = toAgri(order.platform_fee);
                  const isSettled = order.status === 'DELIVERED';
                  return (
                    <div
                      key={order.order_id}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '12px',
                        padding: '18px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div>
                          <strong style={{ color: '#01472e' }}>Order #{order.order_id}</strong>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            Buyer: {(order.buyer_address || '').slice(0, 6)}...{(order.buyer_address || '').slice(-4)}
                          </p>
                        </div>
                        <span className={`badge ${
                          order.status === 'DELIVERED' ? 'badge-grade-a' :
                          order.status === 'SHIPPED' || order.status === 'RECEIVED' ? 'badge-grade-b' : 'badge-neutral'
                        }`}>
                          {order.status === 'RECEIVED' ? 'RECEIVED (clock running)' : order.status}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {isSettled ? `+${net}` : total} AGRI
                        </span>

                        {isSettled && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            net received · fee {fee}
                          </span>
                        )}
                        {!isSettled && order.status !== 'DISPUTED' && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            locked · net {net} on delivery
                          </span>
                        )}

                        <div style={{ display: 'flex', gap: '6px' }}>
                          {onTraceBatch && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => onTraceBatch(order.token_id)}
                              title="Trace Batch QR Code"
                            >
                              <QrCode size={13} /> Trace QR
                            </button>
                          )}
                          {order.status === 'PLACED' && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => onShipOrder(order.order_id)}
                            >
                              <Truck size={14} />
                              Mark as Shipped
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
