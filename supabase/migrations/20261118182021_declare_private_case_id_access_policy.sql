-- Recorded on the live project as version 20261118182021 (declare_private_case_id_access_policy.sql). Copied verbatim from its migration history; do not edit.
drop policy if exists vault_deny_client_access on vault_display_case_private.issued_ids;
create policy vault_deny_client_access on vault_display_case_private.issued_ids
  as restrictive for all to anon, authenticated using (false) with check (false);
