import { useCallback, useEffect, useState } from 'react'
import { formatEther } from 'ethers'
import {
  SLOT_HOURS,
  explainWalletError,
  getConnectedWalletState,
  getBookableDates,
  getWalletState,
  hasWallet,
  loadAvailability,
  loadMyBookings,
  loadRooms,
  estimateBatchBookingFee,
  switchToNetwork,
  submitBatchBooking,
  submitAddRoom,
  submitCancellation,
} from './services/roomBooking'
import './App.css'
import { NETWORKS } from './config/networks'
import GasNotification from './components/GasNotification'

function shortAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatDate(dateKey) {
  return new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${dateKey}T00:00:00Z`))
}

function formatTime(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

function App() {
  const [dates] = useState(() => getBookableDates())
  const [wallet, setWallet] = useState(null)
  const [connectedAddress, setConnectedAddress] = useState('')
  const [selectedNetworkKey, setSelectedNetworkKey] = useState('hardhat')
  const [rooms, setRooms] = useState([])
  const [availability, setAvailability] = useState([])
  const [selectedRoomIds, setSelectedRoomIds] = useState([])
  const [selectedDate, setSelectedDate] = useState(dates[0])
  const [selectedHours, setSelectedHours] = useState([SLOT_HOURS[0]])
  const [reservations, setReservations] = useState([])
  const [currentReservationIndex, setCurrentReservationIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [transactionStatus, setTransactionStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [newRoomName, setNewRoomName] = useState('')
  const [newRoomPrice, setNewRoomPrice] = useState('1')
  const [gasNotifications, setGasNotifications] = useState([])
  const [estimatedGasFee, setEstimatedGasFee] = useState(null)

  const dismissGasNotification = useCallback((notificationId) => {
    setGasNotifications((current) => current.filter((notification) => notification.id !== notificationId))
  }, [])

  function showGasNotification(type, transaction, receipt) {
    const gasPrice = receipt.effectiveGasPrice ?? receipt.gasPrice ?? transaction.gasPrice
    const fee = gasPrice == null ? null : receipt.gasUsed * gasPrice
    setGasNotifications((current) => [...current, {
      id: transaction.hash,
      type,
      gasUsed: receipt.gasUsed,
      fee,
    }])
  }

  async function connectWallet() {
    setMessage('')
    if (!hasWallet()) {
      setMessage('MetaMask is not installed. Install it to connect a wallet.')
      return
    }
    try {
      const nextWallet = await getWalletState()
      setWallet(nextWallet)
      setConnectedAddress(nextWallet.address)
      if (nextWallet.network) setSelectedNetworkKey(nextWallet.network.key)
    } catch (error) {
      setMessage(explainWalletError(error))
    }
  }

  function disconnectWallet() {
    setWallet(null)
    setConnectedAddress('')
    setRooms([])
    setAvailability([])
    setReservations([])
    setMessage('Wallet disconnected from this app.')
  }

  useEffect(() => {
    if (!window.ethereum) return undefined

    let active = true

    async function syncConnectedWallet(showError = false) {
      try {
        const nextWallet = await getConnectedWalletState()
        if (!active) return
        if (nextWallet) {
          setWallet(nextWallet)
          setConnectedAddress(nextWallet.address)
          if (nextWallet.network) setSelectedNetworkKey(nextWallet.network.key)
          setMessage('')
        } else {
          setWallet(null)
          setConnectedAddress('')
          if (showError) setMessage('Connect MetaMask to continue.')
        }
      } catch (error) {
        if (active && showError) setMessage(explainWalletError(error))
      }
    }

    syncConnectedWallet()

    function handleAccountsChanged(accounts) {
      if (accounts.length === 0) {
        disconnectWallet()
      } else {
        syncConnectedWallet(true)
      }
    }

    function handleChainChanged() {
      setWallet(null)
      setConnectedAddress('')
      setRooms([])
      setAvailability([])
      syncConnectedWallet(true)
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum.removeListener('chainChanged', handleChainChanged)
      active = false
    }
  }, [])

  useEffect(() => {
    if (!wallet || !wallet.supported || !wallet.network?.contractAddress) {
      return undefined
    }
    let cancelled = false

    async function refreshData() {
      setLoading(true)
      setMessage('')
      try {
        const nextRooms = await loadRooms(wallet.provider, wallet.network)
        const nextAvailability = await Promise.all(nextRooms.map((room) => loadAvailability(wallet.provider, wallet.network, room, selectedDate)))
        const nextBookings = await loadMyBookings(wallet.provider, wallet.network, nextRooms, wallet.address)
        if (cancelled) return
        setRooms(nextRooms)
        setAvailability(nextAvailability)
        setReservations(nextBookings)
        setSelectedRoomIds((currentIds) => currentIds.filter((roomId) => nextRooms.some((room) => room.id === roomId)))
      } catch (error) {
        if (!cancelled) setMessage(explainWalletError(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    refreshData()
    return () => { cancelled = true }
  }, [wallet, selectedDate, refreshKey, dates])

  const selectedRooms = rooms.filter((room) => selectedRoomIds.includes(room.id))
  const selectedAvailability = selectedRooms.map((room) => availability.find((item) => item.id === room.id))
  const bookingSelections = selectedRooms.flatMap((room, roomIndex) => selectedHours.map((hour) => ({
    room,
    slot: selectedAvailability[roomIndex]?.slots.find((item) => item.hour === hour),
  })))
  const allSelectionsAvailable = bookingSelections.length > 0 && bookingSelections.every(({ slot }) => slot?.available)
  const totalRoomPrice = bookingSelections.reduce((total, { room }) => total + room.price, 0n)
  const isBusy = transactionStatus === 'pending'

  useEffect(() => {
    if (!wallet || !wallet.supported || !wallet.network?.contractAddress || !allSelectionsAvailable) {
      setEstimatedGasFee(null)
      return undefined
    }

    let cancelled = false
    setEstimatedGasFee(null)

    estimateBatchBookingFee(wallet.provider, wallet.network, bookingSelections, totalRoomPrice)
      .then((fee) => {
        if (!cancelled) setEstimatedGasFee(fee)
      })
      .catch(() => {
        if (!cancelled) setEstimatedGasFee(null)
      })

    return () => { cancelled = true }
  }, [wallet, selectedRoomIds, selectedHours, selectedDate, availability, totalRoomPrice])

  async function handleBooking() {
    if (!wallet || !allSelectionsAvailable) return
    setTransactionStatus('pending')
    setMessage(`Confirm one transaction for ${bookingSelections.length} booking${bookingSelections.length === 1 ? '' : 's'} in MetaMask.`)
    try {
      const transaction = await submitBatchBooking(wallet.signer, wallet.network, bookingSelections, totalRoomPrice)
      console.log('Batch booking transaction submitted:', transaction.hash)
      setMessage('Waiting for the booking transaction to confirm...')
      const receipt = await transaction.wait()
      if (!receipt || (receipt.status !== 1 && receipt.status !== 1n)) {
        throw new Error('Booking transaction failed.')
      }
      showGasNotification('Rooms Booked', transaction, receipt)
      setTransactionStatus('success')
      setMessage(`${bookingSelections.length} booking${bookingSelections.length === 1 ? '' : 's'} confirmed on-chain.`)
      setCurrentReservationIndex(0)
      setSelectedRoomIds([])
      setRefreshKey((key) => key + 1)
    } catch (error) {
      console.error('Booking transaction failed:', error)
      setTransactionStatus('error')
      setMessage(explainWalletError(error))
    }
  }

  async function handleAddRoom(event) {
    event.preventDefault()
    if (!canUseContract || !newRoomName.trim() || !newRoomPrice) return

    setTransactionStatus('pending')
    setMessage('Confirm the add-room transaction in MetaMask.')
    try {
      const transaction = await submitAddRoom(wallet.signer, wallet.network, newRoomName.trim(), newRoomPrice)
      setMessage('Waiting for add-room confirmation...')
      const receipt = await transaction.wait()
      if (!receipt || (receipt.status !== 1 && receipt.status !== 1n)) {
        throw new Error('Add-room transaction failed.')
      }
      showGasNotification('Room Added', transaction, receipt)
      setTransactionStatus('success')
      setMessage('Room added on-chain.')
      setNewRoomName('')
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setTransactionStatus('error')
      setMessage(explainWalletError(error))
    }
  }

  async function handleCancellation() {
    const currentReservation = reservations[currentReservationIndex]
    if (!wallet || !currentReservation || !currentReservation.active) return
    setTransactionStatus('pending')
    setMessage('Confirm the cancellation transaction in MetaMask.')
    try {
      const transaction = await submitCancellation(wallet.signer, wallet.network, currentReservation.room.id, currentReservation.startTime)
      setMessage('Waiting for cancellation confirmation...')
      const receipt = await transaction.wait()
      if (!receipt || (receipt.status !== 1 && receipt.status !== 1n)) {
        throw new Error('Cancellation transaction failed.')
      }
      showGasNotification('Booking Cancelled', transaction, receipt)
      setTransactionStatus('success')
      setMessage('Booking cancelled and the slot is available again.')
      setReservations((currentReservations) => currentReservations.filter((reservation) => reservation.id !== currentReservation.id))
      setCurrentReservationIndex(0)
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setTransactionStatus('error')
      setMessage(explainWalletError(error))
    }
  }

  async function handleSwitchNetwork() {
    setMessage('Confirm the network switch in MetaMask.')
    try {
      await switchToNetwork(selectedNetworkKey)
      const nextWallet = await getConnectedWalletState()
      if (nextWallet) {
        setWallet(nextWallet)
        setConnectedAddress(nextWallet.address)
        if (nextWallet.network) setSelectedNetworkKey(nextWallet.network.key)
        setMessage('Network switched successfully.')
      }
    } catch (error) {
      setMessage(explainWalletError(error))
    }
  }

  const currentNetworkName = wallet?.network?.name || 'Unsupported Network'
  const nativeCurrencySymbol = wallet?.network?.nativeCurrency?.symbol || 'ETH'
  const canUseContract = Boolean(wallet?.supported && wallet.network?.contractAddress)
  const maxRoomsReached = rooms.length >= 4
  const needsNetworkSwitch = !wallet?.network || wallet.network.key !== selectedNetworkKey
  const sortedReservations = [...reservations].sort((left, right) => {
    const leftStart = Number(left.startTime)
    const rightStart = Number(right.startTime)
    return leftStart - rightStart || left.room.id - right.room.id || left.id - right.id
  })
  const safeReservationIndex = sortedReservations.length === 0
    ? 0
    : Math.min(currentReservationIndex, sortedReservations.length - 1)
  const currentReservation = sortedReservations[safeReservationIndex]

  return (
    <>
      <GasNotification notifications={gasNotifications} onDismiss={dismissGasNotification} />
      <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>StayLedger</span></div>
        <div className="network-controls">
          <span className={`network-label ${wallet?.supported ? 'supported' : 'unsupported'}`}>{currentNetworkName}</span>
          <select aria-label="Target network" value={selectedNetworkKey} onChange={(event) => setSelectedNetworkKey(event.target.value)}>
            {Object.values(NETWORKS).map((network) => <option value={network.key} key={network.key}>{network.name}</option>)}
          </select>
          {wallet && needsNetworkSwitch && <button className="switch-button" type="button" onClick={handleSwitchNetwork}>Switch Network</button>}
        </div>
        {connectedAddress ? <button className="wallet-button connected" type="button" onClick={disconnectWallet}>● {shortAddress(connectedAddress)} / Disconnect</button> : <button className="wallet-button" type="button" onClick={connectWallet}>Connect Wallet</button>}
      </header>

      <section className="hero">
        <div><p className="eyebrow">Room booking on Ethereum</p><h1>Book your<br /><em>two-hour stay.</em></h1><p className="hero-text">Choose a room, select a fixed slot, and hold your reservation directly from MetaMask.</p></div>
        <div className="hero-note"><span className="note-line"></span><p>Today through<br />the next 3 days.</p></div>
      </section>

      <section className="workspace">
        <div className="section-heading"><div><p className="eyebrow">01 / Rooms</p><h2>Available rooms</h2></div><span className="room-count">{loading ? 'LOADING' : `${rooms.length} ROOMS ON-CHAIN`}</span></div>
        {message && <div className={`notice ${transactionStatus}`}>{message}</div>}
        {!wallet && <div className="empty-state">Connect MetaMask to read rooms and booking availability from the contract.</div>}
        {wallet && !wallet.supported && <div className="empty-state">Unsupported network. Select Hardhat Local or Sepolia, then switch networks to continue.</div>}
        {wallet?.supported && !wallet.network.contractAddress && <div className="empty-state">No contract address is configured for {currentNetworkName}. Set its network-specific Vite environment variable.</div>}
        {canUseContract && !loading && rooms.length === 0 && <div className="empty-state">No rooms available.</div>}
        <div className="room-grid">
          {availability.map((room) => <button className={`room-card ${selectedRoomIds.includes(room.id) ? 'selected' : ''}`} type="button" key={room.id} onClick={() => setSelectedRoomIds((currentIds) => currentIds.includes(room.id) ? currentIds.filter((roomId) => roomId !== room.id) : [...currentIds, room.id])}><span className="room-id">ROOM {String(room.id).padStart(2, '0')}</span><strong>{room.name}</strong><span className="room-card-bottom"><span>{room.available ? 'Available' : 'Fully booked'} / {room.priceEth} ETH</span><span className="select-mark">{selectedRoomIds.includes(room.id) ? 'SELECTED' : 'SELECT'}</span></span></button>)}
        </div>
        {canUseContract && <form className="add-room-form" onSubmit={handleAddRoom}>
          <div><label htmlFor="room-name">Test room name</label><input id="room-name" value={newRoomName} onChange={(event) => setNewRoomName(event.target.value)} placeholder="Garden Twin Room" /></div>
          <div><label htmlFor="room-price">Price / ETH</label><input id="room-price" min="0" step="0.001" type="number" value={newRoomPrice} onChange={(event) => setNewRoomPrice(event.target.value)} /></div>
          <button className="add-room-button" disabled={isBusy || maxRoomsReached || !newRoomName.trim()} type="submit">{isBusy ? 'Waiting...' : maxRoomsReached ? 'Maximum reached' : 'Add Room'}</button>
          {maxRoomsReached && <span className="form-note">Maximum 4 rooms reached.</span>}
        </form>}
      </section>

      <section className="booking-layout">
        <div className="booking-panel">
          <div className="section-heading"><div><p className="eyebrow">02 / Reservation</p><h2>Select a slot</h2></div></div>
          <label className="date-control">Date<select value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>{dates.map((date, index) => <option value={date} key={date}>{index === 0 ? `Today - ${formatDate(date)}` : formatDate(date)}</option>)}</select></label>
          <div className="slot-heading"><span>2-hour time slot</span><span>UTC / fixed schedule</span></div>
          <div className="slot-grid">{SLOT_HOURS.map((hour) => { const available = selectedRooms.length === 0 ? availability.some((room) => room.slots.some((slot) => slot.hour === hour && slot.available)) : selectedRooms.every((room) => availability.find((item) => item.id === room.id)?.slots.some((slot) => slot.hour === hour && slot.available)); return <button className={`slot-button ${selectedHours.includes(hour) ? 'selected' : ''}`} disabled={!available || isBusy} type="button" key={hour} onClick={() => setSelectedHours((currentHours) => currentHours.includes(hour) ? currentHours.filter((currentHour) => currentHour !== hour) : [...currentHours, hour])}><strong>{formatTime(hour)}</strong><small>{available ? selectedHours.includes(hour) ? 'Selected' : 'Available' : 'Booked'}</small></button> })}</div>
          <div className="booking-summary"><span>{bookingSelections.length ? `${bookingSelections.length} booking${bookingSelections.length === 1 ? '' : 's'} / ${formatDate(selectedDate)}` : `No selections / ${formatDate(selectedDate)}`}</span><strong>{bookingSelections.length ? `${formatEther(totalRoomPrice)} ETH` : 'None'} <small className="booking-gas">{estimatedGasFee != null ? `+ ~${formatEther(estimatedGasFee)} ${nativeCurrencySymbol} gas` : 'Gas: --'}</small></strong></div>
          <div className="booking-selection-list">{bookingSelections.map(({ room, slot }) => <div key={`${room.id}-${slot?.hour}`}><span>{room.name} / {formatDate(selectedDate)} / {formatTime(slot.hour)}</span><strong>{room.priceEth} ETH</strong></div>)}</div>
          <button className="reserve-button" disabled={!canUseContract || !allSelectionsAvailable || isBusy} type="button" onClick={handleBooking}>{isBusy ? 'Waiting for MetaMask...' : canUseContract ? 'Book selected slots' : 'Switch network to book'}<span>-&gt;</span></button>
        </div>

        <aside className="my-booking">
          <div className="reservation-heading"><div><p className="eyebrow">03 / My reservations</p><h3>Your reservation</h3></div>{sortedReservations.length > 0 && <div className="reservation-navigation"><button aria-label="Previous reservation" disabled={safeReservationIndex === 0} type="button" onClick={() => setCurrentReservationIndex((index) => Math.max(0, index - 1))}>&lt;</button><span>{safeReservationIndex + 1} / {sortedReservations.length}</span><button aria-label="Next reservation" disabled={safeReservationIndex === sortedReservations.length - 1} type="button" onClick={() => setCurrentReservationIndex((index) => Math.min(sortedReservations.length - 1, index + 1))}>&gt;</button></div>}</div>
          {!currentReservation ? <div className="booking-empty">{wallet ? 'No reservations found for this wallet.' : 'Connect a wallet to view your reservations.'}</div> : <div className="booking-details"><div><span>Room</span><strong>{currentReservation.room.name}</strong></div><div><span>Date</span><strong>{formatDate(currentReservation.dateKey)}</strong></div><div><span>Time</span><strong>{formatTime(currentReservation.hour)} - {formatTime(currentReservation.hour + 2)} UTC</strong></div><div><span>Payment</span><strong>{formatEther(currentReservation.amount)} ETH</strong></div><div><span>Status</span><strong className={currentReservation.active ? 'active-status' : 'inactive-status'}>{currentReservation.active ? '● Active on-chain' : '● Cancelled'}</strong></div>{currentReservation.active && <button className="cancel-button" disabled={isBusy} type="button" onClick={handleCancellation}>{isBusy ? 'Waiting...' : 'Cancel booking'}</button>}</div>}
        </aside>
      </section>

      <footer><span>stayledger / contract-connected prototype</span><span>Room availability is read from Ethereum.</span></footer>
      </main>
    </>
  )
}

export default App
