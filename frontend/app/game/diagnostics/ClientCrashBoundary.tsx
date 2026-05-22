"use client";

import React from "react";
import { formatCrashDiagnosticsReport, getClientCrashRecorder, type CrashRecorderContext } from "./clientCrashRecorder";

type Props = {
  context: CrashRecorderContext;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
  reportText: string;
  reportId: string | null;
  uploading: boolean;
};

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!ok) throw new Error("copy failed");
  return Promise.resolve();
}

export default class ClientCrashBoundary extends React.Component<Props, State> {
  state: State = {
    error: null,
    reportText: "",
    reportId: null,
    uploading: false,
  };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const recorder = getClientCrashRecorder();
    recorder.updateContext(this.props.context);
    recorder.recordFatalError(error, { componentStack: info.componentStack }, "react-error-boundary");
    const report = recorder.buildReport("react-error-boundary", { compact: false });
    const reportText = formatCrashDiagnosticsReport(report);
    this.setState({ error, reportText, uploading: true });
    recorder.uploadReport("react-error-boundary", { compact: false })
      .then((data) => {
        this.setState({ reportId: typeof data?.reportId === "string" ? data.reportId : null, uploading: false });
      })
      .catch(() => {
        this.setState({ uploading: false });
      });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh",
        width: "100%",
        background: "#05080d",
        color: "#edf4ff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        boxSizing: "border-box",
        fontFamily: "Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif",
      }}>
        <div style={{
          width: "min(760px, 94vw)",
          border: "1px solid rgba(130, 184, 210, 0.42)",
          background: "rgba(19, 29, 39, 0.96)",
          borderRadius: 6,
          padding: 18,
          boxShadow: "0 16px 34px rgba(0,0,0,0.42)",
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>游戏运行错误</div>
          <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 14, wordBreak: "break-word" }}>
            {this.state.error.name}: {this.state.error.message}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => void copyText(this.state.reportText)}
              style={{ height: 28, padding: "0 12px", borderRadius: 4, border: "1px solid rgba(145, 204, 220, 0.5)", background: "#256d7b", color: "#fff", fontWeight: 700 }}
            >
              复制报告
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([this.state.reportText], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `zhenchuan-crash-${Date.now()}.txt`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }}
              style={{ height: 28, padding: "0 12px", borderRadius: 4, border: "1px solid rgba(145, 204, 220, 0.5)", background: "#334155", color: "#fff", fontWeight: 700 }}
            >
              下载报告
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#b7c6d8" }}>
            {this.state.uploading ? "报告上传中" : this.state.reportId ? `报告 ${this.state.reportId}` : "报告已保存在本机队列，下一次进入会继续上传"}
          </div>
        </div>
      </div>
    );
  }
}
