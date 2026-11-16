-- Existing gramstat_api user; credentials and HOST IP are managed out of band.
-- readonly=1 makes limits immutable to the API credential.
ALTER USER gramstat_api DEFAULT ROLE NONE;
ALTER USER gramstat_api SETTINGS
    readonly = 1,
    allow_ddl = 0,
    allow_introspection_functions = 0,
    allow_get_client_http_header = 0,
    max_execution_time = 10,
    max_threads = 2,
    max_memory_usage = 268435456,
    max_memory_usage_for_user = 1073741824,
    max_temporary_data_on_disk_size_for_user = 268435456,
    max_result_rows = 20000,
    max_result_bytes = 4194304,
    result_overflow_mode = 'throw',
    max_rows_to_read = 2000000,
    read_overflow_mode = 'throw',
    join_use_nulls = 1,
    output_format_json_quote_64bit_integers = 1,
    max_concurrent_queries_for_user = 8;
