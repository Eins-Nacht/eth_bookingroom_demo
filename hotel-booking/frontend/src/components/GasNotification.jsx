import { useEffect } from 'react'
import { formatEther } from 'ethers'

function formatGas(value) {
  return Number(value).toLocaleString('en-US')
}

function formatFee(value) {
  return `${formatEther(value).replace(/\.0+$|(?<=\.[0-9]*)0+$/, '')} ETH`
}

function GasToast({ notification, onDismiss }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(notification.id), 4500)
    return () => window.clearTimeout(timeout)
  }, [notification.id, onDismiss])

  return (
    <article className="gas-toast" role="status">
      <div className="gas-toast-icon" aria-hidden="true">⛽</div>
      <div>
        <strong>Transaction Confirmed</strong>
        <span>{notification.type}</span>
        <small>Gas Used: {formatGas(notification.gasUsed)} gas</small>
        {notification.fee != null && <small>Fee: {formatFee(notification.fee)}</small>}
      </div>
    </article>
  )
}

export default function GasNotification({ notifications, onDismiss }) {
  return <div className="gas-notifications" aria-live="polite">{notifications.map((notification) => <GasToast key={notification.id} notification={notification} onDismiss={onDismiss} />)}</div>
}