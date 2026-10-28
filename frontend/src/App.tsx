import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Navbar } from './components/Navbar';
import { MarketplaceView } from './components/MarketplaceView';
import { FarmerDashboard } from './components/FarmerDashboard';
import { OracleDashboard } from './components/OracleDashboard';
import { JurorDashboard } from './components/JurorDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { TransitModal } from './components/TransitModal';
import {
  CONTRACT_ADDRESSES,
  AGRI_TOKEN_ABI,
  CROP_BATCH_NFT_ABI,
  REPUTATION_SBT_ABI,
  ORACLE_REGISTRY_ABI,
  AGRI_MARKETPLACE_ABI,
  DISPUTE_DAO_ABI,
} from './contracts';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export const App: React.FC = () => {
  // Navigation
  const [currentTab, setCurrentTab] = useState<string>('marketplace');

  // Web3 & Account State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [agriBalance, setAgriBalance] = useState<string>('10000');
  const [reputationScore, setReputationScore] = useState<number>(100);
  const [jurorStakedBalance, setJurorStakedBalance] = useState<string>('2500');
  const [isFauceting, setIsFauceting] = useState<boolean>(false);

  // Data Collections
  const [listings, setListings] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);

  // Modals & Notifications
  const [selectedTransitOrderId, setSelectedTransitOrderId] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Fetch initial data from backend
  const refreshData = async () => {
    try {
      // 1. Listings
      const listRes = await fetch('http://localhost:5000/api/listings');
      const listData = await listRes.json();
      if (listData.success) {
        setListings(listData.listings);
      }

      // 2. Orders
      const orderRes = await fetch('http://localhost:5000/api/orders');
      const orderData = await orderRes.json();
      if (orderData.success) {
        setOrders(orderData.orders);
      }

      // 3. Disputes
      const dispRes = await fetch('http://localhost:5000/api/disputes');
      const dispData = await dispRes.json();
      if (dispData.success) {
        setDisputes(dispData.disputes);
      }
    } catch (err) {
      console.warn('Backend currently offline or starting up, using local state.');
    }
  };

  useEffect(() => {
    // Initial sample fallback data
    setListings([
      {
        listing_id: 1,
        token_id: 1,
        farmer_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        crop_type: 'Basmati Rice (Superfine)',
        price_per_unit: '2000000000000000000', // 2.0 AGRI
        available_quantity: 5000,
        unit: 'kg',
        quality_grade: 1,
        grade_name: 'GRADE_A',
        confidence_score: 9780,
        image_cid: 'QmSampleBasmati',
        metadata_cid: 'ipfs://bafybeirice',
        status: 'ACTIVE',
        created_at: Math.floor(Date.now() / 1000) - 3600,
      },
      {
        listing_id: 2,
        token_id: 2,
        farmer_address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        crop_type: 'Himachal Organic Apples',
        price_per_unit: '3500000000000000000', // 3.5 AGRI
        available_quantity: 1200,
        unit: 'kg',
        quality_grade: 1,
        grade_name: 'GRADE_A',
        confidence_score: 9650,
        image_cid: 'QmSampleApples',
        metadata_cid: 'ipfs://bafybeiapples',
        status: 'ACTIVE',
        created_at: Math.floor(Date.now() / 1000) - 7200,
      },
      {
        listing_id: 3,
        token_id: 3,
        farmer_address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
        crop_type: 'Durum Wheat Granules',
        price_per_unit: '1800000000000000000', // 1.8 AGRI
        available_quantity: 8000,
        unit: 'kg',
        quality_grade: 2,
        grade_name: 'GRADE_B',
        confidence_score: 9140,
        image_cid: 'QmSampleWheat',
        metadata_cid: 'ipfs://bafybeiwheat',
        status: 'ACTIVE',
        created_at: Math.floor(Date.now() / 1000) - 10800,
      }
    ]);

    setOrders([
      {
        order_id: 1,
        listing_id: 1,
        token_id: 1,
        buyer_address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        farmer_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        quantity: 2500,
        total_amount: '5000000000000000000000',
        platform_fee: '100000000000000000000',
        status: 'SHIPPED',
        placed_at: Math.floor(Date.now() / 1000) - 86400,
        shipped_at: Math.floor(Date.now() / 1000) - 43200,
        delivered_at: 0,
      }
    ]);

    refreshData();
  }, []);

  // Connect wallet
  const handleConnectWallet = async () => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const provider = new ethers.BrowserProvider((window as any).ethereum);
        const accounts = await provider.send('eth_requestAccounts', []);
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          addToast(`Wallet connected: ${accounts[0].slice(0, 6)}...${accounts[0].slice(-4)}`, 'success');
        }
      } catch (err) {
        addToast('MetaMask rejected connection, using local demo wallet', 'info');
        setWalletAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      }
    } else {
      // Demo simulated account
      setWalletAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
      addToast('Simulated Web3 Account Connected (Hardhat Local / Amoy)', 'success');
    }
  };

  // Claim Faucet
  const handleClaimFaucet = async () => {
    try {
      setIsFauceting(true);
      setAgriBalance((prev) => (parseFloat(prev) + 1000).toString());
      addToast('1,000 AGRI tokens dispensed to your wallet!', 'success');
    } finally {
      setIsFauceting(false);
    }
  };

  // Buy & Escrow
  const handleBuyListing = async (listing: any, quantity: number) => {
    const totalCostAgri = (parseFloat(listing.price_per_unit) / 1e18) * quantity;
    const newOrderId = orders.length + 1;

    const newOrder = {
      order_id: newOrderId,
      listing_id: listing.listing_id,
      token_id: listing.token_id,
      buyer_address: walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      farmer_address: listing.farmer_address,
      quantity,
      total_amount: (totalCostAgri * 1e18).toString(),
      platform_fee: ((totalCostAgri * 0.02) * 1e18).toString(),
      status: 'PLACED',
      placed_at: Math.floor(Date.now() / 1000),
      shipped_at: 0,
      delivered_at: 0,
    };

    setOrders((prev) => [newOrder, ...prev]);
    setAgriBalance((prev) => Math.max(0, parseFloat(prev) - totalCostAgri).toFixed(2));
    addToast(`Order #${newOrderId} placed! ${totalCostAgri.toFixed(2)} AGRI locked in smart contract escrow.`, 'success');

    // Post to backend indexer
    fetch('http://localhost:5000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder),
    }).catch(() => {});
  };

  // Confirm Delivery
  const handleConfirmDelivery = async (orderId: number) => {
    setOrders((prev) =>
      prev.map((o) => (o.order_id === orderId ? { ...o, status: 'DELIVERED' } : o))
    );
    setReputationScore((prev) => prev + 10);
    addToast(`Delivery confirmed for Order #${orderId}! Escrow funds released to farmer. Reputation boosted +10.`, 'success');

    fetch(`http://localhost:5000/api/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'DELIVERED' }),
    }).catch(() => {});
  };

  // Raise Dispute
  const handleRaiseDispute = (orderId: number) => {
    const reasonHash = '0x' + Array(64).fill('e').join('');
    setOrders((prev) =>
      prev.map((o) => (o.order_id === orderId ? { ...o, status: 'DISPUTED' } : o))
    );

    const newDispute = {
      dispute_id: disputes.length + 1,
      order_id: orderId,
      buyer_address: walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      farmer_address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      oracle_node: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      evidence_hash: reasonHash,
      verdict: 'PENDING',
      is_resolved: 0,
    };

    setDisputes((prev) => [newDispute, ...prev]);
    addToast(`Escrow frozen! Dispute raised on Order #${orderId} and escalated to DisputeDAO.`, 'error');

    fetch('http://localhost:5000/api/disputes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newDispute),
    }).catch(() => {});
  };

  // Farmer: Mint and list
  const handleMintAndList = async (batchData: any) => {
    const newListingId = listings.length + 1;
    const newListing = {
      listing_id: newListingId,
      token_id: newListingId,
      farmer_address: walletAddress || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      crop_type: batchData.cropType,
      price_per_unit: (parseFloat(batchData.pricePerUnit) * 1e18).toString(),
      available_quantity: batchData.quantity,
      unit: batchData.unit,
      quality_grade: batchData.grade,
      grade_name: batchData.grade === 1 ? 'GRADE_A' : 'GRADE_B',
      confidence_score: batchData.confidenceScore,
      image_cid: 'QmHarvestPhoto' + Date.now(),
      metadata_cid: 'ipfs://bafybeih' + Date.now(),
      status: 'ACTIVE',
      created_at: Math.floor(Date.now() / 1000),
    };

    setListings((prev) => [newListing, ...prev]);
    addToast(`CropBatchNFT #${newListingId} minted & listed successfully! AI Grade: ${newListing.grade_name}.`, 'success');

    fetch('http://localhost:5000/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newListing),
    }).catch(() => {});
  };

  // Farmer: Ship Order
  const handleShipOrder = async (orderId: number) => {
    setOrders((prev) =>
      prev.map((o) => (o.order_id === orderId ? { ...o, status: 'SHIPPED' } : o))
    );
    addToast(`Order #${orderId} marked as SHIPPED. Logistics tracking activated.`, 'info');

    fetch(`http://localhost:5000/api/orders/${orderId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SHIPPED' }),
    }).catch(() => {});
  };

  // Juror Voting
  const handleCastVote = async (disputeId: number, choice: number) => {
    addToast(`Vote cast on Dispute #${disputeId}! Recorded with ${jurorStakedBalance} staked weight.`, 'success');
  };

  const handleResolveDispute = async (disputeId: number) => {
    setDisputes((prev) =>
      prev.map((d) => (d.dispute_id === disputeId ? { ...d, is_resolved: 1, verdict: 'REFUND_BUYER' } : d))
    );
    addToast(`Dispute #${disputeId} settled! Escrow refunded to buyer and offending oracle bond slashed.`, 'success');
  };

  return (
    <div>
      {/* Navigation Header */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        walletAddress={walletAddress}
        agriBalance={agriBalance}
        reputationScore={reputationScore}
        onConnectWallet={handleConnectWallet}
        onClaimFaucet={handleClaimFaucet}
        isFauceting={isFauceting}
      />

      {/* Main Role Views */}
      <main style={{ marginTop: '24px' }}>
        {currentTab === 'marketplace' && (
          <MarketplaceView
            listings={listings}
            orders={orders}
            walletAddress={walletAddress}
            onBuyListing={handleBuyListing}
            onConfirmDelivery={handleConfirmDelivery}
            onRaiseDispute={handleRaiseDispute}
            onViewCheckpoints={(id) => setSelectedTransitOrderId(id)}
          />
        )}

        {currentTab === 'farmer' && (
          <FarmerDashboard
            walletAddress={walletAddress}
            orders={orders}
            onMintAndList={handleMintAndList}
            onShipOrder={handleShipOrder}
          />
        )}

        {currentTab === 'oracle' && (
          <OracleDashboard
            walletAddress={walletAddress}
            onStakeOracleBond={async (amt) => {
              addToast(`${amt} AGRI deposited into Oracle Registry bond collateral. Node active!`, 'success');
            }}
          />
        )}

        {currentTab === 'juror' && (
          <JurorDashboard
            disputes={disputes}
            walletAddress={walletAddress}
            jurorStakedBalance={jurorStakedBalance}
            onStakeJurorTokens={async (amt) => {
              setJurorStakedBalance((prev) => (parseFloat(prev) + parseFloat(amt)).toString());
              addToast(`${amt} AGRI staked into DisputeDAO collateral! Voting power boosted.`, 'success');
            }}
            onUnstakeJurorTokens={async (amt) => {
              setJurorStakedBalance((prev) => Math.max(0, parseFloat(prev) - parseFloat(amt)).toString());
              addToast(`${amt} AGRI unstaked.`, 'info');
            }}
            onCastVote={handleCastVote}
            onResolveDispute={handleResolveDispute}
          />
        )}

        {currentTab === 'admin' && (
          <AdminDashboard
            walletAddress={walletAddress}
            onWhitelistOracle={async (addr) => {
              addToast(`Oracle candidate ${addr.slice(0, 8)}... successfully whitelisted on-chain!`, 'success');
            }}
          />
        )}
      </main>

      {/* Merkle Transit Checkpoint Modal */}
      {selectedTransitOrderId && (
        <TransitModal
          orderId={selectedTransitOrderId}
          onClose={() => setSelectedTransitOrderId(null)}
        />
      )}

      {/* Toast Notification Container */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast"
            style={{
              borderColor:
                toast.type === 'success' ? 'rgba(16, 185, 129, 0.4)' :
                toast.type === 'error' ? 'rgba(244, 63, 94, 0.4)' : 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <span style={{ color: toast.type === 'success' ? 'var(--primary)' : toast.type === 'error' ? '#fb7185' : '#fff' }}>
              ●
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
