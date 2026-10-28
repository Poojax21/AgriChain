import React, { useState } from 'react';
import { ShieldCheck, Search, Filter, Sparkles, MapPin, Calendar, CheckCircle2, AlertTriangle, Truck, Eye } from 'lucide-react';

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
  delivered_at: number;
}

interface MarketplaceViewProps {
  listings: Listing[];
  orders: Order[];
  walletAddress: string | null;
  onBuyListing: (listing: Listing, quantity: number) => Promise<void>;
  onConfirmDelivery: (orderId: number) => Promise<void>;
  onRaiseDispute: (orderId: number) => void;
  onViewCheckpoints: (orderId: number) => void;
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  listings,
  orders,
  walletAddress,
  onBuyListing,
  onConfirmDelivery,
  onRaiseDispute,
  onViewCheckpoints,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'browse' | 'my-orders'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<number | 'ALL'>('ALL');
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [buyQuantity, setBuyQuantity] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter listings
  const filteredListings = listings.filter((item) => {
    const matchesSearch =
      item.crop_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.farmer_address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesGrade = gradeFilter === 'ALL' || item.quality_grade === gradeFilter;
    return matchesSearch && matchesGrade;
  });

  // Filter user's active orders
  const myOrders = orders.filter(
    (o) => walletAddress && o.buyer_address.toLowerCase() === walletAddress.toLowerCase()
  );

  const getGradeBadge = (grade: number, confidence: number) => {
    const pct = (confidence / 100).toFixed(1);
    switch (grade) {
      case 1:
        return <span className="badge badge-grade-a"><ShieldCheck size={13} /> Grade A ({pct}%)</span>;
      case 2:
        return <span className="badge badge-grade-b"><ShieldCheck size={13} /> Grade B ({pct}%)</span>;
      case 3:
        return <span className="badge badge-grade-c"><AlertTriangle size={13} /> Grade C ({pct}%)</span>;
      default:
        return <span className="badge badge-rejected">Rejected</span>;
    }
  };

  const getCropPhoto = (cropType: string) => {
    const lower = cropType.toLowerCase();
    if (lower.includes('rice')) return 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=80';
    if (lower.includes('apple')) return 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=600&auto=format&fit=crop&q=80';
    if (lower.includes('wheat')) return 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=600&auto=format&fit=crop&q=80';
    if (lower.includes('tomato')) return 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&auto=format&fit=crop&q=80';
    if (lower.includes('soy')) return 'https://images.unsplash.com/photo-1599586120429-48281b6f0ece?w=600&auto=format&fit=crop&q=80';
    return 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600&auto=format&fit=crop&q=80';
  };

