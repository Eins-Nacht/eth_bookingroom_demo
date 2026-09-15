import { BrowserProvider, Contract, Interface, formatEther, parseEther } from 'ethers'
import { getNetwork, networkForChainId, ROOM_BOOKING_ABI } from '../config/networks'

export const SLOT_HOURS = [9, 11, 13, 15, 17, 19]
export const BOOKING_DAYS = 3
const ROOM_BOOKING_INTERFACE = new Interface(ROOM_BOOKING_ABI)

function serializeTraceValue(value) {
  return typeof value === 'bigint' ? value.toString() : value
}

function traceRpc(method, params) {
  const request = params?.[0]
  const data = typeof request?.data === 'string' ? request.data : undefined
  const selector = data?.slice(0, 10)
  let decoded

  if (data && selector) {
    try {
      const fragment = ROOM_BOOKING_INTERFACE.parseTransaction({ data })
      decoded = fragment ? {
        functionName: fragment.name,
        arguments: fragment.args.map(serializeTraceValue),
      } : undefined
    } catch {
      decoded = { functionName: 'unrecognized-selector' }
    }
  }

  console.log('ROOM BOOKING RPC', {
    method,
    address: request?.to,
    data,
    selector,
    ...decoded,
    params,
  })
  if (method === 'eth_call' || method === 'eth_estimateGas') console.trace('ROOM BOOKING RPC STACK')
}

function traceWalletRequest(method, params) {
  console.log('ROOM BOOKING WALLET REQUEST', { method, params })
}

function traceContractCall(contract, method, args) {
  const data = ROOM_BOOKING_INTERFACE.encodeFunctionData(method, args)
  const fragment = ROOM_BOOKING_INTERFACE.getFunction(method)
  console.log('ROOM BOOKING CONTRACT CALL', {
    method,
    address: contract.target ?? contract.address,
    data,
    selector: fragment.selector,
    arguments: args.map(serializeTraceValue),
  })
  return data
}

function instrumentProvider(provider) {
  if (provider.__roomBookingTraceInstalled) return provider

  const originalSend = provider.send.bind(provider)
  provider.send = async (method, params) => {
    traceRpc(method, params)
    return originalSend(method, params)
  }
  provider.__roomBookingTraceInstalled = true
  return provider
}

function requireAddress(network) {
  if (!network?.contractAddress) {
    throw new Error(`Contract address is not configured for ${network?.name || 'this network'}.`)
  }
  return network.contractAddress
}

export function hasWallet() {
  return Boolean(window.ethereum)
}

export async function getWalletState({ requestAccounts = true } = {}) {
  if (!hasWallet()) throw new Error('MetaMask is not installed.')

  const provider = instrumentProvider(new BrowserProvider(window.ethereum))
  traceWalletRequest(requestAccounts ? 'eth_requestAccounts' : 'eth_accounts', [])
  const accounts = await provider.send(requestAccounts ? 'eth_requestAccounts' : 'eth_accounts', [])
  traceWalletRequest('eth_chainId', [])
  const chainIdHex = await provider.send('eth_chainId', [])
  const chainId = BigInt(chainIdHex)
  const network = networkForChainId(chainId)

  if (!accounts[0]) throw new Error('No wallet account was returned.')
  return { provider, signer: await provider.getSigner(), address: accounts[0], chainId, chainIdHex, network, supported: Boolean(network) }
}

export async function getConnectedWalletState() {
  if (!hasWallet()) return null

  traceWalletRequest('eth_accounts', [])
  const accounts = await window.ethereum.request({ method: 'eth_accounts' })
  if (!accounts[0]) return null

  return getWalletState({ requestAccounts: false })
}

export async function switchToNetwork(networkKey) {
  if (!hasWallet()) throw new Error('MetaMask is not installed.')
  const network = getNetwork(networkKey)
  if (!network) throw new Error('Unknown network selected.')

  try {
    traceWalletRequest('wallet_switchEthereumChain', { chainId: network.chainIdHex })
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainIdHex }] })
  } catch (error) {
    if (error.code !== 4902) {
      const switchError = new Error(error.message || 'Network switch was rejected.', { cause: error })
      switchError.code = error.code
      throw switchError
    }
    if (!network.rpcUrl) {
      throw new Error(`${network.name} is not configured with an RPC URL.`, { cause: error })
    }

    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: network.chainIdHex,
        chainName: network.name,
        rpcUrls: [network.rpcUrl],
        nativeCurrency: network.nativeCurrency,
      }],
    })
  }
}

export function getReadContract(provider, network) {
  return createContract(provider, network)
}

export function getWriteContract(signer, network) {
  return createContract(signer, network)
}

function createContract(runner, network) {
  const contractAddress = requireAddress(network)
  const contract = new Contract(contractAddress, ROOM_BOOKING_ABI, runner)
  const provider = runner.provider || runner

  provider.getNetwork().then((result) => console.log('NETWORK:', result)).catch((error) => {
    console.error('Unable to read provider network:', error)
  })
  console.log('CONTRACT ADDRESS:', contract.target ?? contract.address)
  console.log(
    'CONTRACT FUNCTIONS:',
    contract.interface.fragments
      .filter((fragment) => fragment.type === 'function')
      .map((fragment) => `${fragment.format()} -> ${contract.interface.getFunction(fragment.name).selector}`),
  )

  provider.getCode(contractAddress).then((code) => {
    console.log('CONTRACT BYTECODE:', code === '0x' ? 'MISSING' : `present (${code.length} hex chars)`)
    if (code === '0x') {
      console.error(`No deployed bytecode found at ${contractAddress}.`)
    }
  }).catch((error) => console.error('Unable to read contract bytecode:', error))

  return contract
}

