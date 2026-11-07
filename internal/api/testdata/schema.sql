-- Consumer-side fixture for isolated tests, not a production schema migration.
-- Writers own the production tables; keep the queried columns/types compatible.
CREATE DATABASE gramstat;
CREATE TABLE gramstat.chain_daily (
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
