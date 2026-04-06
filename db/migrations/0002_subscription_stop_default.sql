alter table subscriptions
  alter column stop_after_current_period set default false;

update subscriptions
set stop_after_current_period = false
where stop_after_current_period = true
  and canceled_at is null
  and local_status not in ('future_charges_stopped', 'cancelled')
  and coalesce(mollie_status, '') not in ('canceled', 'completed');
