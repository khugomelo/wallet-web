-- Speeds up the cross-wallet income lookups used by "split by income" (settlements, export,
-- expense form, reports): incomes filtered by received_by_member_id across all wallets.
CREATE INDEX IF NOT EXISTS idx_transactions_income_received_by_date
  ON public.transactions (received_by_member_id, date)
  WHERE type = 'income';
