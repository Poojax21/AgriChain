import React from 'react';
import { Package, Truck, Clock, CheckCircle2, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react';
import { ethers } from 'ethers';

export interface OrderTrackingTimelineProps {
  order: {
    order_id: number;
    listing_id: number;
    token_id: number;
    buyer_address: string;
    farmer_address: string;
    quantity: number;
    total_amount: string;
    platform_fee: string;
    status: string;
    placed_at?: number;
    shipped_at?: number;
    received_at?: number;
    delivered_at?: number;
    tx_hash?: string | null;
    dispute_reason_hash?: string | null;
  };
  cropType?: string;
  isBuyer?: boolean;
  isFarmer?: boolean;
  onShip?: (orderId: number) => void;
  onMarkReceived?: (orderId: number) => void;
  onConfirmDelivery?: (orderId: number) => void;
  onRaiseDispute?: (order: any) => void;
  onViewCheckpoints?: (orderId: number) => void;
  onTraceBatch?: (tokenId: number) => void;
}

export const OrderTrackingTimeline: React.FC<OrderTrackingTimelineProps> = ({
  order,
  cropType,
  isBuyer,
  isFarmer,
  onShip,
  onMarkReceived,
  onConfirmDelivery,
  onRaiseDispute,
  onViewCheckpoints,
  onTraceBatch,
}) => {
  const status = (order.status || 'PLACED').toUpperCase();
  const formatTime = (ts?: number) => {
    if (!ts || ts <= 0) return 'Pending';
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const toAgri = (wei: string) => {
    try {
      return (Number(ethers.formatEther(wei || '0'))).toFixed(2);
    } catch {
      return '0.00';
    }
  };

  // Lifecycle steps: Placed -> Shipped -> Received -> Delivered
  const isPlaced = true;
  const isShipped = ['SHIPPED', 'RECEIVED', 'DELIVERED', 'RESOLVED'].includes(status) || (order.shipped_at && order.shipped_at > 0);
  const isReceived = ['RECEIVED', 'DELIVERED', 'RESOLVED'].includes(status) || (order.received_at && order.received_at > 0);
  const isDelivered = status === 'DELIVERED' || status === 'RESOLVED' || (order.delivered_at && order.delivered_at > 0);
  const isDisputed = status === 'DISPUTED';

  const steps = [
    {
      title: 'Order Placed & Escrow Locked',
      desc: `${toAgri(order.total_amount)} AGRI held in smart contract escrow`,
      time: formatTime(order.placed_at),
      done: true,
      active: status === 'PLACED',
      icon: Package,
    },
    {
      title: 'Dispatched & In-Transit',
      desc: isShipped ? 'Carrier recorded transit checkpoints' : 'Farmer preparing consignment',
      time: formatTime(order.shipped_at),
      done: Boolean(isShipped),
      active: status === 'SHIPPED',
      icon: Truck,
    },
    {
      title: 'Physical Receipt Confirmed',
      desc: isReceived ? 'Delivered to destination; 3-day inspection window' : 'Awaiting physical delivery',
      time: formatTime(order.received_at),
      done: Boolean(isReceived),
      active: status === 'RECEIVED',
      icon: Clock,
    },
    {
      title: isDisputed ? 'Dispute Opened (Escrow Frozen)' : 'Delivery Confirmed & Settled',
      desc: isDisputed
        ? 'DAO arbitration voting in progress'
        : isDelivered
        ? 'Escrow released to farmer, NFT transferred'
        : 'Final settlement awaiting buyer confirmation or timeout',
      time: isDisputed ? 'Frozen' : formatTime(order.delivered_at),
      done: Boolean(isDelivered || isDisputed),
      active: isDelivered || isDisputed,
      icon: isDisputed ? AlertTriangle : CheckCircle2,
      isDispute: isDisputed,
    },
  ];

  return (
    <div style={{ background: 'rgba(255,255,255,0.85)', borderRadius: '16px', padding: '24px', border: '1px solid var(--border-subtle)' }}>
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <strong style={{ fontSize: '1.15rem', color: '#01472e' }}>Order #{order.order_id}</strong>
            <span className={`badge ${isDisputed ? 'badge-rejected' : isDelivered ? 'badge-grade-a' : isReceived ? 'badge-grade-b' : 'badge-neutral'}`}>
              {status}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
            {cropType ? `${cropType} · ` : ''}Batch #{order.token_id} · {order.quantity} kg · <strong>{toAgri(order.total_amount)} AGRI</strong>
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '2px' }}>
            Farmer: <code className="font-mono">{(order.farmer_address || '').slice(0, 8)}…{(order.farmer_address || '').slice(-4)}</code> → Buyer: <code className="font-mono">{(order.buyer_address || '').slice(0, 8)}…{(order.buyer_address || '').slice(-4)}</code>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {onTraceBatch && (
            <button className="btn btn-secondary btn-sm" onClick={() => onTraceBatch(order.token_id)}>
              <ShieldCheck size={14} /> Trace Batch QR
            </button>
          )}
          {onViewCheckpoints && (
            <button className="btn btn-secondary btn-sm" onClick={() => onViewCheckpoints(order.order_id)}>
              <Truck size={14} /> Transit Checkpoints
            </button>
          )}
        </div>
      </div>

      {/* Stepper Progress Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {steps.map((st, i) => {
          const Icon = st.icon;
          const bg = st.isDispute
            ? 'rgba(143,29,29,0.08)'
            : st.done
            ? 'rgba(1,71,46,0.08)'
            : 'rgba(0,0,0,0.02)';
          const borderColor = st.isDispute
            ? '#8f1d1d'
            : st.active
            ? 'var(--primary)'
            : st.done
            ? 'rgba(1,71,46,0.3)'
            : 'var(--border-subtle)';
          return (
            <div
              key={st.title}
              style={{
                background: bg,
                border: `1.5px solid ${borderColor}`,
                borderRadius: '12px',
                padding: '14px',
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>STEP 0{i + 1}</span>
                <Icon size={18} color={st.isDispute ? '#8f1d1d' : st.done ? 'var(--primary)' : 'var(--text-muted)'} />
              </div>
              <h4 style={{ fontSize: '0.9rem', color: st.isDispute ? '#8f1d1d' : '#01472e', margin: '0 0 4px 0', lineHeight: 1.3 }}>
                {st.title}
              </h4>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 6px 0', minHeight: '32px' }}>
                {st.desc}
              </p>
              <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {st.time}
              </span>
            </div>
          );
        })}
      </div>

      {/* Action Buttons for Buyer & Farmer */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
        {order.tx_hash && (
          <span className="ed-meta" style={{ marginRight: 'auto', fontSize: '0.78rem' }}>
            Tx: <code className="font-mono">{order.tx_hash.slice(0, 10)}…{order.tx_hash.slice(-6)}</code>
          </span>
        )}

        {isFarmer && status === 'PLACED' && onShip && (
          <button className="btn btn-primary btn-sm" onClick={() => onShip(order.order_id)}>
            <Truck size={14} /> Mark as Shipped
          </button>
        )}

        {isBuyer && status === 'SHIPPED' && onMarkReceived && (
          <button className="btn btn-secondary btn-sm" onClick={() => onMarkReceived(order.order_id)}>
            <Clock size={14} /> Confirm Receipt (Starts 3d Inspection)
          </button>
        )}

        {isBuyer && (status === 'SHIPPED' || status === 'RECEIVED') && onConfirmDelivery && (
          <button className="btn btn-primary btn-sm" onClick={() => onConfirmDelivery(order.order_id)}>
            <CheckCircle2 size={14} /> Confirm Delivery & Release Escrow
          </button>
        )}

        {isBuyer && (status === 'SHIPPED' || status === 'RECEIVED') && onRaiseDispute && (
          <button className="btn btn-danger btn-sm" onClick={() => onRaiseDispute(order)}>
            <AlertTriangle size={14} /> Raise Defect Dispute
          </button>
        )}
      </div>
    </div>
  );
};
