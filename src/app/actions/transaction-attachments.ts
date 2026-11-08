"use server";

/** Transaction file attachments: upload metadata and storage integration. */

import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  sanitizeStorageFileName,
  validateTransactionAttachmentFile,
} from "@/lib/transaction-attachments";
import { randomUUID } from "node:crypto";

const BUCKET = "transaction-files";

export type TransactionAttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
};

export async function uploadTransactionAttachment(
  walletId: string,
  transactionId: string,
  formData: FormData
): Promise<{ error?: string; attachment?: TransactionAttachmentRow }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file uploaded" };

  const err = validateTransactionAttachmentFile(file);
  if (err) return { error: err };

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { data: tx } = await supabase
    .from("transactions")
    .select("id, wallet_id")
    .eq("id", transactionId)
    .maybeSingle();
  if (!tx || tx.wallet_id !== walletId) return { error: "Transaction not found" };

  const safeName = sanitizeStorageFileName(file.name);
  const path = `${walletId}/${transactionId}/${randomUUID()}_${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) return { error: upErr.message };

  const { data: row, error: insErr } = await supabase
    .from("transaction_attachments")
    .insert({
      transaction_id: transactionId,
      storage_path: path,
      file_name: file.name.slice(0, 255),
      mime_type: file.type || null,
      size_bytes: file.size,
      created_by: user.id,
    })
    .select("id, file_name, mime_type, size_bytes")
    .single();

  if (insErr || !row) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: insErr?.message ?? "Failed to save attachment" };
  }

  return {
    attachment: {
      id: row.id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    },
  };
}

export async function deleteTransactionAttachment(attachmentId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { data: row } = await supabase
    .from("transaction_attachments")
    .select("id, storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { error: "Attachment not found" };

  const { error: delSt } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (delSt) return { error: delSt.message };

  const { error: delDb } = await supabase.from("transaction_attachments").delete().eq("id", attachmentId);
  if (delDb) return { error: delDb.message };
  return {};
}

export async function getTransactionAttachmentSignedUrl(
  attachmentId: string
): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated" };

  const { data: row } = await supabase
    .from("transaction_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!row) return { error: "Attachment not found" };

  const { data: signed, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 3600);
  if (error || !signed?.signedUrl) return { error: error?.message ?? "Could not create link" };
  return { url: signed.signedUrl };
}
