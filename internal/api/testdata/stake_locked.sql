CREATE TABLE gramstat.validator_stake_locked_rounds (
 utime_since UInt32,utime_until UInt32,previous_utime_since UInt32,
 config34_hash String,roster_digest String,previous_config34_hash String,previous_roster_digest String,
 current_selected_nanogram Nullable(Decimal(38,0)),previous_selected_nanogram Nullable(Decimal(38,0)),
 total_nanogram Nullable(Decimal(38,0)),telegram_nanogram Nullable(Decimal(38,0)),
 pools_nanogram Nullable(Decimal(38,0)),others_nanogram Nullable(Decimal(38,0)),
 pool_breakdown Map(String,Decimal(38,0)),positions UInt32,typed_positions UInt32,isp_observed_positions UInt32,
 data_through UInt32,is_partial UInt8,status String,calc_version String,calculated_at DateTime64(6,'UTC')
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
