import { ethers } from 'ethers';
import {
  CONTRACT_ADDRESSES,
  AGRI_TOKEN_ABI,
  REPUTATION_SBT_ABI,
  ORACLE_REGISTRY_ABI,
  BACKEND_URL,
  SUPPORTED_CHAIN_ID,
  SUPPORTED_NETWORKS,
  ERC721_BALANCE_ABI,
  ACCESS_CONTROL_ABI,
} from '../contracts';

export type WalletRole = 'Farmer' | 'Buyer' | 'Logistics' | 'Oracle' | 'Juror' | 'Admin';

export interface WalletProfile {
  address: string;
  chainId: number;
  networkOk: boolean;
  ethBalance: string;
  agriBalance: string;
  stakedBalance: string;
  nftCount: number;
  reputation: { score: number; trades: number; won: number; lost: number; backendRole: string };
  account: { displayName: string | null; verified: boolean; location: string | null; contact: string | null; role: string };
  txCount: number;
  roles: WalletRole[];
  oracle: { whitelisted: boolean; active: boolean; staked: string };
  history: { orders: any[]; disputes: any[] };
}

export function getInjectedProvider(): any | null {
  if (typeof window !== 'undefined' && (window as any).ethereum) return (window as any).ethereum;
  return null;
}

const LAST_WALLET_KEY = 'agrichain:lastWallet';
const AUTH_TOKEN_KEY = 'agrichain:authToken';

