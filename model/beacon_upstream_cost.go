package model

import (
	"context"
	"errors"
	"maps"
	"math"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrBeaconCostInput = errors.New("invalid upstream cost input")

const (
	// Bounds for one upstream consume record. Larger values are treated as a
	// malformed upstream response, not stored as a cost.
	beaconMaxUpstreamQuota        int64 = 1 << 40
	beaconMaxUpstreamQuotaPerUnit int64 = 1_000_000_000_000
	beaconCostMatchWindow               = 2 * 24 * 60 * 60
	beaconCostBatch                     = 500
)

// BeaconUpstreamRate is append-only. From EffectiveAt on, one unit of the
// channel's upstream credit (what the upstream shows as "$1") cost CNYPerUnit.
// A later row supersedes it; existing costs keep the rate they were priced at.
type BeaconUpstreamRate struct {
	ID          int64  `json:"id" gorm:"primaryKey"`
	ChannelID   int    `json:"channel_id" gorm:"not null;index:idx_beacon_rate_channel_at,priority:1"`
	EffectiveAt int64  `json:"effective_at" gorm:"not null;index:idx_beacon_rate_channel_at,priority:2"`
	CNYPerUnit  string `json:"cny_per_unit" gorm:"type:varchar(32);not null"`
	OperatorID  int    `json:"operator_id" gorm:"not null"`
	RecordedAt  int64  `json:"recorded_at" gorm:"not null"`
	Note        string `json:"note" gorm:"type:varchar(500);not null"`
}

// BeaconUpstreamCharge is one consume record read back from the upstream's
// own log for one channel key. The upstream quota is what the supplier
// actually deducted; the CNY cost is priced once with the rate in effect at
// OccurredAt and never recomputed. Rows without a rate stay pending.
type BeaconUpstreamCharge struct {
	ID                int64  `json:"id" gorm:"primaryKey"`
	ChannelID         int    `json:"channel_id" gorm:"not null;uniqueIndex:idx_beacon_charge_source,priority:1;index:idx_beacon_charge_channel_at,priority:1"`
	KeyFingerprint    string `json:"-" gorm:"type:varchar(16);not null;uniqueIndex:idx_beacon_charge_source,priority:2"`
	UpstreamLogID     int64  `json:"upstream_log_id" gorm:"not null;uniqueIndex:idx_beacon_charge_source,priority:3"`
	UpstreamRequestID string `json:"upstream_request_id" gorm:"type:varchar(128);not null;index"`
	OccurredAt        int64  `json:"occurred_at" gorm:"not null;index;index:idx_beacon_charge_channel_at,priority:2"`
	ModelName         string `json:"model_name" gorm:"type:varchar(128);not null"`
	UpstreamGroup     string `json:"upstream_group" gorm:"type:varchar(64);not null"`
	GroupRatio        string `json:"group_ratio" gorm:"type:varchar(32);not null"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"not null"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"not null"`
	// Cache counts as the upstream log reports them, for later review.
	CacheTokens         int   `json:"cache_tokens" gorm:"not null;default:0"`
	CacheCreationTokens int   `json:"cache_creation_tokens" gorm:"not null;default:0"`
	UpstreamQuota       int64 `json:"upstream_quota" gorm:"type:bigint;not null"`
	QuotaPerUnit        int64 `json:"quota_per_unit" gorm:"type:bigint;not null"`
	// CreditMicro is UpstreamQuota in millionths of one upstream credit unit.
	CreditMicro  int64  `json:"credit_micro" gorm:"type:bigint;not null"`
	RateID       *int64 `json:"rate_id" gorm:"index"`
	CostMicroCNY int64  `json:"cost_micro_cny" gorm:"type:bigint;not null"`
	LocalLogID   *int   `json:"local_log_id" gorm:"index"`
	UserID       int    `json:"user_id" gorm:"not null;index"`
	LocalQuota   int64  `json:"local_quota" gorm:"type:bigint;not null"`
	SyncedAt     int64  `json:"synced_at" gorm:"not null"`
	// LocalModelName is the model the customer asked for, which differs from
	// ModelName when the channel maps model names.
	LocalModelName string `json:"local_model_name" gorm:"type:varchar(128);not null;default:''"`
}

func NormalizeBeaconUpstreamRate(rate BeaconUpstreamRate, now int64) (BeaconUpstreamRate, error) {
	rate.CNYPerUnit = strings.TrimSpace(rate.CNYPerUnit)
	rate.Note = strings.TrimSpace(rate.Note)
	value, err := decimal.NewFromString(rate.CNYPerUnit)
	if err != nil || !beaconRatePattern.MatchString(rate.CNYPerUnit) || !value.IsPositive() ||
		rate.ChannelID <= 0 || rate.EffectiveAt < 946684800 || rate.EffectiveAt > now+366*24*60*60 ||
		!utf8.ValidString(rate.Note) || utf8.RuneCountInString(rate.Note) > 500 || strings.ContainsRune(rate.Note, '\x00') {
		return rate, ErrBeaconCostInput
	}
	rate.CNYPerUnit = value.String()
	return rate, nil
}

// CreateBeaconUpstreamRate stores a new rate and prices pending charges it
// now covers. Charges that already have a cost are left unchanged.
func CreateBeaconUpstreamRate(rate BeaconUpstreamRate, operatorID int, now int64) (*BeaconUpstreamRate, error) {
	rate, err := NormalizeBeaconUpstreamRate(rate, now)
	if err != nil {
		return nil, err
	}
	if err := DB.Select("id").First(&Channel{}, rate.ChannelID).Error; err != nil {
		return nil, err
	}
	rate.ID, rate.OperatorID, rate.RecordedAt = 0, operatorID, now
	if err := DB.Create(&rate).Error; err != nil {
		return nil, err
	}
	if err := PriceBeaconPendingCharges(rate.ChannelID); err != nil {
		return &rate, err
	}
	return &rate, nil
}

func ListBeaconUpstreamRates() ([]BeaconUpstreamRate, error) {
	var rates []BeaconUpstreamRate
	err := DB.Order("channel_id, effective_at DESC, id DESC").Find(&rates).Error
	return rates, err
}

func BeaconChannelIDsWithRates() ([]int, error) {
	var ids []int
	err := DB.Model(&BeaconUpstreamRate{}).Distinct("channel_id").Order("channel_id").Pluck("channel_id", &ids).Error
	return ids, err
}

// beaconRateAt returns the rate in effect at the given time from rates sorted
// by effective time and id, or nil when none applies yet.
func beaconRateAt(rates []BeaconUpstreamRate, at int64) *BeaconUpstreamRate {
	var found *BeaconUpstreamRate
	for i := range rates {
		if rates[i].EffectiveAt > at {
			break
		}
		found = &rates[i]
	}
	return found
}

func beaconCostMicroCNY(creditMicro int64, rate *BeaconUpstreamRate) (int64, bool) {
	cny, err := decimal.NewFromString(rate.CNYPerUnit)
	if err != nil || !cny.IsPositive() {
		return 0, false
	}
	cost := decimal.NewFromInt(creditMicro).Mul(cny).Round(0)
	if cost.IsNegative() || cost.GreaterThan(decimal.NewFromInt(beaconMaxMoneyMinor)) {
		return 0, false
	}
	return cost.IntPart(), true
}

func beaconChannelRates(tx *gorm.DB, channelID int) ([]BeaconUpstreamRate, error) {
	var rates []BeaconUpstreamRate
	err := tx.Where("channel_id = ?", channelID).Order("effective_at, id").Find(&rates).Error
	return rates, err
}

// PriceBeaconPendingCharges fills the cost of charges that had no rate yet.
func PriceBeaconPendingCharges(channelID int) error {
	rates, err := beaconChannelRates(DB, channelID)
	if err != nil || len(rates) == 0 {
		return err
	}
	var lastID int64
	for {
		var pending []BeaconUpstreamCharge
		if err := DB.Where("channel_id = ? AND rate_id IS NULL AND id > ? AND occurred_at >= ?", channelID, lastID, rates[0].EffectiveAt).
			Order("id").Limit(beaconCostBatch).Find(&pending).Error; err != nil {
			return err
		}
		if len(pending) == 0 {
			return nil
		}
		for _, charge := range pending {
			lastID = charge.ID
			rate := beaconRateAt(rates, charge.OccurredAt)
			if rate == nil {
				continue
			}
			cost, ok := beaconCostMicroCNY(charge.CreditMicro, rate)
			if !ok {
				continue
			}
			if err := DB.Model(&BeaconUpstreamCharge{}).Where("id = ? AND rate_id IS NULL", charge.ID).
				Updates(map[string]any{"rate_id": rate.ID, "cost_micro_cny": cost}).Error; err != nil {
				return err
			}
		}
	}
}

// BeaconUpstreamRecord is one consume entry as reported by the upstream,
// including the pricing fields of its log so the supplier's price can be
// reconstructed (see beacon_upstream_price.go).
type BeaconUpstreamRecord struct {
	LogID               int64
	RequestID           string
	OccurredAt          int64
	ModelName           string
	Group               string
	GroupRatio          string
	PromptTokens        int
	CompletionTokens    int
	CacheTokens         int
	CacheCreationTokens int
	Quota               int64
	Pricing             BeaconUpstreamPricing
}

func truncateRunes(value string, limit int) string {
	value = strings.ToValidUTF8(strings.ReplaceAll(value, "\x00", ""), "")
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	return string([]rune(value)[:limit])
}

// StoreBeaconUpstreamCharges inserts records not seen before, prices them and
// links them to local consume logs. It returns how many rows were new.
func StoreBeaconUpstreamCharges(channelID int, keyFingerprint string, quotaPerUnit int64, records []BeaconUpstreamRecord, now int64) (int, error) {
	if quotaPerUnit <= 0 || quotaPerUnit > beaconMaxUpstreamQuotaPerUnit {
		return 0, ErrBeaconCostInput
	}
	rates, err := beaconChannelRates(DB, channelID)
	if err != nil {
		return 0, err
	}
	// Each sync re-reads the upstream's latest page; only unseen records may
	// add to the observed price statistics.
	seen := map[int64]bool{}
	for chunk := range slices.Chunk(records, beaconCostBatch) {
		ids := make([]int64, 0, len(chunk))
		for _, record := range chunk {
			ids = append(ids, record.LogID)
		}
		var existing []int64
		if err := DB.Model(&BeaconUpstreamCharge{}).Where("channel_id = ? AND key_fingerprint = ? AND upstream_log_id IN ?", channelID, keyFingerprint, ids).
			Pluck("upstream_log_id", &existing).Error; err != nil {
			return 0, err
		}
		for _, id := range existing {
			seen[id] = true
		}
	}
	charges := make([]BeaconUpstreamCharge, 0, len(records))
	fresh := make([]BeaconUpstreamRecord, 0, len(records))
	for _, record := range records {
		if record.LogID <= 0 || record.Quota < 0 || record.Quota > beaconMaxUpstreamQuota || record.OccurredAt <= 0 || seen[record.LogID] {
			continue
		}
		seen[record.LogID] = true
		fresh = append(fresh, record)
		credit := decimal.NewFromInt(record.Quota).Shift(6).Div(decimal.NewFromInt(quotaPerUnit)).Round(0).IntPart()
		charge := BeaconUpstreamCharge{
			ChannelID: channelID, KeyFingerprint: keyFingerprint, UpstreamLogID: record.LogID,
			UpstreamRequestID: truncateRunes(record.RequestID, 128), OccurredAt: record.OccurredAt,
			ModelName: truncateRunes(record.ModelName, 128), UpstreamGroup: truncateRunes(record.Group, 64),
			GroupRatio: truncateRunes(record.GroupRatio, 32), PromptTokens: max(record.PromptTokens, 0),
			CompletionTokens: max(record.CompletionTokens, 0), CacheTokens: max(record.CacheTokens, 0),
			CacheCreationTokens: max(record.CacheCreationTokens, 0), UpstreamQuota: record.Quota,
			QuotaPerUnit: quotaPerUnit, CreditMicro: credit, SyncedAt: now,
		}
		if rate := beaconRateAt(rates, record.OccurredAt); rate != nil {
			if cost, ok := beaconCostMicroCNY(credit, rate); ok {
				charge.RateID, charge.CostMicroCNY = &rate.ID, cost
			}
		}
		charges = append(charges, charge)
	}
	inserted := 0
	for chunk := range slices.Chunk(charges, 100) {
		result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk)
		if result.Error != nil {
			return inserted, result.Error
		}
		inserted += int(result.RowsAffected)
	}
	if err := recordBeaconUpstreamPrices(channelID, quotaPerUnit, fresh); err != nil {
		return inserted, err
	}
	return inserted, MatchBeaconUpstreamCharges(channelID, now)
}

