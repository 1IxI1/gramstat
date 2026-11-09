CREATE TABLE gramstat.validator_stake_changes (
 utime_since UInt32, utime_until UInt32, config34_hash String, roster_digest String,
 previous_utime_since UInt32, middle_utime_since UInt32,
 previous_config34_hash String, previous_roster_digest String,
 middle_config34_hash String, middle_roster_digest String,
 current_selected_nanogram Nullable(Decimal(38,0)), previous_selected_nanogram Nullable(Decimal(38,0)),
 previous_remaining_nanogram Nullable(Decimal(38,0)), previous_reward_nanogram Nullable(Decimal(38,0)), result_mc Nullable(UInt32),
 previous_holders Nullable(UInt32),current_holders Nullable(UInt32),matched Nullable(UInt32),new_holders Nullable(UInt32),exited_holders Nullable(UInt32),
 near_reward Nullable(UInt32),below_reward Nullable(UInt32),above_reward Nullable(UInt32),unchanged Nullable(UInt32),decreased Nullable(UInt32),
 status String,calc_version String,calculated_at DateTime64(6,'UTC')
) ENGINE=ReplacingMergeTree(calculated_at) ORDER BY utime_since;
