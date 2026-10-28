import { ethers } from 'ethers';
import {
  CONTRACT_ADDRESSES,
  AGRI_TOKEN_ABI,
  CROP_BATCH_NFT_ABI,
  ORACLE_REGISTRY_ABI,
  AGRI_MARKETPLACE_ABI,
  DISPUTE_DAO_ABI,
  SUPPLY_CHAIN_TRACKER_ABI,
  ERC721_APPROVE_ABI,
  ACCESS_CONTROL_ABI,
  RPC_URL,
  SUPPORTED_CHAIN_ID,
} from '../contracts';
import { getInjectedProvider } from './wallet';

export type TxStage = 'idle' | 'waiting' | 'submitted' | 'confirming' | 'confirmed' | 'failed';
export interface TxState { stage: TxStage; label: string; hash: string; error: string; }

export const idleTx: TxState = { stage: 'idle', label: '', hash: '', error: '' };

export function parseTxError(err: any): string {
  const msg = err?.reason || err?.shortMessage || err?.message || 'Transaction failed';
  if (err?.code === 4001 || /rejected/i.test(msg)) return 'Wallet rejected the transaction in MetaMask.';
  if (/insufficient funds|gas/i.test(msg)) return 'Insufficient test ETH for gas. Use Hardhat Account #0 or faucet.';
  if (/insufficient allowance|allowance|approve/i.test(msg)) return 'Token approval missing. Approve AgriToken spending first.';
  if (/FaucetCooldownActive/i.test(msg)) return 'Faucet on 12h cooldown for this wallet. Switch account.';
  if (/AccessControl|missing role|MINTER|OPERATOR/i.test(msg)) return 'Missing on-chain role (e.g. MINTER_ROLE). Ask admin to grant it.';
  if (/VotingPeriodActive/i.test(msg)) return 'Voting period still active (2 days on-chain). Resolve later.';
  if (/ListingNotActive|OrderNot/i.test(msg)) return 'Order/listing is not in the right state for this action.';
  if (/network|chain|chainId/i.test(msg)) return 'Wrong network. Switch to Hardhat Local (31337).';
  if (/no EVM|MetaMask/i.test(msg)) return 'MetaMask unavailable — running in read-only demo mode.';
  // Ganache strips custom-error data on reverts, surfacing as dataless CALL_EXCEPTION.
  // That almost always means wrong account role or wrong order/listing state.
  if (/missing revert data/i.test(msg)) return 'Contract rejected this without a reason — usually the wrong wallet role (admin-only action?) or wrong order state. Check the connected account.';
  const short = String(msg).split('\n')[0];
  return short.length > 220 ? short.slice(0, 220) + '…' : short;
}

export async function getSigner(): Promise<ethers.Signer> {
  const eth = getInjectedProvider();
  if (!eth) throw new Error('MetaMask unavailable — running in read-only demo mode.');
  const provider = new ethers.BrowserProvider(eth);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== SUPPORTED_CHAIN_ID) {
    throw new Error(`Wrong network (${network.chainId}). Switch MetaMask to the configured development/test network ${SUPPORTED_CHAIN_ID}.`);
  }
  return provider.getSigner();
}

export function readContracts(provider: ethers.Provider) {
  return {
    agri: new ethers.Contract(CONTRACT_ADDRESSES.AgriToken, AGRI_TOKEN_ABI, provider),
    nft: new ethers.Contract(CONTRACT_ADDRESSES.CropBatchNFT, [...CROP_BATCH_NFT_ABI, ...ERC721_APPROVE_ABI, ...ACCESS_CONTROL_ABI], provider),
    oracle: new ethers.Contract(CONTRACT_ADDRESSES.OracleRegistry, ORACLE_REGISTRY_ABI, provider),
    market: new ethers.Contract(CONTRACT_ADDRESSES.AgriMarketplace, AGRI_MARKETPLACE_ABI, provider),
    dao: new ethers.Contract(CONTRACT_ADDRESSES.DisputeDAO, DISPUTE_DAO_ABI, provider),
    tracker: new ethers.Contract(CONTRACT_ADDRESSES.SupplyChainTracker, SUPPLY_CHAIN_TRACKER_ABI, provider),
  };
}

export function writeContracts(signer: ethers.Signer) {
  return {
    agri: new ethers.Contract(CONTRACT_ADDRESSES.AgriToken, AGRI_TOKEN_ABI, signer),
    nft: new ethers.Contract(CONTRACT_ADDRESSES.CropBatchNFT, [...CROP_BATCH_NFT_ABI, ...ERC721_APPROVE_ABI, ...ACCESS_CONTROL_ABI], signer),
    oracle: new ethers.Contract(CONTRACT_ADDRESSES.OracleRegistry, ORACLE_REGISTRY_ABI, signer),
    market: new ethers.Contract(CONTRACT_ADDRESSES.AgriMarketplace, AGRI_MARKETPLACE_ABI, signer),
    dao: new ethers.Contract(CONTRACT_ADDRESSES.DisputeDAO, DISPUTE_DAO_ABI, signer),
    tracker: new ethers.Contract(CONTRACT_ADDRESSES.SupplyChainTracker, SUPPLY_CHAIN_TRACKER_ABI, signer),
  };
}

export function readOnlyProvider(): ethers.Provider {
  return new ethers.JsonRpcProvider(RPC_URL);
}

/** Runs a real signer tx with lifecycle callbacks. Never marks success before receipt. */
export async function runTx(
  label: string,
  fn: (contracts: ReturnType<typeof writeContracts>) => Promise<ethers.TransactionResponse>,
  onUpdate: (s: TxState) => void
): Promise<ethers.TransactionReceipt> {
  onUpdate({ stage: 'waiting', label, hash: '', error: '' });
  let res: ethers.TransactionResponse;
  try {
    const signer = await getSigner();
    const contracts = writeContracts(signer);
    res = await fn(contracts);
  } catch (e: any) {
    onUpdate({ stage: 'failed', label, hash: '', error: parseTxError(e) });
    throw e;
  }
  onUpdate({ stage: 'submitted', label, hash: res.hash, error: '' });
  onUpdate({ stage: 'confirming', label, hash: res.hash, error: '' });
  try {
    const receipt = await res.wait();
    if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted on-chain.');
    onUpdate({ stage: 'confirmed', label, hash: res.hash, error: '' });
    return receipt;
  } catch (e: any) {
    onUpdate({ stage: 'failed', label, hash: res.hash, error: parseTxError(e) });
    throw e;
  }
}
