-- Trigger-only SECURITY DEFINER functions must not be callable through RPC.
revoke all on function public.refresh_product_translation_snapshots() from public, anon, authenticated;
revoke all on function public.refresh_unit_translation_snapshots() from public, anon, authenticated;
revoke all on function public.refresh_measurement_translation_snapshots() from public, anon, authenticated;
