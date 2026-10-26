package model

import (
	"context"
	"fmt"
	"math/big"
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
		Select("kind", "cny_amount_minor").
		Where("occurred_at >= ? AND occurred_at < ?", window.StartAt, window.EndBefore).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := &BeaconCashSummary{Range: window, BaseCurrency: "CNY", BusinessTimezone: "Asia/Shanghai"}
	var receipt, refund, reversal, net big.Int
	for rows.Next() {
		var kind string
		var cents int64
		if err := rows.Scan(&kind, &cents); err != nil {
			return nil, err
		}
		amount := big.NewInt(cents)
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
	return result, nil
}
