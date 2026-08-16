import * as vscode from "vscode";
import {
  formatUsageStatusBar,
  formatUsageTooltip,
  type GrokUsageSnapshot,
  type UsageDisplayRow,
} from "./domain";

export interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "openSubscriptionUsage" | "openUsage" | "refresh";
}

export function renderUsageStatus(item: vscode.StatusBarItem, snapshot: GrokUsageSnapshot): void {
  item.text = formatUsageStatusBar(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

export function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = {
    spend: "$(graph)",
    request: "$(history)",
    requests: "$(request-changes)",
    tokens: "$(symbol-numeric)",
    subscription: "$(calendar)",
    credits: "$(credit-card)",
    autotopup: "$(sync)",
    warning: "$(warning)",
    empty: "$(circle-slash)",
  }[row.kind];
  return {
    label: `${icon} ${row.label}`,
    description: row.description,
    detail: row.detail,
    alwaysShow: true,
  };
}
