import React, { useState, useEffect } from 'react';
import { ShieldCheck, Search, AlertTriangle, Truck, Eye, CheckCircle2, RefreshCw, QrCode, Sparkles } from 'lucide-react';
import QRCode from 'qrcode';
import { BACKEND_URL } from '../contracts';
import { Reveal } from './Reveal';
import { OrderTrackingTimeline } from './OrderTrackingTimeline';

interface Listing {
  listing_id: number;
  token_id: number;
  farmer_address: string;
  crop_type: string;
  price_per_unit: string;
  available_quantity: number;
  unit: string;
  quality_grade: number;
  grade_name: string;
  confidence_score: number;
  image_cid: string;
  report_hash?: string;
  image_url: string;
  farm_location: string;
  farmer_name?: string | null;
  farmer_verified?: number | null;
  eco_credits?: number | null;
  eco_practices?: string | null;
  metadata_cid: string;
  status: string;
  created_at: number;
}

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
  placed_at: number;
  shipped_at: number;
  received_at?: number;
  delivered_at: number;
  tx_hash?: string | null;
  dispute_reason_hash?: string | null;
}

interface MarketplaceViewProps {
  listings: Listing[];
  orders: Order[];
  walletAddress: string | null;
  viewMode?: 'buyer' | 'farmer';
  onBuyListing: (listing: Listing, quantity: number) => Promise<void>;
  onConfirmDelivery: (orderId: number) => Promise<void>;
  onMarkReceived: (orderId: number) => Promise<void>;
  onRaiseDispute: (orderId: number, evidence: { claim: string; file: File }) => Promise<void>;
  onViewCheckpoints: (orderId: number) => void;
  onRefresh: () => Promise<void>;
  onGoSell?: () => void;
  onTraceBatch?: (tokenId: number) => void;
  onOpenPassport?: (tokenId: number) => void;
  onShipOrder?: (orderId: number) => Promise<void>;
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  listings, orders, walletAddress, viewMode = 'buyer', onBuyListing, onConfirmDelivery, onMarkReceived, onRaiseDispute, onViewCheckpoints, onRefresh, onGoSell, onTraceBatch, onOpenPassport, onShipOrder,
}) => {
  const isBuyer = viewMode !== 'farmer';
  const [activeSubTab, setActiveSubTab] = useState<'browse' | 'my-orders'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | 'ALL'>('ALL');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disputeOrder, setDisputeOrder] = useState<Order | null>(null);
  const [disputeClaim, setDisputeClaim] = useState('');
  const [disputeFile, setDisputeFile] = useState<File | null>(null);
  const [isDisputing, setIsDisputing] = useState(false);
  const [lotQr, setLotQr] = useState('');

  // Listing photos: absolute URLs as-is; backend-relative paths (/listing-images/…)
  // resolve against the indexer origin, otherwise the browser looks on :3000.
  const lotImage = (item: any) =>
    item.image_url
      ? (item.image_url.startsWith('/') ? `${BACKEND_URL}${item.image_url}` : item.image_url)
      : cropArtwork(item.crop_type);
  // Fair-price context: average settled price for the same crop (real sales only).
  const [lotStats, setLotStats] = useState<any>(null);
  useEffect(() => {
    if (!selectedListing) { setLotQr(''); setLotStats(null); return; }
    const url = `${window.location.origin}/?inspect=batch:${selectedListing.token_id}`;
    QRCode.toDataURL(url, { width: 160, margin: 1 }).then(setLotQr).catch(() => setLotQr(''));
    fetch(`${BACKEND_URL}/api/market/stats?cropType=${encodeURIComponent(selectedListing.crop_type)}`)
      .then((r) => r.json()).then((d) => setLotStats(d?.stats?.[0] || null)).catch(() => setLotStats(null));
  }, [selectedListing]);

  const filteredListings = listings.filter((item) => {
    const matchesSearch =
      (item.crop_type || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.farmer_address || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGrade = gradeFilter === 'ALL' || item.quality_grade === gradeFilter;
    return matchesSearch && matchesGrade;
  });

  const myOrders = orders.filter(
    (o) => walletAddress && (o.buyer_address || '').toLowerCase() === walletAddress.toLowerCase()
  );

  const getGradeBadge = (grade: number, confidence: number) => {
    const pct = (confidence / 100).toFixed(1);
    if (grade === 1) return <span className="badge badge-grade-a"><ShieldCheck size={13} /> Good · model score {pct}%</span>;
    if (grade === 2) return <span className="badge badge-grade-b">Mixed · model score {pct}%</span>;
    if (grade === 3) return <span className="badge badge-grade-c">Bad · model score {pct}%</span>;
    return <span className="badge badge-rejected">Rejected</span>;
  };

  const formatPrice = (priceWei: string) => {
    try { const num = Number(priceWei) / 1e18; return Number.isFinite(num) ? num.toFixed(2) : '—'; }
    catch { return '—'; }
  };

  const cropArtwork = (cropType: string) => {
    const name = cropType.toLowerCase();
    if (name.includes('banana')) return '/crop-photos/banana-mixed.jpg';
    if (name.includes('guava')) return '/crop-photos/guava-bad.jpg';
    if (name.includes('lime')) return '/crop-photos/lime-good.jpg';
    if (name.includes('orange')) return '/crop-photos/orange-mixed.jpg';
    if (name.includes('pomegranate')) return '/crop-photos/pomegranate-bad.jpg';
    if (name.includes('mango')) return '/crop-photos/mango-good.jpg';
    if (name.includes('tomato')) return '/crop-photos/tomato-bad.jpg';
    if (name.includes('potato')) return '/crop-photos/potato-good.jpg';
    if (name.includes('strawberry')) return '/crop-photos/strawberry-bad.jpg';
    return '/crop-photos/apple-good.jpg';
  };

  return (
    <div id="section-marketplace">
      <div className="ed-section-head market-heading">
        <Reveal>
          <p className="ed-label">Real FruitNet photos · Local demo chain</p>
          <h2 className="ed-section-title">Fruit quality marketplace</h2>
          <p className="market-intro">FruitNet sample photos run through the trained quality model. These are local test listings with sample quantities and prices, not live farm offers.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <button className="btn btn-secondary" onClick={() => onGoSell ? onGoSell() : document.getElementById('section-farmer')?.scrollIntoView({ behavior: 'smooth' })}>
            List a harvest <span aria-hidden="true">→</span>
          </button>
        </Reveal>
      </div>

      <div className="market-toolbar">
        <button className={`btn ${activeSubTab === 'browse' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveSubTab('browse')}>
          All lots <span className="tab-count">{listings.length}</span>
        </button>
        <button className={`btn ${activeSubTab === 'my-orders' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveSubTab('my-orders')}>
          My orders <span className="tab-count">{myOrders.length}</span>
        </button>
        {activeSubTab === 'browse' && (
          <>
            <div className="market-search">
              <Search size={16} aria-hidden="true" />
              <input className="form-input" placeholder="Search crops or farms" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <select className="form-input market-grade-filter" aria-label="Filter by quality grade" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
              <option value="ALL">Every grade</option>
              <option value="1">Grade A</option>
              <option value="2">Grade B</option>
              <option value="3">Grade C</option>
            </select>
          </>
        )}
        <button className="btn btn-secondary market-refresh" onClick={() => void onRefresh()} title="Refresh live listings from Hardhat">
          <RefreshCw size={14} /> Refresh chain data
        </button>
      </div>

      {activeSubTab === 'browse' && (
        filteredListings.length === 0 ? (
          <div className="empty-market glass-panel">
            <span className="empty-market-mark">✳</span>
            <h3>{listings.length ? 'No lots match these filters' : 'The next harvest starts here'}</h3>
            <p>{listings.length ? 'Try another crop name or quality grade.' : 'Seed the local demo catalog or connect a farmer wallet to list a verified batch.'}</p>
          </div>
        ) : (
          <div className="ed-cards market-cards">
            {filteredListings.map((item, i) => (
              <Reveal key={item.listing_id} delay={(i % 3) * 0.08}>
                <article className="ed-card listing-card">
                  <div className="listing-image-wrap">
                    <img src={lotImage(item)} alt={`Graded inspection photo for ${item.crop_type}; model report is linked to this on-chain batch`} loading="lazy" />
                    <span className="artwork-caption">Real dataset photo · demo lot</span>
                    <div className="listing-grade">{getGradeBadge(item.quality_grade, item.confidence_score)}{Number((item as any).eco_credits) > 0 && <span title="Sustainability credits (self-reported)"> 🌱</span>}</div>
                  </div>
                  <div className="listing-card-body">
                    <p className="listing-origin">{item.farmer_name || `Farm wallet ${(item.farmer_address || '').slice(0, 6)}…`}{Number(item.farmer_verified) === 1 ? ' ✓' : ''}</p>
                    <h3>{item.crop_type}</h3>
                    <div className="listing-meta-row"><span>Batch #{item.token_id}</span><span>{(item.available_quantity || 0).toLocaleString()} {item.unit} available</span></div>
                    <div className="listing-card-footer">
                      <div><strong>{formatPrice(item.price_per_unit)}</strong><span> AGRI / {item.unit}</span></div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {onTraceBatch && (
                          <button className="btn btn-secondary btn-sm" onClick={() => onTraceBatch(item.token_id)} title="Trace Batch QR Code">
                            <QrCode size={13} />
                          </button>
                        )}
                        {onOpenPassport && (
                          <button className="btn btn-secondary btn-sm" onClick={() => onOpenPassport(item.token_id)} title="AI Quality Passport">
                            <Sparkles size={13} />
                          </button>
                        )}
                        <button className="btn btn-primary btn-sm" onClick={() => setSelectedListing(item)}>View lot</button>
                      </div>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        )
      )}

      {activeSubTab === 'my-orders' && (
        <div style={{ maxWidth: '1280px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {myOrders.length === 0 ? (
            <div className="glass-panel" style={{ padding: '50px', textAlign: 'center' }}>
              <Truck size={40} style={{ margin: '0 auto 12px' }} />
              <h3>No orders yet</h3>
              <p className="ed-meta">Browse available harvests and place an order to track shipments here.</p>
            </div>
          ) : myOrders.map((order) => {
            const l = listings.find((x) => x.listing_id === order.listing_id);
            return (
              <OrderTrackingTimeline
                key={order.order_id}
                order={order}
                cropType={l?.crop_type}
                isBuyer={isBuyer}
                isFarmer={!isBuyer}
                onShip={(id) => onShipOrder ? onShipOrder(id) : undefined}
                onMarkReceived={(id) => onMarkReceived(id)}
                onConfirmDelivery={(id) => onConfirmDelivery(id)}
                onRaiseDispute={(ord) => { setDisputeOrder(ord); setDisputeClaim(''); setDisputeFile(null); }}
                onViewCheckpoints={(id) => onViewCheckpoints(id)}
                onTraceBatch={(tokId) => onTraceBatch ? onTraceBatch(tokId) : undefined}
              />
            );
          })}
        </div>
      )}

      {disputeOrder && (
        <div className="modal-overlay" onClick={() => !isDisputing && setDisputeOrder(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <p className="ed-label">Open dispute · Order #{disputeOrder.order_id}</p>
            <h2 style={{ fontSize: '1.6rem', margin: '8px 0' }}>Unboxing evidence required</h2>
            <p className="ed-meta" style={{ marginBottom: '12px' }}>
              Upload a photo of the opened box showing the delivered goods. Its SHA-256 hash is
              committed on-chain as the dispute evidence — jurors compare exactly this photo
              against the AI-graded listing photo. <strong>Disputes without a clear unboxing photo
              are voted in favor of the farmer.</strong>
            </p>
            <label className="form-label">What is wrong with the delivery?</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="e.g. Apples arrived bruised and leaking; photo shows opened crate"
              value={disputeClaim}
              onChange={(e) => setDisputeClaim(e.target.value)}
              style={{ marginBottom: '12px' }}
            />
            <label className="form-label">Unboxing photo (required)</label>
            <input
              type="file"
              accept="image/*"
              className="form-input"
              onChange={(e) => setDisputeFile(e.target.files?.[0] || null)}
              style={{ marginBottom: '12px' }}
            />
            {disputeFile && (
              <img
                src={URL.createObjectURL(disputeFile)}
                alt="Unboxing evidence preview"
                style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', borderRadius: '10px', marginBottom: '12px' }}
              />
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={isDisputing} onClick={() => setDisputeOrder(null)}>Cancel</button>
              <button
                className="btn btn-danger" style={{ flex: 1 }} disabled={isDisputing || !disputeClaim.trim() || !disputeFile}
                onClick={async () => {
                  if (!disputeFile) return;
                  try {
                    setIsDisputing(true);
                    await onRaiseDispute(disputeOrder.order_id, { claim: disputeClaim.trim(), file: disputeFile });
                    setDisputeOrder(null);
                  } finally { setIsDisputing(false); }
                }}
              >
                {isDisputing ? 'Freezing escrow…' : 'Freeze escrow & open case'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedListing && (
        <div className="modal-overlay" onClick={() => setSelectedListing(null)}>
          <div className="modal-content lot-modal" onClick={(e) => e.stopPropagation()}>
            <img className="lot-modal-image" src={lotImage(selectedListing)} alt={`Graded inspection photo for ${selectedListing.crop_type}`} />
            <div className="lot-modal-content">
              <p className="ed-label">Verified harvest lot · #{selectedListing.token_id}</p>
              <h2>{selectedListing.crop_type}</h2>
              <p className="lot-modal-origin">{selectedListing.farmer_name || `Farmer ${(selectedListing.farmer_address || '').slice(0, 8)}…`}{Number(selectedListing.farmer_verified) === 1 ? ' ✓ Verified Farmer' : ' · unverified account'}</p>
              <div className="lot-facts">
                <span>{(selectedListing.available_quantity || 0).toLocaleString()} {selectedListing.unit} available</span>
                <span>{['Unknown', 'Good', 'Mixed', 'Bad'][selectedListing.quality_grade] || 'Unknown'} quality · uncalibrated model score {(selectedListing.confidence_score / 100).toFixed(1)}%</span>
              </div>
              <div className="lot-total"><span>Lot total</span><strong>{(Number(formatPrice(selectedListing.price_per_unit)) * selectedListing.available_quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })} AGRI</strong></div>
              <p className="lot-fee-note">Paid into local escrow. The 2% platform fee is taken from the farmer payout.</p>
              {Number(selectedListing.eco_credits) > 0 && (
                <p className="lot-fee-note">🌱 Sustainability: {selectedListing.eco_credits} demo credits (self-reported practices, not audited).</p>
              )}
              {lotStats ? (
                <p className="lot-fee-note">
                  Recently settled {selectedListing.crop_type}: avg {(parseFloat(lotStats.avg_per_unit) / 1e18).toFixed(2)} AGRI across {lotStats.sales} sale{Number(lotStats.sales) === 1 ? '' : 's'}
                  {(() => {
                    const avg = parseFloat(lotStats.avg_per_unit) / 1e18;
                    const ask = parseFloat(formatPrice(selectedListing.price_per_unit));
                    if (!avg || !ask) return '';
                    const dev = ((ask - avg) / avg) * 100;
                    return dev > 30 ? ` — ⚠ ${dev.toFixed(0)}% above recent average.` : '';
                  })()}
                </p>
              ) : (
                <p className="lot-fee-note">No settled sales for {selectedListing.crop_type} yet — no price reference.</p>
              )}
              <details className="lot-chain-details">
                <summary>On-chain verification details</summary>
                <code>Image digest: {selectedListing.image_cid || 'not available'}</code>
                <code>Report hash: {selectedListing.report_hash || 'not available'}</code>
              </details>
              <details className="lot-chain-details">
                <summary>Batch QR — print for the shipping box</summary>
                <p className="ed-meta">Scans to the read-only audit page for batch #{selectedListing.token_id}.</p>
                {lotQr && <img src={lotQr} alt={`Audit QR for batch ${selectedListing.token_id}`} style={{ width: '160px', height: '160px' }} />}
              </details>
              <div style={{ display: 'flex', gap: '8px', margin: '14px 0', flexWrap: 'wrap' }}>
                {onTraceBatch && (
                  <button className="btn btn-secondary btn-sm" onClick={() => { onTraceBatch(selectedListing.token_id); setSelectedListing(null); }}>
                    <QrCode size={14} /> Full Batch QR Traceability
                  </button>
                )}
                {onOpenPassport && (
                  <button className="btn btn-secondary btn-sm" onClick={() => { onOpenPassport(selectedListing.token_id); setSelectedListing(null); }}>
                    <Sparkles size={14} /> AI Quality Passport
                  </button>
                )}
              </div>
              <div className="lot-modal-actions">
                <button className="btn btn-secondary" onClick={() => setSelectedListing(null)}>Close</button>
                {isBuyer ? (
                  <button
                    className="btn btn-primary" disabled={isSubmitting}
                    onClick={async () => { try { setIsSubmitting(true); await onBuyListing(selectedListing, selectedListing.available_quantity); setSelectedListing(null); } finally { setIsSubmitting(false); } }}
                  >
                    {isSubmitting ? 'Waiting for confirmation…' : 'Buy full lot'}
                  </button>
                ) : (
                  <span className="ed-meta" style={{ alignSelf: 'center' }}>Farmer view is read-only — switch to Buyer view to purchase.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
