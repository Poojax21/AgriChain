import json
import os
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct

class OracleSigner:
    """
    Cryptographic Oracle Signer for AgriChain OracleRegistry.
    Generates EIP-191 signatures matching Solidity:
    keccak256(abi.encodePacked(chainId, oracleRegistryAddress, tokenId, grade, confidenceScore, reportHash))
    """
    def __init__(self, private_key: str = None):
        # Default to standard hardhat test oracle key if none provided
        self.private_key = private_key or os.getenv(
            "ORACLE_PRIVATE_KEY",
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        )
        self.account = Account.from_key(self.private_key)
        self.address = self.account.address

    def generate_report_hash(self, report_dict: dict) -> str:
        """
        Computes the keccak256 hash of canonical sorted JSON inspection report.
        """
        canonical_json = json.dumps(report_dict, sort_keys=True, separators=(',', ':'))
        raw_hex = Web3.keccak(text=canonical_json).hex()
        return "0x" + raw_hex if not raw_hex.startswith("0x") else raw_hex

    def sign_verification(
        self,
        chain_id: int,
        registry_address: str,
        token_id: int,
        grade: int,
        confidence_score: int,
        report_hash: str
    ) -> dict:
        """
        Constructs packed message hash and generates ECDSA signature.
        """
        clean_registry = Web3.to_checksum_address(registry_address)
        report_hash_bytes = bytes.fromhex(report_hash[2:] if report_hash.startswith("0x") else report_hash)

        # Packed keccak matching Solidity abi.encodePacked
        message_hash = Web3.solidity_keccak(
            ['uint256', 'address', 'uint256', 'uint8', 'uint16', 'bytes32'],
            [int(chain_id), clean_registry, int(token_id), int(grade), int(confidence_score), report_hash_bytes]
        )

        signable_msg = encode_defunct(primitive=message_hash)
        signed_result = Account.sign_message(signable_msg, private_key=self.private_key)
        sig_raw = signed_result.signature.hex()
        signature_hex = "0x" + sig_raw if not sig_raw.startswith("0x") else sig_raw

        # Sanity check: verify recovered address equals oracle address
        recovered_address = Account.recover_message(signable_msg, signature=signature_hex)
        assert recovered_address.lower() == self.address.lower(), "Signature recovery verification failed!"

        msg_raw = message_hash.hex()
        return {
            "signer": self.address,
            "messageHash": "0x" + msg_raw if not msg_raw.startswith("0x") else msg_raw,
            "signature": signature_hex,
            "verified": True
        }
