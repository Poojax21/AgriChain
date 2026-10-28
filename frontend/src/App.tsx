import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { MarketplaceView } from './components/MarketplaceView';
import { FarmerDashboard } from './components/FarmerDashboard';
import { OracleDashboard } from './components/OracleDashboard';
import { JurorDashboard } from './components/JurorDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { TransitModal } from './components/TransitModal';
import { Reveal } from './components/Reveal';
import { EditorialFooter } from './components/EditorialFooter';
import { WalletAuth } from './components/WalletAuth';
import { AccountPanel } from './components/AccountPanel';
import { ShipmentsView } from './components/ShipmentsView';
import { AuditExplorer } from './components/AuditExplorer';
import { SustainabilityBoard } from './components/SustainabilityBoard';
import { SystemPanel } from './components/SystemPanel';
import { BatchTraceabilityModal } from './components/BatchTraceabilityModal';
import { AIQualityPassportModal } from './components/AIQualityPassportModal';
import { NotificationCenterModal, type NotificationItem } from './components/NotificationCenterModal';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, BACKEND_URL, MINTER_ROLE_HASH, AGRI_MARKETPLACE_ABI, CROP_BATCH_NFT_ABI, ACCESS_CONTROL_ABI, SUPPORTED_CHAIN_ID } from './contracts';
import { connectWallet, rememberWallet, lastWallet, switchToSupportedNetwork, fetchWalletProfile, getInjectedProvider, getAuthHeaders, signInWithEthereum, type WalletProfile } from './web3/wallet';
import { runTx, parseTxError, idleTx, readContracts, readOnlyProvider, type TxState } from './web3/tx';
import { TxTracker } from './components/TxTracker';

interface Toast { id: string; message: string; type: 'success' | 'error' | 'info'; }

