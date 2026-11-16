-- Run as a ClickHouse access administrator AFTER creating gramstat_api with a
-- strong password and HOST IP '<API server IPv4>'. No role memberships.
-- Reconcile existing grants separately: GRANT does not remove older privileges.
-- No wildcard database grants, writes, system-table or external-source grants.
GRANT SELECT ON gramstat.account_code_hash_counts TO gramstat_api;
GRANT SELECT ON gramstat.account_code_hash_snapshots TO gramstat_api;
GRANT SELECT ON gramstat.account_type_feature_sets TO gramstat_api;
GRANT SELECT ON gramstat.account_type_features TO gramstat_api;
GRANT SELECT ON gramstat.account_type_snapshots TO gramstat_api;
GRANT SELECT ON gramstat.accounts_hourly TO gramstat_api;
GRANT SELECT ON gramstat.chain_daily_full TO gramstat_api;
GRANT SELECT ON gramstat.daily_metrics TO gramstat_api;
GRANT SELECT ON gramstat.inflation_hourly TO gramstat_api;
GRANT SELECT ON gramstat.supply_hourly TO gramstat_api;
GRANT SELECT ON gramstat.telegram_stars_daily TO gramstat_api;
GRANT SELECT ON gramstat.validator_geo_rounds TO gramstat_api;
GRANT SELECT ON gramstat.validator_rounds TO gramstat_api;
GRANT SELECT ON gramstat.validator_stake_affiliations TO gramstat_api;
GRANT SELECT ON gramstat.validator_stake_changes TO gramstat_api;
GRANT SELECT ON gramstat.validator_stake_locked_rounds TO gramstat_api;
GRANT SELECT ON gramstat.validator_stake_rounds TO gramstat_api;
GRANT SELECT ON gramstat.wallet_activated_checkpoints TO gramstat_api;
GRANT SELECT ON gramstat.wallet_activation_stream TO gramstat_api;
GRANT SELECT ON gramstat.wallet_activation_stream_checkpoints TO gramstat_api;
GRANT SELECT ON gramstat.wallet_activation_stream_state TO gramstat_api;
GRANT SELECT ON gramstat.wallet_activations_mc TO gramstat_api;
GRANT SELECT ON gramstat.wallet_counts TO gramstat_api;
GRANT SELECT ON gramstat.wallet_days TO gramstat_api;
GRANT SELECT ON gramstat.wallet_live_days TO gramstat_api;
GRANT SELECT ON gramstat.wallet_months TO gramstat_api;
-- Per-MC aggregate deltas and supply fields preserve exact short-range charts.
GRANT SELECT(mc_seqno, gen_utime, delta_uninit, delta_active, delta_frozen)
    ON gramstat_full.account_deltas TO gramstat_api;
GRANT SELECT(workchain, shard, seqno, gen_utime, global_balance, burned)
    ON mainnet_gramstat_full.blocks TO gramstat_api;
