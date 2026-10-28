import React, { useState } from 'react';
import { X, Bell, CheckCircle2, Truck, Package, AlertTriangle, ShieldCheck, ExternalLink, CheckCheck } from 'lucide-react';
import { BACKEND_URL } from '../contracts';
import { getAuthHeaders } from '../web3/wallet';

export interface NotificationItem {
  id: number;
  recipient_address: string;
  event_key: string;
  title: string;
  message: string;
  type: string;
  link?: string | null;
  is_read: number;
  created_at: number;
}

interface NotificationCenterModalProps {
  notifications: NotificationItem[];
  walletAddress: string | null;
  onClose: () => void;
  onRefreshNotifications: () => void;
  onNavigateLink?: (link: string) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  notifications,
  walletAddress,
  onClose,
  onRefreshNotifications,
  onNavigateLink,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [marking, setMarking] = useState(false);

  const filtered = notifications.filter((n) => filter === 'ALL' || n.is_read === 0);
  const unreadCount = notifications.filter((n) => n.is_read === 0).length;

  const markOneRead = async (id: number) => {
    try {
      await fetch(`${BACKEND_URL}/api/notifications/${id}/read`, {
        method: 'PUT',
        headers: getAuthHeaders(),
      });
      onRefreshNotifications();
    } catch {}
  };

  const markAllRead = async () => {
    if (!walletAddress) return;
    try {
      setMarking(true);
      await fetch(`${BACKEND_URL}/api/notifications/read-all`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ address: walletAddress }),
      });
      onRefreshNotifications();
    } catch {
    } finally {
      setMarking(false);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'ORDER_PLACED':
        return <Package size={18} color="var(--primary)" />;
      case 'ORDER_SHIPPED':
        return <Truck size={18} color="#0284c7" />;
      case 'ORDER_RECEIVED':
        return <CheckCircle2 size={18} color="#16a34a" />;
      case 'DELIVERY_CONFIRMED':
        return <ShieldCheck size={18} color="#16a34a" />;
      case 'DISPUTE_OPENED':
        return <AlertTriangle size={18} color="#dc2626" />;
      default:
        return <Bell size={18} color="var(--primary)" />;
    }
  };

  const formatTime = (ts: number) => {
    if (!ts) return 'Just now';
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts * 1000).toLocaleDateString();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '540px', maxHeight: '80vh', overflowY: 'auto', padding: '28px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bell size={20} color="var(--primary)" />
            <h2 style={{ fontSize: '1.4rem', color: '#01472e', margin: 0 }}>Activity & Notifications</h2>
            {unreadCount > 0 && <span className="badge badge-grade-b">{unreadCount} new</span>}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '6px' }}>
            <X size={18} />
          </button>
        </div>

        {/* Filter controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className={`btn btn-sm ${filter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('ALL')}
            >
              All ({notifications.length})
            </button>
            <button
              className={`btn btn-sm ${filter === 'UNREAD' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter('UNREAD')}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {unreadCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={markAllRead} disabled={marking} style={{ fontSize: '0.78rem' }}>
              <CheckCheck size={14} /> Mark all read
            </button>
          )}
        </div>

        {/* Notifications list */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Bell size={32} opacity={0.3} style={{ margin: '0 auto 8px' }} />
            <p style={{ margin: 0, fontSize: '0.9rem' }}>No notifications found.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filtered.map((item) => (
              <div
                key={item.id}
                style={{
                  background: item.is_read ? 'rgba(0,0,0,0.02)' : 'rgba(1,71,46,0.06)',
                  border: `1px solid ${item.is_read ? 'var(--border-subtle)' : 'rgba(1,71,46,0.2)'}`,
                  borderRadius: '12px',
                  padding: '14px',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <div style={{ marginTop: '2px' }}>{getIcon(item.type)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '0.9rem', color: '#01472e' }}>{item.title}</strong>
                      <span className="font-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {formatTime(item.created_at)}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
                      {item.message}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {item.link && onNavigateLink && (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.74rem', padding: '4px 8px' }}
                          onClick={() => {
                            if (!item.is_read) markOneRead(item.id);
                            onNavigateLink(item.link!);
                            onClose();
                          }}
                        >
                          <ExternalLink size={12} /> View Details
                        </button>
                      )}
                      {!item.is_read && (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '0.74rem', padding: '4px 8px' }}
                          onClick={() => markOneRead(item.id)}
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
