-- Consumer-side fixture for isolated tests, not a production schema migration.
-- Writers own the production tables; keep the queried columns/types compatible.
CREATE DATABASE gramstat;
CREATE TABLE gramstat.validator_stake_rounds (
    utime_since UInt32, utime_until UInt32, election_id Nullable(UInt32),
    submitted_nanogram Nullable(Decimal(38,0)), selected_nanogram Nullable(Decimal(38,0)),
    remaining_nanogram Nullable(Decimal(38,0)), unfreeze_utime Nullable(UInt32),
    config34_hash String, roster_digest String, status String, calculated_at DateTime64(6,'UTC'),
    reward_nanogram Nullable(Decimal(38,0)), calc_version String,
    apr_percent Nullable(Decimal(76,12)), apr_cycle_seconds Nullable(UInt32),
    apr_next_utime_until Nullable(UInt32), apr_next_config34_hash Nullable(String),
    apr_next_roster_digest Nullable(String), apr_status String
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
CREATE TABLE gramstat.accounts_hourly (
    hour DateTime('UTC'), first_mc UInt32, last_mc UInt32, first_utime UInt32, last_utime UInt32,
    opening_uninit UInt64, opening_active UInt64, opening_frozen UInt64,
    uninit UInt64, active UInt64, frozen UInt64, mc_count UInt32,
    source_mc_to UInt32, baseline_id String, calculated_at DateTime64(6,'UTC')
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY hour;
CREATE TABLE gramstat.inflation_hourly (
    point_at DateTime('UTC'), window_from DateTime('UTC'),
    minted_24h_nanoton Nullable(Decimal(38,0)), burned_24h_nanoton Nullable(Decimal(38,0)),
    supply_nanoton Nullable(Decimal(38,0)), supply_utime UInt32, supply_mc UInt32,
    annualized_percent Nullable(Decimal(38,12)), source_mc_to UInt32, calculated_at DateTime64(6,'UTC')
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY point_at;
CREATE TABLE gramstat.supply_hourly (
    hour DateTime('UTC'), first_mc UInt32, last_mc UInt32,
    first_utime UInt32, last_utime UInt32,
    opening_burn Nullable(Decimal(38,0)), cumulative_burn Nullable(Decimal(38,0)),
    supply_nanoton Nullable(Decimal(38,0)), mc_count UInt32,
    is_partial UInt8, source_mc_to UInt32, calculated_at DateTime64(6,'UTC')
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY hour;
CREATE TABLE gramstat.chain_daily_full (
    day Date, transactions UInt64,
    fees_nanoton Nullable(Decimal(38,0)), minted_nanoton Nullable(Decimal(38,0)),
    burned_nanoton Nullable(Decimal(38,0)), supply_nanoton Nullable(Decimal(38,0)),
    supply_utime Nullable(UInt32), is_partial UInt8,
    source_mc_from UInt32, source_mc_to UInt32, source_id String,
    calculated_at DateTime64(6, 'UTC')
) ENGINE = ReplacingMergeTree(calculated_at) ORDER BY day;
CREATE TABLE gramstat.daily_metrics (
    metric LowCardinality(String), day Date, value UInt64,
    calculated_at DateTime64(6, 'UTC'), data_through DateTime('UTC'),
    source_mc_seqno UInt32, is_partial UInt8,
    amount_nanoton Nullable(Decimal(38,0)), breakdown Map(String, UInt64)
) ENGINE = ReplacingMergeTree(calculated_at) ORDER BY (metric, day);
CREATE TABLE gramstat.telegram_stars_daily (
    day Date, purchases UInt64, unknown_purchases UInt64,
    known_stars_total Decimal(38,0), stars_total Nullable(Decimal(38,0)),
    calculated_at DateTime64(6, 'UTC'), data_through DateTime('UTC'),
    source_mc_seqno UInt32, is_partial UInt8
) ENGINE = ReplacingMergeTree(calculated_at) ORDER BY day;
CREATE TABLE gramstat.validator_rounds (
    utime_since UInt32, utime_until UInt32, total UInt16,
    config34_hash String, roster_digest String,
    calculated_at DateTime64(6, 'UTC'), data_through UInt32, is_partial UInt8
) ENGINE = ReplacingMergeTree(calculated_at) ORDER BY utime_since;
CREATE TABLE gramstat.validator_geo_rounds (
    utime_since UInt32, utime_until UInt32, config34_hash String, roster_digest String,
    total UInt16, located UInt16, country_known UInt16, unknown UInt16,
    countries Nullable(UInt16), breakdown Map(String, UInt16),
    calculated_at DateTime64(6, 'UTC'), data_through UInt32, status LowCardinality(String),
    members Array(Tuple(
        pubkey String, adnl_addr String, observed_at Nullable(UInt32), record_id Nullable(String),
        country Nullable(String), city Nullable(String), latitude Nullable(Float64), longitude Nullable(Float64),
        samples UInt64, ip_versions UInt32, country_versions UInt32, ordering_conflicts UInt32, status String
    ))
) ENGINE = ReplacingMergeTree(calculated_at) ORDER BY utime_since;
