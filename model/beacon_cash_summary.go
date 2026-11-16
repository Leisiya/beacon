package model

import (
	"context"
	"fmt"
	"maps"
	"math/big"
	"slices"
	"time"
)

// Dates are calendar dates in the business timezone, never the browser's zone.
// All ledger dates are after 2000, when Shanghai has a fixed UTC+08 offset.
type BeaconCashRange struct {
	Period    string `json:"period"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	StartAt   int64  `json:"start_at"`
	EndBefore int64  `json:"end_before"`
	AsOf      int64  `json:"as_of"`
}

func ResolveBeaconCashRange(period, startDate, endDate string, now time.Time) (BeaconCashRange, error) {
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	now = now.In(zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
	start, end := today, today
	switch period {
	case "today":
	case "month":
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, zone)
	case "all":
		start = time.Date(2000, 1, 1, 0, 0, 0, 0, zone)
	case "custom":
		var err error
		start, err = time.ParseInLocation(time.DateOnly, startDate, zone)
		if err != nil || start.Format(time.DateOnly) != startDate || start.Year() < 2000 {
			return BeaconCashRange{}, ErrBeaconLedgerInput
		}
		end, err = time.ParseInLocation(time.DateOnly, endDate, zone)
		if err != nil || end.Format(time.DateOnly) != endDate || end.Before(start) || end.After(today) {
			return BeaconCashRange{}, ErrBeaconLedgerInput
		}
	default:
		return BeaconCashRange{}, ErrBeaconLedgerInput
	}
	return BeaconCashRange{
		Period: period, StartDate: start.Format(time.DateOnly), EndDate: end.Format(time.DateOnly),
		StartAt: start.Unix(), EndBefore: min(end.AddDate(0, 0, 1).Unix(), now.Unix()+1), AsOf: now.Unix(),
	}, nil
}

// Totals are decimal strings in integer CNY cents. Even individually safe
// ledger rows can sum beyond int64 or JavaScript's exact-number range.
type BeaconCashSummary struct {
	Range            BeaconCashRange `json:"range"`
	BaseCurrency     string          `json:"base_currency"`
	BusinessTimezone string          `json:"business_timezone"`
	ReceiptMinor     string          `json:"receipt_minor"`
	RefundMinor      string          `json:"refund_minor"`
	ReversalMinor    string          `json:"reversal_minor"`
	NetMinor         string          `json:"net_minor"`
	EntryCount       int64           `json:"entry_count"`
	GiftCount        int64           `json:"gift_count"`
	// Quota totals are decimal strings like the cash totals. Corrections are
	// negative. Usage is consume logs minus refund logs created in the range.
	ReceiptQuota    string `json:"receipt_quota"`
	GiftQuota       string `json:"gift_quota"`
	CorrectionQuota string `json:"correction_quota"`
	UsageQuota      string `json:"usage_quota"`
}

// One SELECT supplies a consistent statement snapshot. Streaming avoids loading
// the full ledger or using dialect-dependent SUM overflow/decimal behavior.
// Corrections stay in their own occurrence period; originals are not removed.
func GetBeaconCashSummary(ctx context.Context, period, startDate, endDate string, now time.Time) (*BeaconCashSummary, error) {
	window, err := ResolveBeaconCashRange(period, startDate, endDate, now)
	if err != nil {
		return nil, err
	}
	rows, err := DB.WithContext(ctx).Model(&BeaconLedgerEntry{}).
		Select("kind", "cny_amount_minor", "quota_delta").
		Where("occurred_at >= ? AND occurred_at < ?", window.StartAt, window.EndBefore).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := &BeaconCashSummary{Range: window, BaseCurrency: "CNY", BusinessTimezone: "Asia/Shanghai"}
	var receipt, refund, reversal, net big.Int
	var receiptQuota, giftQuota, correctionQuota big.Int
	for rows.Next() {
		var kind string
		var cents, quota int64
		if err := rows.Scan(&kind, &cents, &quota); err != nil {
			return nil, err
		}
		amount := big.NewInt(cents)
		switch kind {
		case BeaconReceipt:
			receiptQuota.Add(&receiptQuota, big.NewInt(quota))
		case BeaconGift:
			giftQuota.Add(&giftQuota, big.NewInt(quota))
		default:
			correctionQuota.Add(&correctionQuota, big.NewInt(quota))
		}
		switch kind {
		case BeaconReceipt:
			if cents <= 0 {
				return nil, fmt.Errorf("invalid cash receipt in ledger")
			}
			receipt.Add(&receipt, amount)
		case BeaconRefund:
			if cents >= 0 {
				return nil, fmt.Errorf("invalid cash refund in ledger")
			}
			refund.Sub(&refund, amount)
		case BeaconReversal:
			if cents > 0 {
				return nil, fmt.Errorf("invalid cash reversal in ledger")
			}
			reversal.Add(&reversal, amount)
		case BeaconGift:
			if cents != 0 {
				return nil, fmt.Errorf("invalid cash gift in ledger")
			}
			result.GiftCount++
		default:
			return nil, fmt.Errorf("unknown entry kind in cash ledger")
		}
		net.Add(&net, amount)
		result.EntryCount++
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result.ReceiptMinor, result.RefundMinor = receipt.String(), refund.String()
	result.ReversalMinor, result.NetMinor = reversal.String(), net.String()
	result.ReceiptQuota, result.GiftQuota = receiptQuota.String(), giftQuota.String()
	result.CorrectionQuota = correctionQuota.String()

	var usage []struct {
		Type  int
		Quota int64
	}
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Select("type, COALESCE(SUM(quota), 0) AS quota").
		Where("type IN ? AND created_at >= ? AND created_at < ?", []int{LogTypeConsume, LogTypeRefund}, window.StartAt, window.EndBefore).
		Group("type").Scan(&usage).Error; err != nil {
		return nil, err
	}
	var usageQuota big.Int
	for _, row := range usage {
		if row.Type == LogTypeRefund {
			usageQuota.Sub(&usageQuota, big.NewInt(row.Quota))
		} else {
			usageQuota.Add(&usageQuota, big.NewInt(row.Quota))
		}
	}
	result.UsageQuota = usageQuota.String()
	return result, nil
}

// BeaconQuotaMismatch is one account whose balance plus recorded usage differs
// from its ledger credits. In-flight requests briefly hold reserved quota.
type BeaconQuotaMismatch struct {
	UserID       int    `json:"user_id"`
	Username     string `json:"username"`
	LedgerQuota  int64  `json:"ledger_quota"`
	BalanceQuota int64  `json:"balance_quota"`
	UsedQuota    int64  `json:"used_quota"`
	Difference   int64  `json:"difference"`
}

type BeaconQuotaReconciliation struct {
	AsOf          int64                 `json:"as_of"`
	LedgerQuota   string                `json:"ledger_quota"`
	BalanceQuota  string                `json:"balance_quota"`
	UsedQuota     string                `json:"used_quota"`
	Difference    string                `json:"difference"`
	MismatchCount int                   `json:"mismatch_count"`
	Mismatches    []BeaconQuotaMismatch `json:"mismatches"`
}

const beaconMismatchLimit = 100

// GetBeaconQuotaReconciliation checks that every account's balance plus usage
// equals its ledger credits. A difference reveals quota that changed outside
// the ledger (sign-up bonus, check-in, redemption, balance purchases) or a
// request that is still holding a reservation.
func GetBeaconQuotaReconciliation(ctx context.Context, now time.Time) (*BeaconQuotaReconciliation, error) {
	credited := map[int]int64{}
	rows, err := DB.WithContext(ctx).Model(&BeaconLedgerEntry{}).Select("user_id", "quota_delta").Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ledgerTotal big.Int
	for rows.Next() {
		var userID int
		var quota int64
		if err := rows.Scan(&userID, &quota); err != nil {
			return nil, err
		}
		credited[userID] += quota
		ledgerTotal.Add(&ledgerTotal, big.NewInt(quota))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	users, err := DB.WithContext(ctx).Unscoped().Model(&User{}).Select("id", "username", "quota", "used_quota").Order("id").Rows()
	if err != nil {
		return nil, err
	}
	defer users.Close()
	result := &BeaconQuotaReconciliation{AsOf: now.Unix(), Mismatches: []BeaconQuotaMismatch{}}
	var balanceTotal, usedTotal big.Int
	for users.Next() {
		var row BeaconQuotaMismatch
		if err := users.Scan(&row.UserID, &row.Username, &row.BalanceQuota, &row.UsedQuota); err != nil {
			return nil, err
		}
		balanceTotal.Add(&balanceTotal, big.NewInt(row.BalanceQuota))
		usedTotal.Add(&usedTotal, big.NewInt(row.UsedQuota))
		row.LedgerQuota = credited[row.UserID]
		delete(credited, row.UserID)
		row.Difference = row.BalanceQuota + row.UsedQuota - row.LedgerQuota
		if row.Difference == 0 {
			continue
		}
		result.MismatchCount++
		if len(result.Mismatches) < beaconMismatchLimit {
			result.Mismatches = append(result.Mismatches, row)
		}
	}
	if err := users.Err(); err != nil {
		return nil, err
	}
	// Ledger rows for an account that no longer exists are still a mismatch.
	for _, userID := range slices.Sorted(maps.Keys(credited)) {
		quota := credited[userID]
		result.MismatchCount++
		if len(result.Mismatches) < beaconMismatchLimit {
			result.Mismatches = append(result.Mismatches, BeaconQuotaMismatch{UserID: userID, LedgerQuota: quota, Difference: -quota})
		}
	}
	var difference big.Int
	difference.Add(&balanceTotal, &usedTotal)
	difference.Sub(&difference, &ledgerTotal)
	result.LedgerQuota, result.BalanceQuota = ledgerTotal.String(), balanceTotal.String()
	result.UsedQuota, result.Difference = usedTotal.String(), difference.String()
	return result, nil
}
