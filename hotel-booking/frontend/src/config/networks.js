import { ROOM_BOOKING_ABI as roomBookingAbi } from './roomBooking'

export const NETWORKS = {
  hardhat: {
    key: 'hardhat',
    name: 'Hardhat Local',
    chainId: 31337n,
    chainIdHex: '0x7A69',
    rpcUrl: 'http://127.0.0.1:8545',
    contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  sepolia: {
    key: 'sepolia',
    name: 'Sepolia',
    chainId: 11155111n,
    chainIdHex: '0xaa36a7',
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || '',
    contractAddress: import.meta.env.VITE_ROOM_BOOKING_SEPOLIA_ADDRESS || '',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  },
}

export const ROOM_BOOKING_ABI = roomBookingAbi

export function networkForChainId(chainId) {
  return Object.values(NETWORKS).find((network) => network.chainId === BigInt(chainId)) || null
}

export function getNetwork(key) {
  return NETWORKS[key]
}