function readLocalDemoImage(metadataURI: string): string {
  try {
    const prefix = 'data:application/json;base64,';
    if (!metadataURI.startsWith(prefix)) return '';
    const decoded = Uint8Array.from(atob(metadataURI.slice(prefix.length)), (char) => char.charCodeAt(0));
    const metadata = JSON.parse(new TextDecoder().decode(decoded));
    return typeof metadata.image === 'string' && /^\/(demo-crops\/[a-z0-9-]+\.png|crop-photos\/[a-z0-9-]+\.jpg)$/i.test(metadata.image)
      ? metadata.image
      : '';
  } catch {
    return '';
  }
}

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('marketplace');
  // Separate Buyer / Farmer interfaces. Persisted so refresh keeps your side.
  const [viewMode, setViewMode] = useState<'buyer' | 'farmer'>(() => {
    try { return localStorage.getItem('agrichain:viewMode') === 'farmer' ? 'farmer' : 'buyer'; }
    catch { return 'buyer'; }
  });
  const changeViewMode = (m: 'buyer' | 'farmer') => {
    setViewMode(m);
    try { localStorage.setItem('agrichain:viewMode', m); } catch { /* private mode */ }
    setCurrentTab('marketplace');
    window.scrollTo({ top: 0 });
  };
  const goTab = (t: string) => {
    setCurrentTab(t);
    window.scrollTo({ top: 0 });
  };
  // Farmer panel exists only in farmer view; never strand the UI on a hidden tab.
  const visibleTab = viewMode === 'buyer' && currentTab === 'farmer' ? 'marketplace' : currentTab;
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletProfile, setWalletProfile] = useState<WalletProfile | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [agriBalance, setAgriBalance] = useState<string>('0');
  const [reputationScore, setReputationScore] = useState<number>(0);
  const [jurorStakedBalance, setJurorStakedBalance] = useState<string>('0');
  const [minterTarget, setMinterTarget] = useState('');
  const [isFauceting, setIsFauceting] = useState<boolean>(false);
  const [listings, setListings] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [selectedTransitOrderId, setSelectedTransitOrderId] = useState<number | null>(null);
  const [selectedTraceBatchId, setSelectedTraceBatchId] = useState<number | null>(null);
  const [selectedPassportTokenId, setSelectedPassportTokenId] = useState<number | null>(null);
  const [showNotifications, setShowNotifications] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tx, setTx] = useState<TxState>(idleTx);
  const [auditQuery, setAuditQuery] = useState<string | undefined>(undefined);
  // Remembered wallet offered as one-click Continue on the login screen.
  // No silent auto-entry: sign-in is always an explicit action.
  const [pendingSession, setPendingSession] = useState<{ address: string; displayName: string | null } | null>(null);
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  // Offline-first indexer outbox: failed backend writes are queued in
  // localStorage and retried on reconnect. On-chain transactions are NEVER
  // queued — nonces and live signing forbid it; the UI says so explicitly.
  const OUTBOX_KEY = 'agrichain:indexOutbox';
  const flushOutbox = async () => {
    let box: any[] = [];
    try { box = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch { return; }
    if (!box.length) return;
    const rest: any[] = [];
    for (const item of box) {
      try {
        const r = await fetch(item.url, { method: item.method, headers: item.headers, body: item.body });
        if (!r.ok) rest.push(item);
      } catch { rest.push(item); }
    }
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(rest)); } catch {}
    if (rest.length !== box.length) refreshData();
  };
  const queueIndexWrite = async (url: string, init: RequestInit) => {
    try {
      const mergedHeaders = {
        ...getAuthHeaders(),
        ...((init.headers as Record<string, string>) || {})
      };
      const r = await fetch(url, { ...init, headers: mergedHeaders });
      if (!r.ok) throw new Error(String(r.status));
      return r;
    } catch (e) {
      try {
        const box = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
        box.push({
          url,
          method: init.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
            ...((init.headers as Record<string, string>) || {})
          },
          body: typeof init.body === 'string' ? init.body : null,
          ts: Date.now()
        });
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(box.slice(-50)));
      } catch {}
      throw e;
    }
  };
  useEffect(() => {
    const on = () => { setOnline(true); flushOutbox(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    flushOutbox();
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    try {
      const chain = readContracts(readOnlyProvider());
      const listingEvents = await chain.market.queryFilter(chain.market.filters.ListingCreated());
      const liveListings: any[] = [];
      for (const event of listingEvents) {
        const id = Number((event as any).args.listingId);
        const listing = await chain.market.listings(id);
        if (Number(listing.status) !== 0) continue;
        const batch = await chain.nft.getBatch(listing.tokenId);
        const metadataCID = await chain.nft.tokenURI(listing.tokenId);
        liveListings.push({
          listing_id: id,
          token_id: Number(listing.tokenId),
          farmer_address: listing.farmer,
          crop_type: batch.cropType,
          price_per_unit: listing.pricePerUnit.toString(),
          available_quantity: Number(listing.availableQuantity),
          unit: batch.unit,
          quality_grade: Number(batch.qualityGrade),
          grade_name: ['NOT_GRADED', 'GRADE_A', 'GRADE_B', 'GRADE_C', 'REJECTED'][Number(batch.qualityGrade)],
          confidence_score: Number(batch.confidenceScore),
          image_cid: batch.imageCID,
          image_url: readLocalDemoImage(metadataCID),
          report_hash: batch.reportHash,
          farm_location: batch.farmLocation,
          metadata_cid: metadataCID,
          status: 'ACTIVE',
          created_at: Number(listing.createdAt),
        });
      }
      setListings(liveListings.reverse());
      const orderEvents = await chain.market.queryFilter(chain.market.filters.OrderPlaced());
      const liveOrders: any[] = [];
      for (const event of orderEvents) {
        const id = Number((event as any).args.orderId);
        const order = await chain.market.getOrder(id);
        liveOrders.push({
          order_id: id, listing_id: Number(order.listingId), token_id: Number(order.tokenId),
          buyer_address: order.buyer, farmer_address: order.farmer, quantity: Number(order.quantity),
          total_amount: order.totalAmount.toString(), platform_fee: order.platformFee.toString(),
          status: ['PLACED', 'SHIPPED', 'DELIVERED', 'DISPUTED', 'RESOLVED', 'CANCELLED', 'RECEIVED'][Number(order.status)],
          placed_at: Number(order.placedAt), shipped_at: Number(order.shippedAt), delivered_at: Number(order.deliveredAt),
        });
      }
      setOrders(liveOrders.reverse());
      const disputeEvents = await chain.dao.queryFilter(chain.dao.filters.DisputeOpened());
      const liveDisputes: any[] = [];
      for (const event of disputeEvents) {
        const id = Number((event as any).args.disputeId);
        const d = await chain.dao.disputes(id);
        liveDisputes.push({
          dispute_id: id, order_id: Number(d.orderId), buyer_address: d.buyer,
          farmer_address: d.farmer, oracle_node: d.oracleNode, evidence_hash: d.evidenceHash,
          verdict: ['PENDING', 'REFUND_BUYER', 'PAY_FARMER', 'SPLIT_SETTLEMENT'][Number(d.verdict)],
          is_resolved: d.isResolved ? 1 : 0,
          voting_ends_at: Number(d.votingEndsAt),
        });
      }
      setDisputes(liveDisputes.reverse());
    } catch {
      // Never represent a cache row as a live on-chain listing/order.
      setListings([]);
      setOrders([]);
    }
  };

  useEffect(() => {
    // Chain is source of truth; backend SQLite is only an indexer cache.
    // No hardcoded seed listings/orders — empty state until backend returns real indexed rows.
    setListings([]);
    setOrders([]);
    refreshData();
    // QR deep links (?inspect=batch:4 / ?inspect=order:2 / ?trace=4) jump to the audit tab.
    try {
      const sp = new URLSearchParams(window.location.search);
      const q = sp.get('inspect') || (sp.get('trace') ? `batch:${sp.get('trace')}` : null);
      if (q) {
        if (/^batch:(\d+)$/i.test(q)) {
          setSelectedTraceBatchId(Number(q.replace(/^batch:/i, '')));
        }
        setAuditQuery(q);
        setCurrentTab('audit');
        window.scrollTo({ top: 0 });
      }
    } catch { /* ignore malformed URL */ }
    // Returning visit: offer one-click Continue on the login screen instead
    // of silently entering. Nothing connects until the user says so.
    (async () => {
      try {
        setConnecting(true);
        const saved = lastWallet();
        if (!saved) return;
        const eth = getInjectedProvider();
        if (!eth) return;
        const provider = new ethers.BrowserProvider(eth);
        const accounts: string[] = await provider.send('eth_accounts', []);
        const hit = accounts.find((a: string) => a.toLowerCase() === saved.toLowerCase());
        if (!hit) return;
        let displayName: string | null = null;
        try {
          const u = await fetch(`${BACKEND_URL}/api/users/${hit}`).then((r) => r.json());
          displayName = u?.user?.display_name || null;
        } catch { /* name optional */ }
        setPendingSession({ address: hit, displayName });
      } catch { /* stay on login */ } finally {
        setConnecting(false);
      }
    })();
  }, []);

  const handleContinueSession = async () => {
    const s = pendingSession;
    if (!s) return;
    try {
      setConnecting(true);
      setWalletAddress(s.address);
      await loadProfile(s.address);
      setPendingSession(null);
      addToast(`Welcome back${s.displayName ? `, ${s.displayName}` : ''}`, 'success');
    } finally {
      setConnecting(false);
    }
  };

  const loadNotifications = async (addr?: string | null) => {
    const target = addr || walletAddress;
    if (!target) {
      setNotifications([]);
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/api/notifications?address=${target}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.notifications)) {
        setNotifications(data.notifications);
      }
    } catch {}
  };

  const loadProfile = async (address: string) => {
    const p = await fetchWalletProfile(address);
    setWalletProfile(p);
    setAgriBalance(parseFloat(p.agriBalance).toFixed(2));
    setReputationScore(p.reputation.score);
    setJurorStakedBalance(parseFloat(p.stakedBalance).toFixed(0));
    loadNotifications(address);
  };

  // Real-website rule: no anonymous trading. A named account bound to the
  // connected wallet is required before minting or buying; the signup lives
  // in the Account panel and survives refreshes/restarts (backend SQLite).
  // Role is enforced: minting needs FARMER, buying needs BUYER.
  const requireAccount = async (role?: 'FARMER' | 'BUYER'): Promise<boolean> => {
    if (!walletAddress) { addToast('Connect MetaMask first.', 'error'); return false; }
    try {
      const u = await fetch(`${BACKEND_URL}/api/users/${walletAddress}`).then((r) => r.json());
      if (!u?.user?.display_name) {
        addToast('Create your account first (display name + Farmer/Buyer role) — see the Wallet tab.', 'error');
        setCurrentTab('wallet');
        return false;
      }
      if (role && u.user.role !== role) {
        const want = role === 'FARMER' ? 'Farmer login' : 'Buyer login';
        addToast(`This wallet is registered as ${u.user.role}. Minting needs a FARMER account, buying needs a BUYER account — use ${want} with the matching wallet.`, 'error');
        return false;
      }
      return true;
    } catch {
      addToast('Account service unreachable — is the backend running?', 'error');
      return false;
    }
  };

  // Split logins: the chosen door sets the interface AND checks the wallet's
  // registered role. A farmer wallet at the buyer door (or vice versa) is
  // turned away with an explanation instead of failing later on-chain.
  const handleConnectWallet = async (asRole?: 'farmer' | 'buyer') => {
    try {
      setConnecting(true);
      const { address } = await connectWallet();
      const want = asRole ? asRole.toUpperCase() : null;
      if (want) {
        try {
          const u = await fetch(`${BACKEND_URL}/api/users/${address}`).then((r) => r.json());
          if (u?.user?.display_name && u.user.role !== want) {
            addToast(`That wallet is registered as ${u.user.role}. Use ${want === 'FARMER' ? 'Buyer' : 'Farmer'} login for it, or connect the matching wallet.`, 'error');
            return;
          }
        } catch { /* backend down: allow connect, actions will gate later */ }
        changeViewMode(asRole!);
      }
      setWalletAddress(address);
      rememberWallet(address);
      await loadProfile(address);
      addToast(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`, 'success');
    } catch (e: any) {
      // NEVER fake a connection: without MetaMask there is no signer, so no on-chain tx is possible.
      addToast(e?.message || 'MetaMask required. Install MetaMask and connect to Hardhat Local (31337).', 'error');
    } finally {
      setConnecting(false);
    }
  };

  const handleSwitchNetwork = async () => {
    try {
      await switchToSupportedNetwork();
      addToast('Network switched to Hardhat Local', 'success');
      if (walletAddress) await loadProfile(walletAddress);
    } catch (err: any) {
      addToast(err?.message || 'Network switch rejected', 'error');
    }
  };

  const handleDisconnect = () => {
    setWalletAddress(null);
    setWalletProfile(null);
    rememberWallet(null);
    addToast('Wallet disconnected', 'info');
  };

  // React to MetaMask account / chain changes
  useEffect(() => {
    const eth = getInjectedProvider();
    if (!eth?.on) return;
    const onAccounts = (accs: string[]) => {
      if (!accs.length) return handleDisconnect();
      setWalletAddress(accs[0]);
      rememberWallet(accs[0]);
      loadProfile(accs[0]);
    };
    const onChain = () => { if (walletAddress) loadProfile(walletAddress); };
    eth.on('accountsChanged', onAccounts);
    eth.on('chainChanged', onChain);
    return () => { eth.removeListener?.('accountsChanged', onAccounts); eth.removeListener?.('chainChanged', onChain); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  // TEST/DEMO faucet — real AgriToken.faucet() on local chain (1,000 AGRI, 12h cooldown)
  const handleClaimFaucet = async () => {
    try {
      setIsFauceting(true);
      await runTx('Get Test AgriTokens (faucet)', (c) => c.agri.faucet(), setTx);
      if (walletAddress) await loadProfile(walletAddress);
      addToast('1,000 TEST AGRI dispensed on-chain!', 'success');
    } catch (e: any) {
      addToast(parseTxError(e), 'error');
    } finally {
      setIsFauceting(false);
    }
  };

  const indexOrderBackend = (order: any) => {
    queueIndexWrite(`${BACKEND_URL}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(order) }).catch(() => {});
  };

  const marketIface = () => new ethers.Interface(AGRI_MARKETPLACE_ABI);
  const c_market_iface = () => marketIface();
  const nftIface = () => new ethers.Interface(CROP_BATCH_NFT_ABI);

  // BUYER: approve AgriToken then placeOrder — escrow locks tokens on-chain.
  // Order ID is parsed from the OrderPlaced event, never guessed from local array length.
  const handleBuyListing = async (listing: any, quantity: number) => {
    try {
      if (!walletAddress) { addToast('Connect MetaMask first — purchase requires a real signer.', 'error'); return; }
      if (!(await requireAccount('BUYER'))) return;
      const totalWei = BigInt(listing.price_per_unit) * BigInt(quantity);
      await runTx('Approve AgriToken for escrow', (c) => c.agri.approve(CONTRACT_ADDRESSES.AgriMarketplace, totalWei), setTx);
      let onchainOrderId: number | null = null;
      const receipt = await runTx('Deposit escrow (placeOrder)', async (c) => {
        const res = await c.market.placeOrder(BigInt(listing.listing_id), BigInt(quantity));
        return res;
      }, setTx);
      try {
        for (const log of receipt.logs) {
          try {
            const parsed = (c_market_iface()).parseLog(log);
            if (parsed && parsed.name === 'OrderPlaced') { onchainOrderId = Number(parsed.args[0]); break; }
          } catch { /* not our event */ }
        }
      } catch { /* ignore parse errors */ }
      if (onchainOrderId === null) {
        // Fallback: read backend indexer after refresh; do not invent an ID.
        await refreshData();
        addToast('Escrow locked on-chain. Order ID refresh from indexer — see orders list.', 'success');
        if (walletAddress) await loadProfile(walletAddress);
        return;
      }
      const txHash = (receipt as any)?.hash || null;
      const newOrder = { order_id: onchainOrderId, listing_id: listing.listing_id, token_id: listing.token_id, buyer_address: walletAddress, farmer_address: listing.farmer_address, quantity, total_amount: totalWei.toString(), platform_fee: (totalWei * 200n / 10000n).toString(), status: 'PLACED', placed_at: Math.floor(Date.now() / 1000), shipped_at: 0, delivered_at: 0, tx_hash: txHash };
      setOrders((prev) => [newOrder, ...prev]);
      indexOrderBackend(newOrder);
      if (walletAddress) {
        await loadProfile(walletAddress);
        await loadNotifications(walletAddress);
      }
      addToast(`Escrow locked on-chain for Order #${onchainOrderId}.`, 'success');
    } catch (e: any) {
      addToast(parseTxError(e), 'error');
    }
  };

  // BUYER: confirm physical receipt. Starts the 3-day freshness/auto-release clock.
  // Inspect the opened box first — disputes stay possible until funds release.
  const handleMarkReceived = async (orderId: number) => {
    try {
      const receipt = await runTx(`Mark received #${orderId} (start freshness clock)`, (c) => c.market.markReceived(BigInt(orderId)), setTx);
      const txHash = (receipt as any)?.hash || null;
      setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, status: 'RECEIVED', received_at: Math.floor(Date.now() / 1000), tx_hash: txHash } : o)));
      queueIndexWrite(`${BACKEND_URL}/api/orders/${orderId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RECEIVED', txHash }) }).catch(() => {});
      if (walletAddress) {
        await loadProfile(walletAddress);
        await loadNotifications(walletAddress);
      }
      addToast(`Receipt confirmed on-chain for Order #${orderId}. Freshness clock running — confirm or dispute within 3 days.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  const handleConfirmDelivery = async (orderId: number) => {    try {
      const checkpointResponse = await fetch(`${BACKEND_URL}/api/checkpoints/${orderId}`);
      const checkpointData = await checkpointResponse.json();
      if (!checkpointResponse.ok || !checkpointData?.success) throw new Error('Could not load checkpoint proof for this order.');
      const deliveryCheckpoint = (checkpointData.checkpoints || []).find((cp: any) => /deliver/i.test(String(cp.status_note || '')));
      if (!deliveryCheckpoint?.leaf_hash || !Array.isArray(deliveryCheckpoint.proof)) {
        throw new Error('No delivery checkpoint inclusion proof is available. Ask the logistics role to commit the shipment checkpoints first.');
      }
      const receipt = await runTx(`Confirm delivery #${orderId} with checkpoint proof`, (c) => c.market.confirmDelivery(BigInt(orderId), deliveryCheckpoint.leaf_hash, deliveryCheckpoint.proof), setTx);
      const txHash = (receipt as any)?.hash || null;
      setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, status: 'DELIVERED', delivered_at: Math.floor(Date.now() / 1000), tx_hash: txHash } : o)));
      queueIndexWrite(`${BACKEND_URL}/api/orders/${orderId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED', txHash }) }).catch(() => {});
      if (walletAddress) {
        await loadProfile(walletAddress);
        await loadNotifications(walletAddress);
      }
      addToast(`Delivery confirmed on-chain for Order #${orderId}.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // DISPUTE: buyer uploads an unboxing photo; its SHA-256 becomes the on-chain
  // evidenceHash (bound to exact bytes jurors inspect), escrow freezes atomically.
  const handleRaiseDispute = async (orderId: number, evidence?: { claim: string; file: File }) => {
    try {
      if (!walletAddress) { addToast('Connect MetaMask first.', 'error'); return; }
      if (!evidence?.file || !evidence?.claim?.trim()) {
        addToast('A claim description and an unboxing photo are required to open a dispute.', 'error');
        return;
      }
      addToast('Uploading unboxing evidence…', 'info');
      const up = new FormData();
      up.append('photo', evidence.file);
      const upRes = await fetch(`${BACKEND_URL}/api/disputes/evidence`, { method: 'POST', body: up });
      const upData = await upRes.json();
      if (!upRes.ok || !upData?.evidenceHash) throw new Error(upData?.error || 'Evidence upload failed.');
      const reasonHash: string = upData.evidenceHash;
      const evidenceUrl: string = upData.url;
      const order = orders.find((o) => o.order_id === orderId);
      const oracleNode = order?.oracle_node || order?.oracleNode || ethers.ZeroAddress;
      const disputeReceipt = await runTx(`Freeze escrow and open DAO case #${orderId}`, (c) =>
        c.market.raiseDispute(BigInt(orderId), reasonHash, oracleNode), setTx);
      let newDisputeId: number | null = null;
      try {
        const daoIface = new ethers.Interface(['event DisputeOpened(uint256 indexed disputeId, uint256 indexed orderId, address buyer, address farmer, bytes32 evidenceHash, uint256 votingEndsAt)']);
        for (const log of disputeReceipt.logs) {
          try { const p = daoIface.parseLog(log); if (p && p.name === 'DisputeOpened') { newDisputeId = Number(p.args[0]); break; } } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, status: 'DISPUTED' } : o)));
      queueIndexWrite(`${BACKEND_URL}/api/orders/${orderId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DISPUTED', disputeReasonHash: reasonHash }) }).catch(() => {});
      if (newDisputeId !== null) {
        queueIndexWrite(`${BACKEND_URL}/api/disputes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disputeId: newDisputeId, orderId, buyerAddress: order?.buyer_address || walletAddress, farmerAddress: order?.farmer_address || ethers.ZeroAddress, oracleNode, evidenceHash: reasonHash, evidenceUrl, claimText: evidence.claim }) }).catch(() => {});
      }
      refreshData();
      addToast(`Unboxing photo hashed on-chain and DAO case opened for Order #${orderId}${newDisputeId !== null ? ` (case #${newDisputeId})` : ''}. Escrow frozen.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // FARMER: mint CropBatchNFT to farmer wallet, submit AI oracle verification ON-CHAIN,
  // then approve + list (escrow holds NFT). createListing reverts unless isVerified, so the
  // oracle step is mandatory — it is not optional UI polish.
  // NOTE: mintBatch needs MINTER_ROLE — deployer (Account #0) has it; other farmers must be granted by admin first.
  const handleMintAndList = async (batchData: any) => {
    try {
      if (!walletAddress) { addToast('Connect MetaMask first — minting requires a real signer.', 'error'); return; }
      if (!(await requireAccount('FARMER'))) return;
      if (batchData?.isFallback || !batchData?.imageFile) {
        addToast('AI service unavailable or inspection image missing. Cannot create a verified listing.', 'error');
        return;
      }
      const farmer = walletAddress;
      const currentBatches = await readContracts(readOnlyProvider()).nft.totalBatches();
      const predictedTokenId = BigInt(currentBatches) + 1n;
      const signImageReport = async (tokenId: bigint) => {
        const form = new FormData();
        form.append('image', batchData.imageFile);
        form.append('tokenId', tokenId.toString());
        form.append('cropType', batchData.cropType);
        form.append('chainId', String(SUPPORTED_CHAIN_ID));
        form.append('registryAddress', CONTRACT_ADDRESSES.OracleRegistry);
        const response = await fetch(`${BACKEND_URL}/api/ai/verify`, { method: 'POST', body: form });
        const report = await response.json();
        if (!response.ok || !report?.signature || !report?.reportHash) {
          throw new Error(report?.error || report?.detail || 'AI oracle verification failed; batch was not minted.');
        }
        return report;
      };
      // Sign against the next token before minting, so service/oracle setup
      // failures do not leave an unverified NFT in the farmer wallet.
      let verified = await signImageReport(predictedTokenId);
      const metadata = {
        name: `${batchData.cropType} crop batch`,
        description: 'AgriChain batch metadata. Inspection image is identified by SHA-256; bytes are held off-chain by the farmer.',
        imageHash: verified.report?.imageHash || batchData.imageHash || 'pending inspection',
        qualityGrade: verified.gradeName,
        confidenceScore: verified.confidenceScore,
        reportHash: verified.reportHash,
        farmer,
        cropType: batchData.cropType,
        quantity: batchData.quantity,
        unit: batchData.unit,
      };
      const uri = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(metadata))))}`;
      // 1. Mint — parse real tokenId from BatchMinted event, never guess.
      // Farmer approval 1 of 4. Gas on local Hardhat is valueless test ETH.
      let mintedTokenId: bigint | null = null;
      const mintReceipt = await runTx('Step 1/4: Mint CropBatchNFT (farmer custody)', async (c) => {
        const res = await (c.nft as any).mintBatch(farmer, uri, batchData.cropType, BigInt(batchData.quantity), batchData.unit, BigInt(Math.floor(Date.now() / 1000)), batchData.farmLocation, batchData.imageHash || 'pending-inspection');
        return res;
      }, setTx);
      try {
        for (const log of mintReceipt.logs) {
          try {
            const parsed = nftIface().parseLog(log);
            if (parsed && parsed.name === 'BatchMinted') { mintedTokenId = BigInt(parsed.args[0].toString()); break; }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (mintedTokenId === null) { addToast('Mint confirmed but tokenId event not found. Refresh and retry listing.', 'error'); return; }
      if (mintedTokenId !== predictedTokenId) {
        addToast(`Minted batch ID differed from preview; requesting signature for actual token #${mintedTokenId}.`, 'info');
        verified = await signImageReport(mintedTokenId);
      }
      addToast(`Step 1/4 done: CropBatchNFT #${mintedTokenId} minted. Step 2/4: submitting its signed AI result…`, 'info');
      // Oracle verification ON-CHAIN (anyone can relay the signed report).
      await runTx(`Step 2/4: Oracle verify batch #${mintedTokenId}`, (c) =>
        (c.oracle as any).submitVerification(mintedTokenId, Number(verified.grade), Number(verified.confidenceScore), verified.reportHash, verified.signature), setTx);
      addToast('Step 2/4 done: AI grade verified on-chain. Step 3/4 approve + Step 4/4 list: confirm next 2 MetaMask prompts.', 'info');
      const priceWei = ethers.parseEther(String(batchData.pricePerUnit));
      await runTx('Step 3/4: Approve NFT to marketplace', (c) => (c.nft as any).approve(CONTRACT_ADDRESSES.AgriMarketplace, mintedTokenId), setTx);
      let newListingId: number | null = null;
      const listReceipt = await runTx('Step 4/4: Create listing (escrow NFT)', (c) => c.market.createListing(mintedTokenId, priceWei, Number(batchData.grade) || 1), setTx);
      try {
        for (const log of listReceipt.logs) {
          try {
            const parsed = marketIface().parseLog(log);
            if (parsed && parsed.name === 'ListingCreated') { newListingId = Number(parsed.args[0]); break; }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (newListingId === null) { await refreshData(); addToast('Listed on-chain. ID refresh from indexer.', 'success'); return; }
      const gradeNum = Number(verified.grade);
      const newListing = { listingId: newListingId, tokenId: Number(mintedTokenId), farmerAddress: farmer, cropType: batchData.cropType, pricePerUnit: priceWei.toString(), availableQuantity: batchData.quantity, unit: batchData.unit, qualityGrade: gradeNum, gradeName: verified.gradeName, confidenceScore: verified.confidenceScore, imageCID: verified.report?.imageHash, metadataCID: uri };
      // Index with the actual inspection photo so the catalog shows what was
      // graded (falls back to hash-only row if the upload fails).
      try {
        if (batchData.imageFile instanceof File) {
          const form = new FormData();
          for (const [k, v] of Object.entries(newListing)) form.append(k, String(v));
          form.append('photo', batchData.imageFile, batchData.imageFile.name || 'crop.jpg');
          const r = await fetch(`${BACKEND_URL}/api/listings`, { method: 'POST', body: form });
          if (!r.ok) throw new Error(`indexer ${r.status}`);
        } else {
          throw new Error('no photo file');
        }
      } catch {
        await queueIndexWrite(`${BACKEND_URL}/api/listings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newListing) }).catch(() => null);
      }
      if (Array.isArray(batchData.ecoPractices) && batchData.ecoPractices.length > 0) {
        queueIndexWrite(`${BACKEND_URL}/api/sustainability`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId: Number(mintedTokenId), farmerAddress: farmer, practices: batchData.ecoPractices }) }).catch(() => null);
      }
      await refreshData();
      addToast(`CropBatchNFT #${mintedTokenId} verified + listed on-chain as Listing #${newListingId}!`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // Admin-only guard: Ganache strips revert data, so a non-admin signer gets a
  // cryptic "missing revert data" instead of AccessControl errors. Check first,
  // explain clearly, and never send the doomed transaction.
  const requireContractAdmin = async (contractAddress: string, label: string): Promise<boolean> => {
    if (!walletAddress) { addToast('Connect MetaMask first.', 'error'); return false; }
    try {
      const checker = new ethers.Contract(contractAddress, ACCESS_CONTROL_ABI, readOnlyProvider());
      const ok: boolean = await checker.hasRole(await checker.DEFAULT_ADMIN_ROLE(), walletAddress);
      if (!ok) {
        addToast(`${label} needs the admin wallet — switch MetaMask to the deployer account instead of ${walletAddress.slice(0, 10)}…`, 'error');
        return false;
      }
      return true;
    } catch {
      return true; // check itself failed: let the tx surface the real error
    }
  };

  // Admin helper: grant MINTER_ROLE so a farmer wallet can mint (dev only)
  const handleGrantMinter = async (farmerAddr: string) => {
    try {
      if (!(await requireContractAdmin(CONTRACT_ADDRESSES.CropBatchNFT, 'Grant MINTER_ROLE'))) return;
      await runTx(`Grant MINTER_ROLE to ${farmerAddr.slice(0, 8)}…`, (c) => (c.nft as any).grantRole(MINTER_ROLE_HASH, farmerAddr), setTx);
      addToast('MINTER_ROLE granted on-chain.', 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  const handleShipOrder = async (orderId: number) => {
    try {
      const receipt = await runTx(`Ship order #${orderId}`, (c) => c.market.shipOrder(BigInt(orderId)), setTx);
      const txHash = (receipt as any)?.hash || null;
      setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, status: 'SHIPPED', shipped_at: Math.floor(Date.now() / 1000), tx_hash: txHash } : o)));
      queueIndexWrite(`${BACKEND_URL}/api/orders/${orderId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SHIPPED', txHash }) }).catch(() => {});
      if (walletAddress) {
        await loadProfile(walletAddress);
        await loadNotifications(walletAddress);
      }
      addToast(`Order #${orderId} shipped on-chain.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // ORACLE bond: approve AGRI then stakeBond on-chain (registry holds liquid bond).
  const handleStakeOracleBond = async (amount: string) => {
    try {
      const wei = ethers.parseEther(String(amount));
      await runTx('Approve AGRI for oracle bond', (c) => c.agri.approve(CONTRACT_ADDRESSES.OracleRegistry, wei), setTx);
      await runTx(`Stake oracle bond (${amount} AGRI)`, (c) => c.oracle.stakeBond(wei), setTx);
      if (walletAddress) await loadProfile(walletAddress);
      addToast(`Oracle bond staked on-chain: ${amount} TEST AGRI.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // JUROR stake: real AgriToken.stake / unstake (votingPower = staked balance).
  const handleStakeJuror = async (amount: string) => {
    try {
      const wei = ethers.parseEther(String(amount));
      await runTx(`Stake ${amount} AGRI for jury weight`, (c) => c.agri.stake(wei), setTx);
      if (walletAddress) await loadProfile(walletAddress);
      addToast(`Staked on-chain: ${amount} TEST AGRI jury weight.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };
  const handleUnstakeJuror = async (amount: string) => {
    try {
      const wei = ethers.parseEther(String(amount));
      await runTx(`Unstake ${amount} AGRI`, (c) => c.agri.unstake(wei), setTx);
      if (walletAddress) await loadProfile(walletAddress);
      addToast(`Unstaked on-chain: ${amount} AGRI.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // ADMIN: real whitelistOracle call (requires DEFAULT_ADMIN_ROLE).
  const handleWhitelistOracle = async (oracleAddr: string) => {
    try {
      if (!(await requireContractAdmin(CONTRACT_ADDRESSES.OracleRegistry, 'Whitelist oracle'))) return;
      await runTx(`Whitelist oracle ${oracleAddr.slice(0, 8)}…`, (c) => c.oracle.whitelistOracle(oracleAddr), setTx);
      addToast('Oracle whitelisted on-chain.', 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  const handleGrantLogistics = async (account: string) => {
    try {
      if (!(await requireContractAdmin(CONTRACT_ADDRESSES.SupplyChainTracker, 'Grant shipment logging role'))) return;
      await runTx(`Grant shipment logging to ${account.slice(0, 8)}…`, async (c) => {
        const role = await c.tracker.LOGISTICS_ROLE();
        return c.tracker.grantRole(role, account);
      }, setTx);
      addToast('LOGISTICS_ROLE granted on-chain.', 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // SHIPMENT: build off-chain Merkle batch via backend, then commit root ON-CHAIN.
  const handleCommitCheckpoints = async (orderId: number, checkpoints: Array<{ location: string; timestamp?: number; temperature?: number; statusNote?: string; latitude?: string; longitude?: string; weatherTemp?: number }>, submittedBy?: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/checkpoints`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, checkpoints, submittedBy: submittedBy || walletAddress || '0x0' }) });
      const data = await res.json();
      if (!data?.success || !data?.merkleRoot) throw new Error('Backend checkpoint batching failed.');
      await runTx(`Commit transit root for order #${orderId}`, (c) => c.tracker.submitCheckpointRoot(BigInt(orderId), data.merkleRoot, data.ipfsCID || ''), setTx);
      const indexed = await fetch(`${BACKEND_URL}/api/checkpoints/${orderId}`).then((r) => r.json());
      const deliveryCheckpoint = (indexed.checkpoints || []).find((cp: any) => /deliver/i.test(String(cp.status_note || cp.statusNote || '')));
      if (deliveryCheckpoint?.leaf_hash && Array.isArray(deliveryCheckpoint.proof)) {
        await runTx(`Register delivery checkpoint for order #${orderId}`, (c) => (c.tracker as any).submitDeliveryCheckpoint(BigInt(orderId), deliveryCheckpoint.leaf_hash, deliveryCheckpoint.proof), setTx);
        addToast(`Transit root and logistics-designated delivery proof committed for Order #${orderId}.`, 'success');
      } else {
        addToast(`Transit root committed for Order #${orderId}; no delivery checkpoint was designated. Escrow will remain locked.`, 'info');
      }
      return data;
    } catch (e: any) { addToast(parseTxError(e), 'error'); throw e; }
  };

  // Verify a checkpoint leaf against the on-chain root (read-only static call).
  const handleVerifyProofOnChain = async (orderId: number, leaf: string, proof: string[]): Promise<boolean> => {
    try {
      const eth = getInjectedProvider();
      const provider = eth ? new ethers.BrowserProvider(eth) : new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      const contracts = readContracts(provider);
      const ok: boolean = await (contracts.tracker as any).verifyCheckpoint.staticCall(BigInt(orderId), leaf, proof);
      return Boolean(ok);
    } catch {
      return false;
    }
  };

  const handleReadChainProof = async (orderId: number): Promise<{ merkleRoot: string; deliveryLeaf: string }> => {
    const contracts = readContracts(readOnlyProvider());
    const [merkleRoot, deliveryLeaf] = await Promise.all([
      (contracts.tracker as any).orderCheckpointRoots(BigInt(orderId)),
      (contracts.tracker as any).deliveryCheckpointLeaves(BigInt(orderId)),
    ]);
    return { merkleRoot: String(merkleRoot), deliveryLeaf: String(deliveryLeaf) };
  };
  // JUROR: vote weight = AgriToken.votingPower (must stake first via stake UI in JurorDashboard).
  // NOTE: contract counts weight at vote time; unstaking afterwards does not revoke the vote
  // (known limitation — see audit). Do not unstake mid-case if you want weight to remain honest.
  const handleCastVote = async (disputeId: number, choice: number) => {
    try {
      await runTx(`Vote on dispute #${disputeId}`, (c) => c.dao.vote(BigInt(disputeId), Number(choice)), setTx);
      addToast(`Vote recorded on-chain with staked weight.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };
  const handleResolveDispute = async (disputeId: number) => {
    try {
      await runTx(`Resolve dispute #${disputeId}`, (c) => c.dao.resolveDispute(BigInt(disputeId)), setTx);
      refreshData();
      addToast(`Dispute #${disputeId} resolved on-chain.`, 'success');
    } catch (e: any) { addToast(parseTxError(e), 'error'); }
  };

  // Login-first entry: disconnected visitors get the two-door login screen,
  // not the marketplace. Auto-reconnect restores the session silently.
  if (!walletAddress) {
    return (
      <div>
        <Navbar
          currentTab={currentTab}
          setCurrentTab={setCurrentTab}
          viewMode={viewMode}
          setViewMode={changeViewMode}
          walletAddress={walletAddress}
          displayName={null}
          verified={false}
          agriBalance={agriBalance}
          reputationScore={reputationScore}
          cartCount={orders.length}
          networkOk
          roles={[]}
          onConnectWallet={handleConnectWallet}
          onClaimFaucet={handleClaimFaucet}
          isFauceting={isFauceting}
        />
        <section className="ed-app-section">
          <div className="ed-app-inner" style={{ display: 'flex', flexDirection: 'column', gap: '64px' }}>
            <WalletAuth
              profile={null}
              connecting={connecting}
              pendingSession={pendingSession}
              onContinueSession={handleContinueSession}
              onConnectFarmer={() => handleConnectWallet('farmer')}
              onConnectBuyer={() => handleConnectWallet('buyer')}
              onSwitchNetwork={handleSwitchNetwork}
              onRefresh={() => {}}
              onDisconnect={handleDisconnect}
            />
          </div>
        </section>
        <EditorialFooter />
        <div className="toast-container">
          {toasts.map((t) => (<div key={t.id} className="toast"><span>●</span><span>{t.message}</span></div>))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        viewMode={viewMode}
        setViewMode={changeViewMode}
        walletAddress={walletAddress}
        displayName={walletProfile?.account.displayName || null}
        verified={walletProfile?.account.verified || false}
        agriBalance={agriBalance}
        reputationScore={reputationScore}
        cartCount={orders.length}
        unreadNotificationsCount={notifications.filter((n) => n.is_read === 0).length}
        networkOk={walletProfile?.networkOk ?? true}
        roles={walletProfile?.roles ?? []}
        onConnectWallet={handleConnectWallet}
        onClaimFaucet={handleClaimFaucet}
        onOpenNotifications={() => setShowNotifications(true)}
        isFauceting={isFauceting}
      />

      {/* Transaction status is global: visible on every tab, hides when idle */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '16px 24px 0' }}>
        {!online && (
          <div className="glass-panel" style={{ padding: '12px 18px', marginBottom: '12px', borderColor: 'rgba(180,130,20,0.5)' }}>
            <p className="ed-label">Offline — chain actions need a connection. Form drafts are saved on this device; indexer writes retry automatically on reconnect.</p>
          </div>
        )}
        <TxTracker tx={tx} />
      </div>

      {/* HERO — market tab only */}
      {visibleTab === 'marketplace' && (
      <section className="ed-hero ed-hero-clean">
        <div className="hero-copy">
          <p className="hero-eyebrow">Local demo marketplace <span>·</span> Hardhat 31337</p>
          <h1>Good food<br /><em>starts at the farm.</em></h1>
          <p className="hero-description">Explore real fruit quality photos, a locally trained model, on-chain inspection records, and test-token escrow.</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => goTab('marketplace')}>Browse harvests</button>
            <button className="btn btn-secondary" onClick={() => { changeViewMode('farmer'); setCurrentTab('farmer'); window.scrollTo({ top: 0 }); }}>List a crop</button>
          </div>
          <p className="hero-disclaimer">Real FruitNet dataset photos · sample lots and TEST AGRI · no live farm offers</p>
        </div>
        <div className="hero-mosaic" aria-label="Real fruit photos from the FruitNet dataset">
          <figure className="hero-image hero-image-main"><img src="/crop-photos/apple-good.jpg" alt="Real FruitNet apple quality sample photograph" /><figcaption>Apple quality sample <span>FruitNet photo</span></figcaption></figure>
          <figure className="hero-image hero-image-side"><img src="/crop-photos/orange-mixed.jpg" alt="Real FruitNet orange quality sample photograph" /><figcaption>Orange quality sample <span>FruitNet photo</span></figcaption></figure>
          <div className="hero-proof"><strong>{listings.length.toString().padStart(2, '0')}</strong><span>active lots<br />on local chain</span></div>
        </div>
      </section>
      )}

      {/* MARKET TAB */}
      {visibleTab === 'marketplace' && (
      <section className="ed-grid-section">
        <MarketplaceView
          listings={listings}
          orders={orders}
          walletAddress={walletAddress}
          viewMode={viewMode}
          onBuyListing={handleBuyListing}
          onConfirmDelivery={handleConfirmDelivery}
          onMarkReceived={handleMarkReceived}
          onRaiseDispute={handleRaiseDispute}
          onViewCheckpoints={(id) => setSelectedTransitOrderId(id)}
          onRefresh={refreshData}
          onGoSell={() => { changeViewMode('farmer'); setCurrentTab('farmer'); window.scrollTo({ top: 0 }); }}
          onTraceBatch={(id) => setSelectedTraceBatchId(id)}
          onOpenPassport={(id) => setSelectedPassportTokenId(id)}
          onShipOrder={handleShipOrder}
        />
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px 60px' }}>
          <SustainabilityBoard />
        </div>
      </section>
      )}

      {/* APP PANELS — one visible tab at a time, no endless scroll */}
      <section className="ed-app-section">
        <div className="ed-app-inner" style={{ display: 'flex', flexDirection: 'column', gap: '64px' }}>
          {visibleTab === 'wallet' && (
          <>
          <WalletAuth
            profile={walletProfile}
            connecting={connecting}
            pendingSession={pendingSession}
            onContinueSession={handleContinueSession}
            onConnectFarmer={() => handleConnectWallet('farmer')}
            onConnectBuyer={() => handleConnectWallet('buyer')}
            onSwitchNetwork={handleSwitchNetwork}
            onRefresh={() => walletAddress && loadProfile(walletAddress)}
            onDisconnect={handleDisconnect}
          />
          <div id="section-account">
            <AccountPanel profile={walletProfile} walletAddress={walletAddress} suggestedRole={viewMode === 'farmer' ? 'FARMER' : 'BUYER'} onRegistered={() => walletAddress && loadProfile(walletAddress)} onSwitchAccount={() => handleConnectWallet()} onDisconnect={handleDisconnect} switching={connecting} />
          </div>
          </>
          )}
          {visibleTab === 'farmer' && viewMode === 'farmer' && (
          <>
          {walletAddress && walletProfile?.account?.displayName && walletProfile.account.role !== 'FARMER' && (
            <div className="glass-panel" style={{ padding: '14px 18px', borderColor: 'rgba(180,130,20,0.5)' }}>
              <p style={{ fontSize: '0.88rem' }}>
                <strong>Role mismatch:</strong> you're browsing the Farmer view as{' '}
                <strong>{walletProfile.account.displayName}</strong> (registered {walletProfile.account.role}).
                Selling, shipping and dispatch boards need a farmer wallet — switch accounts in MetaMask,
                or <button className="btn btn-secondary btn-sm" style={{ marginLeft: '6px' }} onClick={() => changeViewMode('buyer')}>go to Buyer view</button>
              </p>
            </div>
          )}
          <div className="glass-panel" style={{ padding: '14px 18px' }}>
            <p className="ed-label">Dev-only · TEST/DEMO assets · Local Hardhat 31337 · No real money</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
              <input className="form-input font-mono" style={{ maxWidth: '360px' }} placeholder="Farmer address (0x...)"
                value={minterTarget} onChange={(e) => setMinterTarget(e.target.value)} />
              <button className="btn btn-secondary btn-sm" disabled={!/^0x[a-fA-F0-9]{40}$/.test(minterTarget)}
                onClick={() => handleGrantMinter(minterTarget)}>
                Grant farmer MINTER_ROLE
              </button>
              <span className="ed-meta">Connect the deployer/admin MetaMask account to grant the role to the farmer wallet.</span>
            </div>
          </div>
          <div id="section-farmer">
            <Reveal><p className="ed-label">01 — Sow & List</p></Reveal>
            <Reveal delay={0.08}><FarmerDashboard walletAddress={walletAddress} orders={orders} onMintAndList={handleMintAndList} onShipOrder={handleShipOrder} onTraceBatch={(id) => setSelectedTraceBatchId(id)} /></Reveal>
          </div>
          </>
          )}
          {visibleTab === 'oracle' && (
          <div id="section-oracle">
            <Reveal><p className="ed-label">02 — AI Oracle</p></Reveal>
            <Reveal delay={0.08}>
              <OracleDashboard walletAddress={walletAddress} oracleProfile={walletProfile?.oracle || null} onStakeOracleBond={handleStakeOracleBond} />
            </Reveal>
          </div>
          )}
          {visibleTab === 'juror' && (
          <div id="section-juror">
            <Reveal><p className="ed-label">03 — Dispute DAO</p></Reveal>
            <Reveal delay={0.08}>
              <JurorDashboard
                disputes={disputes} orders={orders} listings={listings} walletAddress={walletAddress} jurorStakedBalance={jurorStakedBalance}
                onStakeJurorTokens={handleStakeJuror}
                onUnstakeJurorTokens={handleUnstakeJuror}
                onCastVote={handleCastVote} onResolveDispute={handleResolveDispute}
              />
            </Reveal>
          </div>
          )}
          {visibleTab === 'admin' && (
          <div id="section-admin">
            <Reveal><p className="ed-label">04 — Governance</p></Reveal>
            <Reveal delay={0.08}>
              <AdminDashboard walletAddress={walletAddress} onWhitelistOracle={handleWhitelistOracle} onGrantLogistics={handleGrantLogistics} />
            </Reveal>
            <SystemPanel />
          </div>
          )}
          {visibleTab === 'shipments' && (
            <ShipmentsView
              orders={orders}
              listings={listings}
              walletAddress={walletAddress}
              isLogistics={(walletProfile?.roles || []).includes('Logistics')}
              onViewCheckpoints={(id) => setSelectedTransitOrderId(id)}
              onShipOrder={handleShipOrder}
            />
          )}
          {visibleTab === 'audit' && (
            <AuditExplorer listings={listings} orders={orders} disputes={disputes} initialQuery={auditQuery} />
          )}
        </div>
      </section>

      <EditorialFooter />

      {selectedTransitOrderId && (
        <TransitModal orderId={selectedTransitOrderId} onClose={() => setSelectedTransitOrderId(null)} onVerifyProofOnChain={handleVerifyProofOnChain} onReadChainProof={handleReadChainProof} onCommitCheckpoints={(cps) => handleCommitCheckpoints(selectedTransitOrderId, cps)} />
      )}

      {selectedTraceBatchId !== null && (
        <BatchTraceabilityModal
          tokenId={selectedTraceBatchId}
          onClose={() => setSelectedTraceBatchId(null)}
          onOpenPassport={(tokId) => setSelectedPassportTokenId(tokId)}
        />
      )}

      {selectedPassportTokenId !== null && (
        <AIQualityPassportModal
          tokenId={selectedPassportTokenId}
          cropType={(listings.find((l) => l.token_id === selectedPassportTokenId) || {}).crop_type || 'Crop'}
          imageURL={(listings.find((l) => l.token_id === selectedPassportTokenId) || {}).image_url}
          walletAddress={walletAddress}
          onClose={() => setSelectedPassportTokenId(null)}
          onReviewSubmitted={() => {
            refreshData();
            addToast('Auditor review recorded.', 'success');
          }}
        />
      )}

      {showNotifications && (
        <NotificationCenterModal
          notifications={notifications}
          walletAddress={walletAddress}
          onClose={() => setShowNotifications(false)}
          onRefreshNotifications={() => loadNotifications(walletAddress)}
          onNavigateLink={(link) => {
            try {
              const url = new URL(link, window.location.origin);
              const inspectParam = url.searchParams.get('inspect');
              if (inspectParam) {
                if (/^batch:(\d+)$/i.test(inspectParam)) {
                  setSelectedTraceBatchId(Number(inspectParam.replace(/^batch:/i, '')));
                }
                setAuditQuery(inspectParam);
                setCurrentTab('audit');
                window.scrollTo({ top: 0 });
              }
            } catch {}
          }}
        />
      )}

      <div className="toast-container">
        {toasts.map((t) => (<div key={t.id} className="toast"><span>●</span><span>{t.message}</span></div>))}
      </div>
    </div>
  );
};