// MatchBeaconUpstreamCharges links recent unmatched charges to the local
// consume log that carries the same upstream request id.
func MatchBeaconUpstreamCharges(channelID int, now int64) error {
	var lastID int64
	for {
		var pending []BeaconUpstreamCharge
		if err := DB.Select("id", "upstream_request_id").
			Where("channel_id = ? AND local_log_id IS NULL AND upstream_request_id <> '' AND occurred_at >= ? AND id > ?", channelID, now-beaconCostMatchWindow, lastID).
			Order("id").Limit(beaconCostBatch).Find(&pending).Error; err != nil {
			return err
		}
		if len(pending) == 0 {
			return nil
		}
		lastID = pending[len(pending)-1].ID
		ids := make([]string, 0, len(pending))
		for _, charge := range pending {
			ids = append(ids, charge.UpstreamRequestID)
		}
		var logs []Log
		if err := LOG_DB.Select("id", "user_id", "quota", "model_name", "upstream_request_id").
			Where("type = ? AND channel_id = ? AND upstream_request_id IN ?", LogTypeConsume, channelID, ids).
			Find(&logs).Error; err != nil {
			return err
		}
		byRequest := make(map[string]Log, len(logs))
		for _, log := range logs {
			byRequest[log.UpstreamRequestId] = log
		}
		for _, charge := range pending {
			log, ok := byRequest[charge.UpstreamRequestID]
			if !ok {
				continue
			}
			if err := DB.Model(&BeaconUpstreamCharge{}).Where("id = ? AND local_log_id IS NULL", charge.ID).
				Updates(map[string]any{"local_log_id": log.Id, "user_id": log.UserId, "local_quota": int64(log.Quota), "local_model_name": truncateRunes(log.ModelName, 128)}).Error; err != nil {
				return err
			}
		}
	}
}

