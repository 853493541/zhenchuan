/**
 * Performance timing utilities for measuring sync latency
 */

export interface TimingMetrics {
  label: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export class TimingTracker {
  private metrics: Map<string, TimingMetrics> = new Map();

  start(label: string): () => void {
    const metric: TimingMetrics = {
      label,
      startTime: performance.now(), // Microsecond precision
    };
    this.metrics.set(label, metric);

    // Return a function to stop timing
    return () => this.end(label);
  }

  end(label: string): number | null {
    const metric = this.metrics.get(label);
    if (!metric) return null;

    metric.endTime = performance.now();
    metric.duration = metric.endTime - metric.startTime;
    return metric.duration;
  }

  log(label: string): number | null {
    const duration = this.end(label);
    if (duration === null) return null;

    const emoji = duration < 5 ? "⚡" : duration < 10 ? "✅" : duration < 20 ? "⚠️" : "❌";
    console.log(
      `${emoji} [Timing] ${label}: ${duration.toFixed(2)}ms`
    );
    return duration;
  }

  getAll(): TimingMetrics[] {
    return Array.from(this.metrics.values());
  }

  clear() {
    this.metrics.clear();
  }
}

export const globalTimer = new TimingTracker();
