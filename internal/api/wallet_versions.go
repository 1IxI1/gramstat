package api

import (
	"fmt"
	"strconv"
	"strings"
)

const walletVersions = "wallet_v1r1 wallet_v1r2 wallet_v1r3 wallet_v2r1 wallet_v2r2 wallet_v3r1 wallet_v3r2 wallet_v4r1 wallet_v4r2 wallet_v5_beta wallet_v5r1 wallet_highload_v1r1 wallet_highload_v1r2 wallet_highload_v2 wallet_highload_v2r1 wallet_highload_v2r2 wallet_highload_v3r1 wallet_tg"

func validateActivationVersions(total string, versions map[string]string) error {
	if len(versions) == 0 {
		return nil // Legacy publication: unknown breakdown, never eighteen zeros.
	}
	expected, err := strconv.ParseUint(total, 10, 64)
	if err != nil || len(versions) != 18 {
		return fmt.Errorf("invalid wallet activation breakdown")
	}
	var sum uint64
	for _, key := range strings.Fields(walletVersions) {
		n, err := strconv.ParseUint(versions[key], 10, 64)
		if err != nil || n > expected-sum {
			return fmt.Errorf("invalid wallet activation version %s", key)
		}
		sum += n
	}
	if sum != expected {
		return fmt.Errorf("wallet activation versions disagree with total")
	}
	return nil
}