// BeaconProfitRow sets what customers were charged against what suppliers
// deducted for the same requests. Quota is in quota units and money in
// millionths of CNY, both as decimal strings so totals stay exact.
type BeaconProfitRow struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Local consume logs; refunds are subtracted from the quota.
	Requests      int64  `json:"requests"`
	UsageQuota    string `json:"usage_quota"`
	UsageMicroCNY string `json:"usage_micro_cny"`
	// Requests whose upstream deduction is synced and priced.
	CostedRequests int64  `json:"costed_requests"`
	CostedMicroCNY string `json:"costed_micro_cny"`
	CostMicroCNY   string `json:"cost_micro_cny"`
	// Priced upstream deductions with no request in the local logs.
	UnmatchedRequests     int64  `json:"unmatched_requests"`
	UnmatchedCostMicroCNY string `json:"unmatched_cost_micro_cny"`
	// Upstream deductions without a CNY rate yet; their cost is unknown.
	PendingRequests int64 `json:"pending_requests"`
	// Costed customer charges minus their cost and the unmatched cost.
	ProfitMicroCNY string `json:"profit_micro_cny"`
}

// BeaconProfitSummary values customer charges at the top-up price, so it is
// an estimate: gifts and receipt discounts are not separated.
type BeaconProfitSummary struct {
	Range               BeaconCashRange   `json:"range"`
	GroupBy             string            `json:"group_by"`
	ReferenceCNYPerUnit float64           `json:"reference_cny_per_unit"`
	Total               BeaconProfitRow   `json:"total"`
	Rows                []BeaconProfitRow `json:"rows"`
}

