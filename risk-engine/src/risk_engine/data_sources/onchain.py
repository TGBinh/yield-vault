"""Real on-chain reads via web3.py - tái dùng đúng địa chỉ Aave v3 (Arbitrum Sepolia) và
Morpho Blue (Ethereum Sepolia) đã verify trong contracts/PLAN.md GĐ2-3 (không tự đoán
địa chỉ mới). Chỉ đọc utilization rate - dữ liệu quyết định risk score, không ghi gì
lên chain (RiskEngine không bao giờ có quyền ký giao dịch, xem PLAN.md §4 nguyên tắc
"AI/Engine không bao giờ trực tiếp kiểm soát tiền").
"""
from __future__ import annotations

from web3 import Web3

# Aave v3 Arbitrum Sepolia (bgd-labs/aave-address-book, đã dùng trong AaveStrategy fork test).
AAVE_ARBITRUM_SEPOLIA_RPC = "https://sepolia-rollup.arbitrum.io/rpc"
AAVE_PROTOCOL_DATA_PROVIDER = "0x12373B5085e3b42D42C1D4ABF3B3Cf4Df0E0Fa01"
AAVE_USDC_UNDERLYING = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"

_AAVE_DATA_PROVIDER_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "asset", "type": "address"}],
        "name": "getReserveData",
        "outputs": [
            {"internalType": "uint256", "name": "unbacked", "type": "uint256"},
            {"internalType": "uint256", "name": "accruedToTreasuryScaled", "type": "uint256"},
            {"internalType": "uint256", "name": "totalAToken", "type": "uint256"},
            {"internalType": "uint256", "name": "totalStableDebt", "type": "uint256"},
            {"internalType": "uint256", "name": "totalVariableDebt", "type": "uint256"},
            {"internalType": "uint256", "name": "liquidityRate", "type": "uint256"},
            {"internalType": "uint256", "name": "variableBorrowRate", "type": "uint256"},
            {"internalType": "uint256", "name": "stableBorrowRate", "type": "uint256"},
            {"internalType": "uint256", "name": "averageStableBorrowRate", "type": "uint256"},
            {"internalType": "uint256", "name": "liquidityIndex", "type": "uint256"},
            {"internalType": "uint256", "name": "variableBorrowIndex", "type": "uint256"},
            {"internalType": "uint256", "name": "lastUpdateTimestamp", "type": "uint256"},
        ],
        "stateMutability": "view",
        "type": "function",
    }
]

# Morpho Blue Ethereum Sepolia (đã dùng trong MorphoStrategy fork test).
MORPHO_ETHEREUM_SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com"
MORPHO_ADDRESS = "0xd011EE229E7459ba1ddd22631eF7bF528d424A14"

_MORPHO_ABI = [
    {
        "inputs": [{"internalType": "Id", "name": "id", "type": "bytes32"}],
        "name": "market",
        "outputs": [
            {"internalType": "uint128", "name": "totalSupplyAssets", "type": "uint128"},
            {"internalType": "uint128", "name": "totalSupplyShares", "type": "uint128"},
            {"internalType": "uint128", "name": "totalBorrowAssets", "type": "uint128"},
            {"internalType": "uint128", "name": "totalBorrowShares", "type": "uint128"},
            {"internalType": "uint128", "name": "lastUpdate", "type": "uint128"},
            {"internalType": "uint128", "name": "fee", "type": "uint128"},
        ],
        "stateMutability": "view",
        "type": "function",
    }
]


def get_aave_utilization(
    asset: str = AAVE_USDC_UNDERLYING,
    rpc_url: str = AAVE_ARBITRUM_SEPOLIA_RPC,
    data_provider: str = AAVE_PROTOCOL_DATA_PROVIDER,
) -> float:
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    contract = w3.eth.contract(address=Web3.to_checksum_address(data_provider), abi=_AAVE_DATA_PROVIDER_ABI)
    data = contract.functions.getReserveData(Web3.to_checksum_address(asset)).call()
    total_a_token, total_stable_debt, total_variable_debt = data[2], data[3], data[4]

    total_debt = total_stable_debt + total_variable_debt
    total_supplied = total_a_token  # aToken supply already includes outstanding debt (see Aave docs)
    if total_supplied <= 0:
        return 0.0
    return min(1.0, total_debt / total_supplied)


def get_morpho_utilization(
    market_id: bytes, rpc_url: str = MORPHO_ETHEREUM_SEPOLIA_RPC, morpho_address: str = MORPHO_ADDRESS
) -> float:
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    contract = w3.eth.contract(address=Web3.to_checksum_address(morpho_address), abi=_MORPHO_ABI)
    total_supply_assets, _, total_borrow_assets, _, _, _ = contract.functions.market(market_id).call()

    if total_supply_assets <= 0:
        return 0.0
    return min(1.0, total_borrow_assets / total_supply_assets)