  const formatPrice = (priceWei: string) => {
    try {
      const num = parseFloat(priceWei) / 1e18;
      return isNaN(num) ? '2.0' : num.toFixed(2);
    } catch {
      return '2.0';
    }
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      
      {/* Hero Stats Section */}
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
              <Sparkles size={18} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                AI-Verified Harvests
              </span>
            </div>
            <h2 style={{ fontSize: '1.8rem', color: '#fff' }}>Decentralized Agricultural Exchange</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
              Zero middlemen. Direct farmer custody transfer backed by AI quality oracles and on-chain escrow.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '32px', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Active Listings</p>
              <h3 style={{ fontSize: '1.8rem', color: '#fff' }}>{listings.length}</h3>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Platform Fee</p>
              <h3 style={{ fontSize: '1.8rem', color: 'var(--primary)' }}>2.0%</h3>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Settlement Speed</p>
              <h3 style={{ fontSize: '1.8rem', color: '#f59e0b' }}>Instant</h3>
            </div>
          </div>
        </div>
      </div>

      {/* View Switcher: Browse Catalog vs My Orders */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`btn ${activeSubTab === 'browse' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('browse')}
          >
            Marketplace Catalog ({listings.length})
          </button>
          <button
            className={`btn ${activeSubTab === 'my-orders' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveSubTab('my-orders')}
          >
            My Orders & Shipments ({myOrders.length})
          </button>
        </div>

        {/* Filter Controls (When in Browse Mode) */}
        {activeSubTab === 'browse' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search crops, farms..."
                className="form-input"
                style={{ paddingLeft: '38px', fontSize: '0.88rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Filter size={15} color="var(--text-muted)" />
              <select
                className="form-input"
                style={{ width: 'auto', padding: '8px 12px', fontSize: '0.88rem' }}
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
              >
                <option value="ALL">All Grades</option>
                <option value="1">Grade A (Premium)</option>
                <option value="2">Grade B (Commercial)</option>
                <option value="3">Grade C (Industrial)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* SUB-VIEW 1: BROWSE CATALOG */}
      {activeSubTab === 'browse' && (
        <>
          {filteredListings.length === 0 ? (
            <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <ShieldCheck size={48} color="var(--text-muted)" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ color: '#fff', marginBottom: '8px' }}>No Listings Found</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto' }}>
                There are currently no active listings matching your filter criteria. Try changing your filters or check back soon!
              </p>
            </div>
          ) : (
            <div className="grid-marketplace">
              {filteredListings.map((item) => {
                const unitPrice = formatPrice(item.price_per_unit);
                const photoUrl = getCropPhoto(item.crop_type);

                return (
                  <div key={item.listing_id} className="glass-panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Crop Image & Grade Overlay */}
                    <div style={{ position: 'relative', height: '180px', width: '100%', overflow: 'hidden' }}>
                      <img
                        src={photoUrl}
                        alt={item.crop_type}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                      />
                      <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                        {getGradeBadge(item.quality_grade, item.confidence_score)}
                      </div>
                      <div style={{ position: 'absolute', bottom: '10px', left: '12px' }}>
                        <span className="badge badge-neutral" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
                          Batch #{item.token_id}
                        </span>
                      </div>
                    </div>

                    {/* Card Content */}
                    <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{item.crop_type}</h3>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)' }}>
                              {unitPrice}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}> AGRI/{item.unit}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: '14px' }}>
                          <MapPin size={13} color="var(--primary)" />
                          <span>Farmer: {item.farmer_address.slice(0, 6)}...{item.farmer_address.slice(-4)}</span>
                        </div>

                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '16px' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Available Lot:</span>
                          <strong style={{ color: '#fff' }}>{item.available_quantity.toLocaleString()} {item.unit}</strong>
                        </div>
                      </div>

                      <button
                        className="btn btn-primary"
                        style={{ width: '100%' }}
                        onClick={() => {
                          setSelectedListing(item);
                          setBuyQuantity(item.available_quantity);
                        }}
                      >
                        Buy & Lock Escrow
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* SUB-VIEW 2: MY ORDERS & SHIPMENTS */}
      {activeSubTab === 'my-orders' && (
        <div>
          {myOrders.length === 0 ? (
            <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <Truck size={48} color="var(--text-muted)" style={{ margin: '0 auto 16px' }} />
              <h3 style={{ color: '#fff', marginBottom: '8px' }}>No Orders Placed Yet</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto' }}>
                When you purchase verified crop lots, your escrow transactions and live Merkle transit tracking will appear here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {myOrders.map((order) => {
                const totalAgri = (parseFloat(order.total_amount) / 1e18).toFixed(2);
                return (
                  <div key={order.order_id} className="glass-panel" style={{ padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Order #{order.order_id}</h3>
                          <span className={`badge ${
                            order.status === 'DELIVERED' ? 'badge-grade-a' :
                            order.status === 'DISPUTED' ? 'badge-rejected' :
                            order.status === 'SHIPPED' ? 'badge-grade-b' : 'badge-neutral'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '4px' }}>
                          Farmer: {order.farmer_address} • Batch #{order.token_id}
                        </p>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>
                          {totalAgri} AGRI
                        </span>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Locked in Smart Escrow</p>
                      </div>
                    </div>

                    {/* Action Bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => onViewCheckpoints(order.order_id)}
                      >
                        <Eye size={14} />
                        Inspect Merkle Transit Checkpoints
                      </button>

                      <div style={{ display: 'flex', gap: '10px' }}>
                        {order.status === 'SHIPPED' && (
                          <>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => onRaiseDispute(order.order_id)}
                            >
                              <AlertTriangle size={14} />
                              Raise Dispute
                            </button>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => onConfirmDelivery(order.order_id)}
                            >
                              <CheckCircle2 size={14} />
                              Confirm Delivery & Release Funds
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* BUY & ESCROW CHECKOUT MODAL */}
      {selectedListing && (
        <div className="modal-overlay" onClick={() => setSelectedListing(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: '#fff', fontSize: '1.5rem', marginBottom: '8px' }}>
              Confirm Escrow Purchase
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '20px' }}>
              Your AGRI payment will be safely held in the smart contract escrow until you inspect and confirm delivery.
            </p>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Crop Variety:</span>
                <strong style={{ color: '#fff' }}>{selectedListing.crop_type}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>AI Grade:</span>
                <div>{getGradeBadge(selectedListing.quality_grade, selectedListing.confidence_score)}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Unit Price:</span>
                <span style={{ color: '#fff' }}>{formatPrice(selectedListing.price_per_unit)} AGRI / {selectedListing.unit}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Batch Lot Quantity:</span>
                <span style={{ color: '#fff' }}>{selectedListing.available_quantity} {selectedListing.unit}</span>
              </div>
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px', marginTop: '10px', display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: '#fff' }}>Total Escrow Deposit:</strong>
                <strong style={{ color: 'var(--primary)', fontSize: '1.2rem' }}>
                  {(parseFloat(formatPrice(selectedListing.price_per_unit)) * selectedListing.available_quantity).toFixed(2)} AGRI
                </strong>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Includes 2.0% platform fee deducted automatically upon delivery completion.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setSelectedListing(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={isSubmitting}
                onClick={async () => {
                  try {
                    setIsSubmitting(true);
                    await onBuyListing(selectedListing, selectedListing.available_quantity);
                    setSelectedListing(null);
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              >
                {isSubmitting ? 'Locking Escrow...' : 'Deposit Escrow'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