export function getAuthToken(): string | null {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

export function setAuthToken(token: string | null) {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch { /* private mode */ }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Silent or active SIWE authentication with backend */
export async function signInWithEthereum(provider: ethers.BrowserProvider, address: string): Promise<string | null> {
  try {
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    const domain = window.location.host || 'localhost:3000';
    const uri = window.location.origin || 'http://localhost:3000';

    const nonceRes = await fetch(`${BACKEND_URL}/api/auth/nonce?address=${encodeURIComponent(address)}`).then((r) => r.json());
    if (!nonceRes?.success || !nonceRes?.nonce) return null;

    const message = `${domain} wants you to sign in with your Ethereum account:\n${ethers.getAddress(address)}\n\nSign in to AgriChain decentralized marketplace.\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonceRes.nonce}\nIssued At: ${nonceRes.issuedAt}`;

    const signer = await provider.getSigner();
    const signature = await signer.signMessage(message);

    const verifyRes = await fetch(`${BACKEND_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature, address, chainId, domain })
    }).then((r) => r.json());

    if (verifyRes?.success && verifyRes?.token) {
      setAuthToken(verifyRes.token);
      return verifyRes.token;
    }
    return null;
  } catch (err) {
    console.warn('SIWE login skipped or cancelled:', err);
    return null;
  }
}

export function rememberWallet(address: string | null) {
  try {
    if (address) localStorage.setItem(LAST_WALLET_KEY, address);
    else {
      localStorage.removeItem(LAST_WALLET_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch { /* private mode: session-only */ }
}

export function lastWallet(): string | null {
  try { return localStorage.getItem(LAST_WALLET_KEY); } catch { return null; }
}

/** Silent reconnect: no MetaMask popup. Returns null if never connected or access revoked. */
export async function tryAutoConnect(): Promise<{ address: string; chainId: number } | null> {
  const eth = getInjectedProvider();
  const saved = lastWallet();
  if (!eth || !saved) return null;
  try {
    const provider = new ethers.BrowserProvider(eth);
    const accounts: string[] = await provider.send('eth_accounts', []);
    const hit = accounts.find((a) => a.toLowerCase() === saved.toLowerCase());
    if (!hit) return null;
    const net = await provider.getNetwork();
    return { address: hit, chainId: Number(net.chainId) };
  } catch {
    return null;
  }
}

export async function connectWallet(): Promise<{ address: string; chainId: number }> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
  // Force the MetaMask chooser every manual connect: plain eth_requestAccounts
  // returns silently once localhost is authorized, which feels broken.
  try {
    await eth.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  } catch (e: any) {
    if (e?.code === 4001) throw new Error('Wallet rejected the connection in MetaMask.');
    // Wallet without permission API (or other error): fall through to eth_requestAccounts.
  }
  const provider = new ethers.BrowserProvider(eth);
  const accounts: string[] = await provider.send('eth_requestAccounts', []);
  if (!accounts.length) throw new Error('Wallet returned no accounts.');
  const net = await provider.getNetwork();
  return { address: accounts[0], chainId: Number(net.chainId) };
}

export async function switchToSupportedNetwork(targetId: number = SUPPORTED_CHAIN_ID): Promise<number> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error('No wallet to switch network.');
  const cfg = SUPPORTED_NETWORKS[targetId];
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chainIdHex }] });
  } catch (err: any) {
    if (err?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: cfg.chainIdHex, chainName: cfg.chainName, rpcUrls: cfg.rpcUrls, nativeCurrency: cfg.nativeCurrency }],
      });
    } else throw err;
  }
  const provider = new ethers.BrowserProvider(eth);
  const net = await provider.getNetwork();
  return Number(net.chainId);
}

export async function fetchWalletProfile(address: string): Promise<WalletProfile> {
  const eth = getInjectedProvider();
  const fallback: WalletProfile = {
    address, chainId: 0, networkOk: false,
    ethBalance: '0', agriBalance: '0', stakedBalance: '0', nftCount: 0,
    reputation: { score: 0, trades: 0, won: 0, lost: 0, backendRole: 'USER' },
    account: { displayName: null, verified: false, location: null, contact: null, role: 'USER' },
    txCount: 0, roles: [], oracle: { whitelisted: false, active: false, staked: '0' },
    history: { orders: [], disputes: [] },
  };
  try {
    const provider = eth ? new ethers.BrowserProvider(eth) : new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    fallback.chainId = chainId;
    fallback.networkOk = chainId === SUPPORTED_CHAIN_ID;

    try { fallback.ethBalance = ethers.formatEther(await provider.getBalance(address)); } catch {}
    const agri = new ethers.Contract(CONTRACT_ADDRESSES.AgriToken, AGRI_TOKEN_ABI, provider);
    const nft = new ethers.Contract(CONTRACT_ADDRESSES.CropBatchNFT, ERC721_BALANCE_ABI, provider);
    const sbt = new ethers.Contract(CONTRACT_ADDRESSES.ReputationSBT, REPUTATION_SBT_ABI, provider);
    const oracle = new ethers.Contract(CONTRACT_ADDRESSES.OracleRegistry, ORACLE_REGISTRY_ABI, provider);
    const adminCheck = new ethers.Contract(CONTRACT_ADDRESSES.AgriToken, ACCESS_CONTROL_ABI, provider);
    const nftRoles = new ethers.Contract(CONTRACT_ADDRESSES.CropBatchNFT, [
      ...ACCESS_CONTROL_ABI,
      'function MINTER_ROLE() view returns (bytes32)',
    ], provider);
    const trackerRoles = new ethers.Contract(CONTRACT_ADDRESSES.SupplyChainTracker, [
      'function hasRole(bytes32 role, address account) view returns (bool)',
      'function LOGISTICS_ROLE() view returns (bytes32)',
    ], provider);

    try { fallback.agriBalance = ethers.formatEther(await agri.balanceOf(address)); } catch {}
    try { fallback.stakedBalance = ethers.formatEther(await agri.stakedBalanceOf(address)); } catch {}
    try { fallback.nftCount = Number(await nft.balanceOf(address)); } catch {}
    try {
      const [score, trades, won, lost] = await sbt.getReputation(address);
      fallback.reputation.score = Number(score);
      fallback.reputation.trades = Number(trades);
      fallback.reputation.won = Number(won);
      fallback.reputation.lost = Number(lost);
    } catch {}
    try {
      const node = await oracle.oracleNodes(address);
      fallback.oracle = {
        whitelisted: Boolean(node[0] ?? node.isWhitelisted),
        active: Boolean(node[1] ?? node.isActive),
        staked: ethers.formatEther(node[2] ?? node.stakedAmount ?? 0n),
      };
    } catch {}
    try { fallback.txCount = await provider.getTransactionCount(address); } catch {}

    // Backend indexer: account profile, role, trade history
    try {
      const u = await fetch(`${BACKEND_URL}/api/users/${address}`).then((r) => r.json());
      if (u?.user) {
        fallback.reputation.backendRole = u.user.role || 'USER';
        if (!fallback.reputation.score && u.user.reputation_score) fallback.reputation.score = Number(u.user.reputation_score);
        fallback.account = {
          displayName: u.user.display_name || null,
          verified: Number(u.user.verified) === 1,
          location: u.user.location || null,
          contact: u.user.contact || null,
          role: u.user.role || 'USER',
        };
      }
    } catch {}
    let buyerOrders: any[] = [];
    let farmerOrders: any[] = [];
    try {
      const b = await fetch(`${BACKEND_URL}/api/orders?buyer=${address}`).then((r) => r.json());
      if (b?.orders) buyerOrders = b.orders;
      const f = await fetch(`${BACKEND_URL}/api/orders?farmer=${address}`).then((r) => r.json());
      if (f?.orders) farmerOrders = f.orders;
      const d = await fetch(`${BACKEND_URL}/api/disputes`).then((r) => r.json());
      fallback.history.disputes = (d?.disputes || []).filter(
        (x: any) => x.buyer_address?.toLowerCase() === address.toLowerCase() || x.farmer_address?.toLowerCase() === address.toLowerCase()
      );
      fallback.history.orders = [...buyerOrders, ...farmerOrders].slice(0, 20);
    } catch {}

    // Role detection
    const roles = new Set<WalletRole>();
    if (buyerOrders.length > 0) roles.add('Buyer');
    if (farmerOrders.length > 0) roles.add('Farmer');
    try {
      const minterRole: string = await nftRoles.MINTER_ROLE();
      if (await nftRoles.hasRole(minterRole, address)) roles.add('Farmer');
    } catch {}
    try {
      const logisticsRole: string = await trackerRoles.LOGISTICS_ROLE();
      if (await trackerRoles.hasRole(logisticsRole, address)) roles.add('Logistics');
    } catch {}
    if (fallback.oracle.whitelisted || fallback.oracle.active) roles.add('Oracle');
    if (parseFloat(fallback.stakedBalance) >= 1000) roles.add('Juror');
    try {
      const adminRole: string = await adminCheck.DEFAULT_ADMIN_ROLE();
      if (await adminCheck.hasRole(adminRole, address)) roles.add('Admin');
    } catch {}
    // deployer is always admin on localhost
    if (address.toLowerCase() === '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266') roles.add('Admin');
    fallback.roles = [...roles];
    return fallback;
  } catch {
    return fallback;
  }
}