type beaconProfitAccumulator struct {
	row                                     BeaconProfitRow
	usage, costedQuota, cost, unmatchedCost big.Int
}

func (acc *beaconProfitAccumulator) addUsage(logType int, requests, quota int64) {
	if logType == LogTypeRefund {
		acc.usage.Sub(&acc.usage, big.NewInt(quota))
		return
	}
	acc.row.Requests += requests
	acc.usage.Add(&acc.usage, big.NewInt(quota))
}

// addCharge counts a matched request's customer charge only with the first
// deduction matched to it; every deduction still adds its cost.
func (acc *beaconProfitAccumulator) addCharge(charge *BeaconUpstreamCharge, firstForRequest bool) {
	switch {
	case charge.RateID == nil:
		acc.row.PendingRequests++
	case charge.LocalLogID == nil:
		acc.row.UnmatchedRequests++
		acc.unmatchedCost.Add(&acc.unmatchedCost, big.NewInt(charge.CostMicroCNY))
	default:
		acc.cost.Add(&acc.cost, big.NewInt(charge.CostMicroCNY))
		if firstForRequest {
			acc.row.CostedRequests++
			acc.costedQuota.Add(&acc.costedQuota, big.NewInt(charge.LocalQuota))
		}
	}
}

// result converts quota with microCNYPerQuota, the top-up price in millionths
// of CNY per quota unit.
func (acc *beaconProfitAccumulator) result(microCNYPerQuota decimal.Decimal) BeaconProfitRow {
	row := acc.row
	usage := decimal.NewFromBigInt(&acc.usage, 0).Mul(microCNYPerQuota).Round(0).BigInt()
	costed := decimal.NewFromBigInt(&acc.costedQuota, 0).Mul(microCNYPerQuota).Round(0).BigInt()
	profit := new(big.Int).Sub(costed, &acc.cost)
	profit.Sub(profit, &acc.unmatchedCost)
	row.UsageQuota, row.UsageMicroCNY = acc.usage.String(), usage.String()
	row.CostedMicroCNY, row.CostMicroCNY = costed.String(), acc.cost.String()
	row.UnmatchedCostMicroCNY, row.ProfitMicroCNY = acc.unmatchedCost.String(), profit.String()
	return row
}

