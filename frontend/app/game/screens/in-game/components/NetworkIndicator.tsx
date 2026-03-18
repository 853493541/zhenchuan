/**
 * Network latency indicator
 * Shows RTT on screen like competitive games
 */

import stylesModule from "./NetworkIndicator.module.css";

interface NetworkIndicatorProps {
  rtt: number | null;
}

export default function NetworkIndicator({ rtt }: NetworkIndicatorProps) {
  const styles = stylesModule;

  // Show placeholder while measuring, actual value once we have one
  const displayRtt = rtt ?? "...";
  const isReady = rtt !== null;

  // Color coding based on RTT
  let className = styles.rttGood; // <20ms (default/measuring)
  if (isReady) {
    if (rtt >= 20 && rtt < 50) className = styles.rttOk;
    else if (rtt >= 50 && rtt < 100) className = styles.rttWarning;
    else if (rtt >= 100) className = styles.rttBad;
  }

  // Icon based on latency
  let icon = "📡"; // measuring
  if (isReady) {
    if (rtt < 20) icon = "⚡";
    else if (rtt >= 20 && rtt < 50) icon = "✅";
    else if (rtt >= 50 && rtt < 100) icon = "⚠️";
    else if (rtt >= 100) icon = "🔴";
  }

  return (
    <div className={`${styles.networkIndicator} ${className}`}>
      <span className={styles.rttIcon}>{icon}</span>
      <span className={styles.rttText}>
        {typeof displayRtt === "number" ? `${displayRtt}ms` : displayRtt}
      </span>
    </div>
  );
}