export async function loadRooms(provider, network) {
  const contract = getReadContract(provider, network)
  traceContractCall(contract, 'roomCount', [])
  const count = Number(await contract.roomCount())
  const rooms = []

  for (let roomId = 1; roomId <= count; roomId += 1) {
    traceContractCall(contract, 'rooms', [roomId])
    const room = await contract.rooms(roomId)
    if (room.exists) {
      rooms.push({
        id: roomId,
        name: room.name,
        price: room.price,
        priceEth: formatEther(room.price),
      })
    }
  }

  return rooms
}

export function dateKeyToDayStart(dateKey) {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 1000)
}

export function slotTimestamp(dateKey, hour) {
  return BigInt(dateKeyToDayStart(dateKey) + hour * 60 * 60)
}

export function dateKeyFromDayStart(dayStart) {
  return new Date(dayStart * 1000).toISOString().slice(0, 10)
}

export function getBookableDates() {
  const now = Math.floor(Date.now() / 1000)
  const today = Math.floor(now / 86400) * 86400
  return Array.from({ length: BOOKING_DAYS + 1 }, (_, index) => dateKeyFromDayStart(today + index * 86400))
}

export async function loadAvailability(provider, network, room, dateKey) {
  const contract = getReadContract(provider, network)
  const slots = await Promise.all(SLOT_HOURS.map(async (hour) => {
    const startTime = slotTimestamp(dateKey, hour)
    traceContractCall(contract, 'isSlotAvailable', [room.id, startTime])
    const available = await contract.isSlotAvailable(room.id, startTime)
    return { hour, startTime, available }
  }))
  return { ...room, slots, available: slots.some((slot) => slot.available) }
}

export async function loadMyBookings(provider, network, rooms, address) {
  const contract = getReadContract(provider, network)
  traceContractCall(contract, 'getUserBookings', [address])
  const bookingIds = await contract.getUserBookings(address)
  const roomById = new Map(rooms.map((room) => [room.id, room]))
  const bookings = await Promise.all(bookingIds.map((bookingId) => {
    traceContractCall(contract, 'getBookingById', [bookingId])
    return contract.getBookingById(bookingId)
  }))

  return bookings
    .map((booking) => ({
      id: Number(booking.id),
      room: roomById.get(Number(booking.roomId)),
      dateKey: dateKeyFromDayStart(Number(booking.startTime) - (Number(booking.startTime) % 86400)),
      hour: Math.floor((Number(booking.startTime) % 86400) / 3600),
      startTime: booking.startTime,
      amount: booking.amount,
      active: booking.active,
    }))
    .filter((booking) => booking.room)
}

export async function submitBatchBooking(signer, network, bookings, totalPrice) {
  const contract = getWriteContract(signer, network)
  const roomIds = bookings.map(({ room }) => room.id)
  const startTimes = bookings.map(({ slot }) => slot.startTime)
  traceContractCall(contract, 'bookRooms', [roomIds, startTimes])
  return contract.bookRooms(roomIds, startTimes, { value: totalPrice })
}

export async function estimateBatchBookingFee(provider, network, bookings, totalPrice) {
  const contract = getReadContract(provider, network)
  const roomIds = bookings.map(({ room }) => room.id)
  const startTimes = bookings.map(({ slot }) => slot.startTime)
  const gasLimit = await contract.bookRooms.estimateGas(roomIds, startTimes, { value: totalPrice })
  const feeData = await provider.getFeeData()
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas
  if (gasPrice == null) return null
  return gasLimit * gasPrice
}

export async function submitAddRoom(signer, network, name, priceEth) {
  const contract = getWriteContract(signer, network)
  const price = parseEther(priceEth)
  traceContractCall(contract, 'addRoom', [name, price])
  return contract.addRoom(name, price)
}

export async function submitCancellation(signer, network, roomId, startTime) {
  const contract = getWriteContract(signer, network)
  traceContractCall(contract, 'cancelBooking', [roomId, startTime])
  return contract.cancelBooking(roomId, startTime)
}

function findRevertName(error) {
  const errorData = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.cause?.data,
  ].find((data) => typeof data === 'string' && data.startsWith('0x'))

  if (errorData) {
    try {
      return new Interface(ROOM_BOOKING_ABI).parseError(errorData)?.name
    } catch {
      // Fall back to the provider's error text below.
    }
  }

  let message = error?.message || ''
  try {
    message = `${message} ${JSON.stringify(error, (_, value) => typeof value === 'bigint' ? value.toString() : value) || ''}`
  } catch {
    // Keep the provider message when the error contains circular data.
  }
  return ['SlotUnavailable', 'IncorrectPayment', 'InvalidRoom', 'InvalidSlot'].find((name) => message.includes(name))
}

export function explainWalletError(error) {
  const revertName = findRevertName(error)
  if (revertName === 'SlotUnavailable') return 'This time slot is no longer available.'
  if (revertName === 'IncorrectPayment') return 'Incorrect payment amount.'
  if (revertName === 'InvalidRoom') return 'Invalid room.'
  if (revertName === 'InvalidSlot') return 'Invalid booking time slot.'

  const message = error?.shortMessage || error?.reason || error?.message || 'Booking transaction failed.'
  if (error?.code === 4001 || error?.code === 'ACTION_REJECTED' || message.toLowerCase().includes('user rejected')) return 'Transaction cancelled by user.'
  if (message.toLowerCase().includes('insufficient funds')) return 'Insufficient ETH for this booking and gas.'
  return message === 'Transaction failed.' ? 'Booking transaction failed.' : message
}