// beaconUsageGroupColumns groups local consume logs; a day starts at
// midnight Asia/Shanghai.
var beaconUsageGroupColumns = map[string]string{
	"channel": "channel_id",
	"model":   "model_name",
	"user":    "user_id",
	"day":     "created_at - (created_at + 28800) % 86400",
}

// GetBeaconProfitSummary joins local consume logs with synced upstream
// charges. A charge counts toward the model the customer asked for, and an
// unmatched charge counts toward user 0.
func GetBeaconProfitSummary(ctx context.Context, period, startDate, endDate, groupBy string, now time.Time) (*BeaconProfitSummary, error) {
	window, err := ResolveBeaconCashRange(period, startDate, endDate, now)
	if err != nil {
		return nil, err
	}
	keyColumn, ok := beaconUsageGroupColumns[groupBy]
	if !ok {
		return nil, ErrBeaconCostInput
	}
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	var total beaconProfitAccumulator
	groups := map[string]*beaconProfitAccumulator{}
	group := func(key string) *beaconProfitAccumulator {
		acc := groups[key]
		if acc == nil {
			acc = &beaconProfitAccumulator{row: BeaconProfitRow{Key: key, Label: key}}
			groups[key] = acc
		}
		return acc
	}

	var usage []struct {
		GroupKey string
		Type     int
		Requests int64
		Quota    int64
	}
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select(keyColumn+" AS group_key, type, COUNT(*) AS requests, COALESCE(SUM(quota), 0) AS quota").
		Where("type IN ? AND created_at >= ? AND created_at < ?", []int{LogTypeConsume, LogTypeRefund}, window.StartAt, window.EndBefore).
		Group(keyColumn + ", type").Scan(&usage).Error; err != nil {
		return nil, err
	}
	for _, row := range usage {
		key := row.GroupKey
		if groupBy == "day" {
			dayStart, err := strconv.ParseInt(key, 10, 64)
			if err != nil {
				return nil, err
			}
			key = time.Unix(dayStart, 0).In(zone).Format(time.DateOnly)
		}
		group(key).addUsage(row.Type, row.Requests, row.Quota)
		total.addUsage(row.Type, row.Requests, row.Quota)
	}

	rows, err := DB.WithContext(ctx).Model(&BeaconUpstreamCharge{}).
		Select("channel_id", "model_name", "local_model_name", "occurred_at", "user_id", "rate_id", "cost_micro_cny", "local_log_id", "local_quota").
		Where("occurred_at >= ? AND occurred_at < ?", window.StartAt, window.EndBefore).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	// An upstream can log one request more than once; each local request's
	// customer charge is counted once.
	costedLogs := map[int]bool{}
	for rows.Next() {
		var charge BeaconUpstreamCharge
		if err := DB.ScanRows(rows, &charge); err != nil {
			return nil, err
		}
		firstForRequest := false
		if charge.RateID != nil && charge.LocalLogID != nil {
			firstForRequest = !costedLogs[*charge.LocalLogID]
			costedLogs[*charge.LocalLogID] = true
		}
		var key string
		switch groupBy {
		case "channel":
			key = strconv.Itoa(charge.ChannelID)
		case "model":
			key = charge.ModelName
			if charge.LocalLogID != nil && charge.LocalModelName != "" {
				key = charge.LocalModelName
			}
		case "day":
			key = time.Unix(charge.OccurredAt, 0).In(zone).Format(time.DateOnly)
		case "user":
			key = strconv.Itoa(charge.UserID)
		}
		group(key).addCharge(&charge, firstForRequest)
		total.addCharge(&charge, firstForRequest)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	price := operation_setting.Price
	if math.IsNaN(price) || math.IsInf(price, 0) || price < 0 {
		price = 0
	}
	microCNYPerQuota := decimal.NewFromFloat(price).Mul(decimal.NewFromInt(1_000_000)).Div(decimal.NewFromFloat(common.QuotaPerUnit))
	summary := &BeaconProfitSummary{Range: window, GroupBy: groupBy, ReferenceCNYPerUnit: price, Rows: []BeaconProfitRow{}}
	for _, key := range slices.Sorted(maps.Keys(groups)) {
		summary.Rows = append(summary.Rows, groups[key].result(microCNYPerQuota))
	}
	if err := labelBeaconProfitRows(ctx, groupBy, summary.Rows); err != nil {
		return nil, err
	}
	summary.Total = total.result(microCNYPerQuota)
	summary.Total.Key, summary.Total.Label = "total", "total"
	return summary, nil
}

func labelBeaconProfitRows(ctx context.Context, groupBy string, rows []BeaconProfitRow) error {
	if groupBy != "channel" && groupBy != "user" {
		return nil
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.Key)
	}
	names := map[string]string{}
	if groupBy == "channel" {
		var channels []Channel
		if err := DB.WithContext(ctx).Select("id", "name").Where("id IN ?", ids).Find(&channels).Error; err != nil {
			return err
		}
		for _, channel := range channels {
			names[strconv.Itoa(channel.Id)] = channel.Name
		}
	} else {
		var users []User
		if err := DB.WithContext(ctx).Unscoped().Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return err
		}
		for _, user := range users {
			names[strconv.Itoa(user.Id)] = user.Username
		}
	}
	for i := range rows {
		if name, ok := names[rows[i].Key]; ok {
			rows[i].Label = name
		}
	}
	return nil
}

