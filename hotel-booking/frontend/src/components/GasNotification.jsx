import { formatEther } from 'ethers'

function formatGas(value) {
  return Number(value).toLocaleString('en-US')
}

function formatFee(value) {
  return `${formatEther(value).replace(/\.0+$|(?<=\.[0-9]*)0+$/, '')} ETH`
}

function GasToast({ notification, onDismiss }) {
  return (
    <article
      className="gas-toast"
      role="button"
      tabIndex="0"
      aria-label="Dismiss gas notification"
      onClick={() => onDismiss(notification.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onDismiss(notification.id)
      }}
    >
      <div className="gas-toast-icon" aria-hidden="true">⛽</div>
      <div>
        <strong>Transaction Confirmed</strong>
        <span>{notification.type}</span>
        <small>Gas Used: {formatGas(notification.gasUsed)} gas</small>
        {notification.fee != null && <small className="gas-toast-fee">Fee: {formatFee(notification.fee)}</small>}
      </div>
    </article>
  )
}

export default function GasNotification({ notifications, onDismiss }) {
  return <div className="gas-notifications" aria-live="polite">{notifications.map((notification) => <GasToast key={notification.id} notification={notification} onDismiss={onDismiss} />)}</div>
}