export type Branch = {
  id: number;
  name: string;
  code: string;
};

export type ProductionRoom = {
  id: number;
  name: string;
  branch_id: number;
  branch_name?: string;
  branch_code?: string;
};

export type Truck = {
  id: number;
  truck_no: string;
  note?: string | null;
  created_at?: string;
};

export type StockBatch = {
  scan_id?: number | null;
  stock_id: number;
  batch_no?: string | null;
  expiry_date?: string | null;
  mfg_date?: string | null;
  rack_no?: string | null;
  shelf_no?: string | null;
  branch_id?: number | null;
  branch_name?: string | null;
  flavour?: string | null;
  branch_code?: string | null;
};

export type TransferRequest = {
  id: number;
  quantity: number;
  requested_by?: number | null;
  requested_by_name?: string | null;
  source_branch_id?: number | null;
  source_branch_name?: string | null;
  source_branch_code?: string | null;
  destination_type?: string | null;
  destination_branch_id?: number | null;
  destination_branch_name?: string | null;
  destination_branch_code?: string | null;
  production_room_id?: number | null;
  production_room_name?: string | null;
  production_room_branch_id?: number | null;
  production_branch_name?: string | null;
  truck_id?: number | null;
  truck_no?: string | null;
  truck_note?: string | null;
  status?: string | null;
  receipt_status?: string | null;
  received_at?: string | null;
  received_by_name?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  production_stock_count?: number;
  stock_items?: StockBatch[];
  stock_count?: number;
};

export const TRANSFER_STATUSES = ["submitted", "completed"] as const;

export function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-IN");
}

export function statusLabel(status?: string | null) {
  const s = (status || "submitted").toLowerCase();
  if (s === "submitted" || s === "pending") return "Submitted";
  if (s === "completed") return "Completed";
  if (s === "received") return "Received";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function statusBadgeVariant(
  status?: string | null
): "default" | "secondary" | "outline" | "success" | "warning" | "destructive" {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "received") return "success";
  if (s === "submitted" || s === "pending") return "warning";
  return "secondary";
}

export function destinationLabel(req: TransferRequest) {
  if (req.destination_type === "branch") {
    return req.destination_branch_name || "—";
  }
  return req.production_room_name || "—";
}

export function truckLabel(req: {
  truck_id?: number | null;
  truck_no?: string | null;
  truck_note?: string | null;
}) {
  if (!req.truck_no) return "—";
  const prefix = req.truck_id ? `${req.truck_id} - ` : "";
  const note = req.truck_note ? ` (${req.truck_note})` : "";
  return `${prefix}${req.truck_no}${note}`;
}
