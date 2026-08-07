import { z } from "zod";

export const userSchema = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string(),
  role: z.string(),
  branch_id: z.number().nullable().optional(),
  branch_name: z.string().optional().nullable(),
  branch_code: z.string().optional().nullable(),
  permissions: z.array(z.string()).default([]),
  email: z.string().optional().nullable(),
  active: z.union([z.number(), z.boolean()]).optional(),
});

export type AuthUser = z.infer<typeof userSchema>;

export const authCheckSchema = z.object({
  authenticated: z.boolean(),
  user_id: z.number().optional(),
  username: z.string().optional(),
  role: z.string().optional(),
  branch_id: z.number().nullable().optional(),
  permissions: z.array(z.string()).default([]),
});

export const loginMethodSchema = z.object({
  success: z.boolean(),
  username: z.string().optional(),
  role: z.string().optional(),
  masked_email: z.string().nullable().optional(),
  allow_password: z.boolean().optional(),
  allow_otp: z.boolean().optional(),
  error: z.string().optional(),
});

export const apiSuccessSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export const branchSchema = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  created_at: z.string().optional(),
});

export type Branch = z.infer<typeof branchSchema>;

export const scanRecordSchema = z.object({
  id: z.number().optional(),
  batchNo: z.string().nullable().optional(),
  batch_no: z.string().nullable().optional(),
  mfgDate: z.string().nullable().optional(),
  mfg_date: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  flavour: z.string().nullable().optional(),
  rackNo: z.string().nullable().optional(),
  rack_no: z.string().nullable().optional(),
  shelfNo: z.string().nullable().optional(),
  shelf_no: z.string().nullable().optional(),
  movement: z.string().optional(),
  timestamp: z.string().optional(),
  synced_by: z.string().optional(),
  branch_id: z.number().nullable().optional(),
});

export type ScanRecord = z.infer<typeof scanRecordSchema>;
