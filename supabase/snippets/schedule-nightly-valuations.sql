-- Schedules the nightly-valuations Edge Function. Run once in the SQL editor
-- after deploying the function (docs/nightly-valuations.md). Not a migration:
-- it needs your project URL and a secret you generate, which must not be committed.
--
-- 1. Replace both placeholders below.
-- 2. Run the whole file. Running it again updates the secrets and the schedule.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the endpoint and shared secret in Supabase Vault, not in the cron job text.
do $$
declare
  url text := 'https://<project-ref>.supabase.co/functions/v1/nightly-valuations';
  secret text := '<the same value as the NIGHTLY_VALUATIONS_SECRET function secret>';
begin
  if url like '%<%' or secret like '%<%' then
    raise exception 'Replace the placeholders before running this file.';
  end if;
  perform vault.update_secret(id, url) from vault.secrets where name = 'nightly_valuations_url';
  if not found then perform vault.create_secret(url, 'nightly_valuations_url'); end if;
  perform vault.update_secret(id, secret) from vault.secrets where name = 'nightly_valuations_secret';
  if not found then perform vault.create_secret(secret, 'nightly_valuations_secret'); end if;
end
$$;

-- 09:17 UTC is about 1–2am in US Pacific time. Snapshots are dated in UTC,
-- matching the browser.
select cron.schedule(
  'nightly-valuations',
  '17 9 * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'nightly_valuations_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-vault-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nightly_valuations_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);

-- To check recent runs:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'nightly-valuations') order by start_time desc limit 5;
-- To stop:
--   select cron.unschedule('nightly-valuations');
