import React, { useState, useEffect, useRef } from 'react';
import { Search, ShieldCheck, FileSearch } from 'lucide-react';
import { ethers } from 'ethers';
import { BACKEND_URL, CONTRACT_ADDRESSES, CROP_BATCH_NFT_ABI, ERC721_APPROVE_ABI, ACCESS_CONTROL_ABI, AGRI_MARKETPLACE_ABI, SUPPLY_CHAIN_TRACKER_ABI } from '../contracts';
import { readOnlyProvider } from '../web3/tx';

interface AuditExplorerProps {
  listings: any[];
  orders: any[];
  disputes: any[];
  initialQuery?: string;
}

// Auditor / Observer: verify everything, change nothing. Every value below is
// read live from the chain or the indexer at inspection time — no stored copies.
export const AuditExplorer: React.FC<AuditExplorerProps> = ({ listings, orders, disputes, initialQuery }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const autoRan = useRef('');

  // Deep links (?inspect=batch:4) from QR codes land here.
  useEffect(() => {
    if (initialQuery && initialQuery !== autoRan.current) {
      autoRan.current = initialQuery;
      setQuery(initialQuery);
      inspect(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const inspect = async (raw?: string) => {
    const q = (raw ?? query).trim().replace(/^(batch|order|token)[:#]/i, '');
    if (!/^\d+$/.test(q)) { setError('Enter a numeric batch (token) ID or order ID.'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const provider = readOnlyProvider();
      const nft = new ethers.Contract(CONTRACT_ADDRESSES.CropBatchNFT, [...CROP_BATCH_NFT_ABI, ...ERC721_APPROVE_ABI, ...ACCESS_CONTROL_ABI], provider);
      const market = new ethers.Contract(CONTRACT_ADDRESSES.AgriMarketplace, AGRI_MARKETPLACE_ABI, provider);
      const tracker = new ethers.Contract(CONTRACT_ADDRESSES.SupplyChainTracker, SUPPLY_CHAIN_TRACKER_ABI, provider);
      const id = BigInt(q);

      // Try batch first (token IDs and order IDs share numbering only by coincidence).
      let batch: any = null;
      let owner = '';
      try {
        const b = await nft.getBatch(id);
        if (b.farmer !== ethers.ZeroAddress) {
          batch = {
            farmer: b.farmer, cropType: b.cropType, quantity: b.quantity.toString(), unit: b.unit,
            harvestDate: Number(b.harvestDate), farmLocation: b.farmLocation, imageCID: b.imageCID,
            qualityGrade: Number(b.qualityGrade), confidenceScore: Number(b.confidenceScore),
            reportHash: b.reportHash, isVerified: b.isVerified, checkpointRoot: b.merkleCheckpointRoot,
          };
          owner = await nft.ownerOf(id);
        }
      } catch { /* not a batch: fall through to order lookup */ }

      // Order by the same number, if any.
      let order: any = null;
      try {
        const o = await market.getOrder(id);
        if (Number(o.orderId) !== 0) {
          order = {
            orderId: Number(o.orderId), listingId: Number(o.listingId), tokenId: Number(o.tokenId),
            buyer: o.buyer, farmer: o.farmer, quantity: o.quantity.toString(),
            totalAmount: o.totalAmount.toString(), platformFee: o.platformFee.toString(),
            status: ['PLACED', 'SHIPPED', 'DELIVERED', 'DISPUTED', 'RESOLVED', 'CANCELLED', 'RECEIVED'][Number(o.status)],
            placedAt: Number(o.placedAt), shippedAt: Number(o.shippedAt),
            receivedAt: Number((o as any).receivedAt ?? 0), deliveredAt: Number(o.deliveredAt),
            disputeReasonHash: o.disputeReasonHash,
          };
        }
      } catch { /* no such order */ }

      // Cross-reference indexer rows + checkpoints + disputes for the same entities.
      const tokenId = batch ? Number(id) : order ? order.tokenId : null;
      const orderRow = order ? (orders.find((x: any) => x.order_id === order.orderId) || null) : null;
      const listingRow = tokenId !== null ? (listings.find((x: any) => Number(x.token_id) === tokenId) || null) : null;
      const disputeRow = order ? (disputes.find((x: any) => x.order_id === order.orderId) || null) : null;
      let checkpoints: any = null;
      let chainRoot = '';
      let deliveryLeaf = '';
      if (order) {
        try {
          chainRoot = await tracker.orderCheckpointRoots(order.orderId);
          deliveryLeaf = await tracker.deliveryCheckpointLeaves(order.orderId);
        } catch { /* tracker read failed */ }
        try {
          checkpoints = await fetch(`${BACKEND_URL}/api/checkpoints/${order.orderId}`).then((r) => r.json());
        } catch { /* indexer offline */ }
      }
      if (!batch && !order) { setError(`No batch or order #${q} exists on the connected chain.`); return; }
      setResult({ tokenId, batch, owner, order, orderRow, listingRow, disputeRow, checkpoints, chainRoot, deliveryLeaf });
    } catch (e: any) {
      setError(e?.message || 'Inspection failed.');
    } finally {
      setLoading(false);
    }
  };

  const short = (v: any) => (typeof v === 'string' && v.startsWith('0x') && v.length > 14 ? `${v.slice(0, 10)}…${v.slice(-6)}` : String(v ?? '—'));

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
      <div className="glass-panel" style={{ padding: '32px', marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', marginBottom: '8px' }}>
          <FileSearch size={20} />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Auditor · Observer (read-only)
          </span>
        </div>
        <h2 style={{ fontSize: '1.8rem', color: '#01472e' }}>Batch & Order Explorer</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
          Verify everything, change nothing. Enter a batch (NFT token) ID or an order ID — every field
          below is read live from the blockchain and the indexer. Nothing here can modify state.
        </p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
          <input
            className="form-input font-mono"
            style={{ maxWidth: '280px' }}
            placeholder="Batch or order ID, e.g. 1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') inspect(); }}
          />
          <button className="btn btn-primary btn-sm" disabled={loading || !query.trim()} onClick={() => inspect()}>
            <Search size={14} /> {loading ? 'Reading chain…' : 'Inspect'}
          </button>
        </div>
        {error && <p style={{ color: '#8f1d1d', fontSize: '0.85rem', marginTop: '12px' }}>{error}</p>}
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px' }}>
          {result.batch && (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ color: '#01472e', marginBottom: '12px' }}>
                <ShieldCheck size={16} /> Batch #{result.tokenId} {result.batch.isVerified ? '(VERIFIED on-chain)' : '(UNVERIFIED)'}
              </h3>
              {[
                ['Farmer', result.batch.farmer], ['Current NFT owner', result.owner],
                ['Crop', `${result.batch.cropType} · ${result.batch.quantity} ${result.batch.unit}`],
                ['Farm', result.batch.farmLocation],
                ['Grade', `${result.batch.qualityGrade} · confidence ${(result.batch.confidenceScore / 100).toFixed(2)}%`],
                ['Report hash', result.batch.reportHash], ['Image digest', result.batch.imageCID],
                ['Checkpoint root', result.batch.checkpointRoot],
              ].map(([k, v]) => (
                <p key={k} style={{ fontSize: '0.82rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                  <code className="font-mono" style={{ wordBreak: 'break-all' }}>{short(v)}</code>
                </p>
              ))}
              {result.listingRow && (
                <p style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Listing: </span>
                  #{result.listingRow.listing_id} · {(parseFloat(result.listingRow.price_per_unit) / 1e18).toFixed(2)} AGRI · {result.listingRow.status}
                </p>
              )}
            </div>
          )}
          {result.order && (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ color: '#01472e', marginBottom: '12px' }}>Order #{result.order.orderId} · {result.order.status}</h3>
              {[
                ['Buyer', result.order.buyer], ['Farmer', result.order.farmer],
                ['Escrow locked', `${ethers.formatEther(result.order.totalAmount)} AGRI (fee ${ethers.formatEther(result.order.platformFee)})`],
                ['Placed / shipped / received', `${result.order.placedAt || '—'} / ${result.order.shippedAt || '—'} / ${result.order.receivedAt || '—'}`],
                ['Dispute hash', result.order.disputeReasonHash],
                ['Chain checkpoint root', result.chainRoot || '—'],
                ['Delivery leaf designated', result.deliveryLeaf && !/^0x0{64}$/i.test(result.deliveryLeaf) ? result.deliveryLeaf : 'no'],
                ['Indexer checkpoints', result.checkpoints?.success ? `${result.checkpoints.count} with proofs` : 'indexer offline / none'],
              ].map(([k, v]) => (
                <p key={k} style={{ fontSize: '0.82rem', marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                  <code className="font-mono" style={{ wordBreak: 'break-all' }}>{short(v)}</code>
                </p>
              ))}
              {result.disputeRow && (
                <p style={{ fontSize: '0.82rem', marginTop: '8px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>DAO case: </span>
                  #{result.disputeRow.dispute_id} · {result.disputeRow.verdict} · {result.disputeRow.is_resolved ? 'settled' : 'voting'}
                  {result.disputeRow.evidence_url ? ` · photo: ${BACKEND_URL}${result.disputeRow.evidence_url}` : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