// BeaconChannelObservation is the latest upstream charge seen on a channel,
// used to show the supplier's current group ratio.
type BeaconChannelObservation struct {
	ChannelID     int    `json:"channel_id"`
	OccurredAt    int64  `json:"occurred_at"`
	UpstreamGroup string `json:"upstream_group"`
	GroupRatio    string `json:"group_ratio"`
}

func LatestBeaconChannelObservation(channelID int) (*BeaconChannelObservation, error) {
	var charge BeaconUpstreamCharge
	err := DB.Select("channel_id", "occurred_at", "upstream_group", "group_ratio").
		Where("channel_id = ?", channelID).Order("occurred_at DESC, id DESC").Limit(1).Find(&charge).Error
	if err != nil || charge.ChannelID == 0 {
		return nil, err
	}
	return &BeaconChannelObservation{ChannelID: channelID, OccurredAt: charge.OccurredAt, UpstreamGroup: charge.UpstreamGroup, GroupRatio: charge.GroupRatio}, nil
}

// BeaconCostChannel is a channel as shown on the upstream cost page, without
// its key.
type BeaconCostChannel struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Type    int    `json:"type"`
	Status  int    `json:"status"`
	BaseURL string `json:"base_url"`
}

func ListBeaconCostChannels() ([]BeaconCostChannel, error) {
	var channels []Channel
	if err := DB.Select("id", "name", "type", "status", "base_url").Order("id").Find(&channels).Error; err != nil {
		return nil, err
	}
	result := make([]BeaconCostChannel, 0, len(channels))
	for _, channel := range channels {
		result = append(result, BeaconCostChannel{ID: channel.Id, Name: channel.Name, Type: channel.Type, Status: channel.Status, BaseURL: channel.GetBaseURL()})
	}
	return result, nil
}
