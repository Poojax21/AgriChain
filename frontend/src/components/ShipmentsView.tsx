import React from 'react';
import { Truck, Eye, PackageCheck } from 'lucide-react';

interface ShipmentsViewProps {
  orders: any[];
  listings: any[];
  walletAddress: string | null;
  isLogistics: boolean;
  onViewCheckpoints: (orderId: number) => void;
  onShipOrder: (orderId: number) => Promise<void>;
}

// Logistics / Carrier: prove "this batch physically moved". Checkpoint roots
// are committed and delivery leaves designated through the transit inspector;
// this board shows what needs moving. Carriers see every open shipment,
// farmers see their own farm's dispatches.
export const ShipmentsView: React.FC<ShipmentsViewProps> = ({
  orders, listings, walletAddress, isLogistics, onViewCheckpoints, onShipOrder,
}) => {
  const mine = (orders || []).filter(
    (o) => walletAddress && (o.farmer_address || '').toLowerCase() === walletAddress.toLowerCase()
  );
  const openAll = (orders || []).filter((o) =>
    ['PLACED', 'SHIPPED', 'RECEIVED'].includes(o.status)
  );
  const asBuyer = (orders || []).filter(
    (o) => walletAddress && (o.buyer_address || '').toLowerCase() === walletAddress.toLowerCase()
  );
  const cropOf = (order: any) => {
    const l = (listings || []).find((x: any) => x.listing_id === order.listing_id);
    return l ? `${l.crop_type} · batch #${order.token_id}` : `batch #${order.token_id}`;
  };

  const Row = ({ order, showShip }: { order: any; showShip: boolean }) => (
    <div
      key={order.order_id}
      style={{ background: 'rgba(1,71,46,0.05)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '18px' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <strong style={{ color: '#01472e' }}>Shipment · Order #{order.order_id}</strong>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {cropOf(order)} · {(parseFloat(order.total_amount) / 1e18).toFixed(2)} AGRI escrowed
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            Farmer {(order.farmer_address || '').slice(0, 6)}…{(order.farmer_address || '').slice(-4)} → Buyer {(order.buyer_address || '').slice(0, 6)}…{(order.buyer_address || '').slice(-4)}
          </p>
        </div>
        <span className={`badge ${order.status === 'RECEIVED' ? 'badge-grade-b' : 'badge-neutral'}`}>{order.status}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => onViewCheckpoints(order.order_id)}>
          <Eye size={14} /> Transit inspector
        </button>
        {showShip && order.status === 'PLACED' && (
          <button className="btn btn-primary btn-sm" onClick={() => onShipOrder(order.order_id)}>
            <Truck size={14} /> Mark as shipped
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
          <Truck size={20} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Logistics Provider / Carrier
          </span>
        </div>
        <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>Shipment Board</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
          {isLogistics
            ? 'Your wallet holds TRACKER_ROLE: every open shipment below is yours to move and prove.'
            : 'Farmers see their own dispatches here. A wallet with TRACKER_ROLE (granted in Gov) sees every open shipment.'}
          {' '}Roots are committed and delivery leaves designated inside the transit inspector — only the Merkle root ever touches the chain.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '32px', marginBottom: '28px' }}>
        <h3 style={{ fontSize: '1.3rem', color: '#01472e', marginBottom: '16px' }}>My farm's shipments</h3>
        {mine.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--text-muted)' }}>
            <PackageCheck size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
            <p>No shipments for the connected wallet yet.</p>
            {asBuyer.length > 0 ? (
              <p style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                This wallet is the <strong>buyer</strong> on {asBuyer.length} order{asBuyer.length === 1 ? '' : 's'} — manage {asBuyer.length === 1 ? 'it' : 'them'} under Market → My Orders, not here.
              </p>
            ) : openAll.length > 0 ? (
              <p style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                {openAll.length} open shipment{openAll.length === 1 ? '' : 's'} exist{openAll.length === 1 ? 's' : ''} on the network. Connect the farmer wallet to see {openAll.length === 1 ? 'it' : 'them'} here, or grant this wallet TRACKER_ROLE in Gov for the carrier view.
              </p>
            ) : (
              <p style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                No open shipments exist yet — buy a lot first, then its shipment appears here.
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {mine.map((o) => <Row key={o.order_id} order={o} showShip />)}
          </div>
        )}
      </div>

      {isLogistics && (
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ fontSize: '1.3rem', color: '#01472e', marginBottom: '16px' }}>All open shipments (carrier view)</h3>
          {openAll.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No open shipments on the network.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {openAll.map((o) => <Row key={o.order_id} order={o} showShip={false} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
