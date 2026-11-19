package model

import (
	"crypto/sha256"
	"fmt"
	"maps"
	"math"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/expr-lang/expr/file"
	"github.com/expr-lang/expr/parser/lexer"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Upstream price points: what a supplier charges for one model, read back
// from the pricing fields of its own consume logs. A New API upstream writes
// its billing expression (or legacy ratios) and group ratio into each log,
// so cost per token type is known exactly and a new combination means the
// supplier changed its price.

const (
	BeaconPriceSourceExpr         = "expr"
	BeaconPriceSourceRatio        = "ratio"
	beaconMaxUpstreamExprLength   = 2000
	beaconMaxUpstreamExprsPerSync = 32
)

// BeaconUpstreamPricing carries the pricing fields of one upstream log.
type BeaconUpstreamPricing struct {
	BillingMode        string
	Expr               string
	ModelRatio         float64
	CompletionRatio    float64
	CacheRatio         float64
	CacheCreationRatio float64
	ModelPrice         float64
	GroupRatio         float64
	HasGroupRatio      bool
}

type BeaconUpstreamPrice struct {
	ID            int64  `json:"id" gorm:"primaryKey"`
	ChannelID     int    `json:"channel_id" gorm:"not null;index:idx_beacon_price_channel_model,priority:1"`
	ModelName     string `json:"model_name" gorm:"type:varchar(128);not null;index:idx_beacon_price_channel_model,priority:2"`
	UpstreamGroup string `json:"upstream_group" gorm:"type:varchar(64);not null"`
	GroupRatio    string `json:"group_ratio" gorm:"type:varchar(32);not null"`
	Source        string `json:"source" gorm:"type:varchar(16);not null"`
	Expr          string `json:"expr" gorm:"type:text;not null"`
	QuotaPerUnit  int64  `json:"quota_per_unit" gorm:"type:bigint;not null"`
	Fingerprint   string `json:"-" gorm:"type:varchar(64);not null;uniqueIndex"`
	FirstSeenAt   int64  `json:"first_seen_at" gorm:"not null"`
	LastSeenAt    int64  `json:"last_seen_at" gorm:"not null;index"`
	ChargeCount   int64  `json:"charge_count" gorm:"not null"`
	// Charges without cache tokens are recomputed from the price point;
	// VerifiedCount matched the deducted quota, MismatchCount did not.
	VerifiedCount int64 `json:"verified_count" gorm:"not null"`
	MismatchCount int64 `json:"mismatch_count" gorm:"not null"`
}

var beaconUpstreamExprIdentifiers = map[string]bool{
	"p": true, "c": true, "cr": true, "cc": true, "cc1h": true, "img": true, "img_cr": true,
	"img_o": true, "ai": true, "ao": true, "len": true, "image_count": true,
	"tier": true, "fixed": true, "max": true, "min": true, "ceil": true, "floor": true, "abs": true,
}

var beaconUpstreamExprOperators = map[string]bool{
	"+": true, "-": true, "*": true, "/": true, "<": true, "<=": true, ">": true, ">=": true,
	"==": true, "!=": true, "&&": true, "||": true, "?": true, ":": true, ",": true,
}

// beaconSafeUpstreamExpr accepts only token pricing built from numbers, token
// variables, tier names and arithmetic, so a supplier cannot make this site
// evaluate request probes or expensive builtins.
func beaconSafeUpstreamExpr(expression string) bool {
	if expression == "" || len(expression) > beaconMaxUpstreamExprLength {
		return false
	}
	version, body := billingexpr.ParseExprVersion(expression)
	if version != 1 {
		return false
	}
	tokens, err := lexer.Lex(file.NewSource(body))
	if err != nil {
		return false
	}
	for i, token := range tokens {
		switch token.Kind {
		case lexer.Number, lexer.EOF:
		case lexer.Identifier:
			if !beaconUpstreamExprIdentifiers[token.Value] {
				return false
			}
		case lexer.String:
			if i < 2 || tokens[i-1].Value != "(" || tokens[i-2].Value != "tier" {
				return false
			}
		case lexer.Operator:
			if !beaconUpstreamExprOperators[token.Value] {
				return false
			}
		case lexer.Bracket:
			if token.Value != "(" && token.Value != ")" {
				return false
			}
		default:
			return false
		}
	}
	return billing_setting.SmokeTestExpr(expression) == nil
}

func formatBeaconNumber(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

// beaconUpstreamPriceExpr returns the supplier's price as an expression in
// USD per 1M tokens of its own credit, before its group ratio.
func beaconUpstreamPriceExpr(pricing BeaconUpstreamPricing, quotaPerUnit int64, checked map[string]bool) (string, string, bool) {
	if pricing.BillingMode == "tiered_expr" {
		safe, seen := checked[pricing.Expr]
		if !seen {
			// Each distinct expression is compiled into the shared billing
			// cache; a supplier cannot flood it with variants in one sync.
			if len(checked) >= beaconMaxUpstreamExprsPerSync {
				return "", "", false
			}
			safe = beaconSafeUpstreamExpr(pricing.Expr)
			checked[pricing.Expr] = safe
		}
		if !safe {
			return "", "", false
		}
		return BeaconPriceSourceExpr, pricing.Expr, true
	}
	if pricing.ModelPrice > 0 && !math.IsInf(pricing.ModelPrice, 0) {
		return BeaconPriceSourceRatio, fmt.Sprintf(`tier("request", fixed(%s))`, decimal.NewFromFloat(pricing.ModelPrice).String()), true
	}
	if !(pricing.ModelRatio > 0) || math.IsInf(pricing.ModelRatio, 0) || quotaPerUnit <= 0 {
		return "", "", false
	}
	// A legacy ratio of 1 is $0.002 per 1K tokens at 500000 quota per $1.
	base := decimal.NewFromFloat(pricing.ModelRatio).Mul(decimal.NewFromInt(1_000_000)).Div(decimal.NewFromInt(quotaPerUnit))
	terms := []string{"p * " + base.String()}
	for _, term := range []struct {
		name  string
		ratio float64
	}{{"c", pricing.CompletionRatio}, {"cr", pricing.CacheRatio}, {"cc", pricing.CacheCreationRatio}} {
		if term.ratio > 0 && !math.IsInf(term.ratio, 0) {
			terms = append(terms, term.name+" * "+base.Mul(decimal.NewFromFloat(term.ratio)).String())
		}
	}
	expression := fmt.Sprintf(`tier("base", %s)`, strings.Join(terms, " + "))
	if billing_setting.SmokeTestExpr(expression) != nil {
		return "", "", false
	}
	return BeaconPriceSourceRatio, expression, true
}

// beaconPredictedUpstreamQuota recomputes a charge without cache tokens from
// its price point; charges with cache tokens depend on usage normalization
// and are not checked.
func beaconPredictedUpstreamQuota(expression string, groupRatio float64, quotaPerUnit int64, record BeaconUpstreamRecord) (float64, bool) {
	if record.CacheTokens != 0 || record.CacheCreationTokens != 0 {
		return 0, false
	}
	prompt, completion := float64(max(record.PromptTokens, 0)), float64(max(record.CompletionTokens, 0))
	raw, _, err := billingexpr.RunExpr(expression, billingexpr.TokenParams{P: prompt, C: completion, Len: prompt})
	if err != nil || math.IsNaN(raw) || math.IsInf(raw, 0) {
		return 0, false
	}
	return raw / 1_000_000 * float64(quotaPerUnit) * groupRatio, true
}

func recordBeaconUpstreamPrices(channelID int, quotaPerUnit int64, records []BeaconUpstreamRecord) error {
	points := map[string]*BeaconUpstreamPrice{}
	checked := map[string]bool{}
	for _, record := range records {
		pricing := record.Pricing
		if !pricing.HasGroupRatio || pricing.GroupRatio < 0 || math.IsInf(pricing.GroupRatio, 0) || math.IsNaN(pricing.GroupRatio) {
			continue
		}
		source, expression, ok := beaconUpstreamPriceExpr(pricing, quotaPerUnit, checked)
		if !ok {
			continue
		}
		modelName, group := truncateRunes(record.ModelName, 128), truncateRunes(record.Group, 64)
		ratio := formatBeaconNumber(pricing.GroupRatio)
		sum := sha256.Sum256(fmt.Appendf(nil, "%d\x00%s\x00%s\x00%s\x00%s\x00%s\x00%d", channelID, modelName, group, ratio, source, expression, quotaPerUnit))
		fingerprint := fmt.Sprintf("%x", sum)
		point := points[fingerprint]
		if point == nil {
			point = &BeaconUpstreamPrice{ChannelID: channelID, ModelName: modelName, UpstreamGroup: group, GroupRatio: ratio,
				Source: source, Expr: expression, QuotaPerUnit: quotaPerUnit, Fingerprint: fingerprint,
				FirstSeenAt: record.OccurredAt, LastSeenAt: record.OccurredAt}
			points[fingerprint] = point
		}
		point.FirstSeenAt = min(point.FirstSeenAt, record.OccurredAt)
		point.LastSeenAt = max(point.LastSeenAt, record.OccurredAt)
		point.ChargeCount++
		if predicted, ok := beaconPredictedUpstreamQuota(expression, pricing.GroupRatio, quotaPerUnit, record); ok {
			if math.Abs(predicted-float64(record.Quota)) <= max(1, float64(record.Quota)*0.005) {
				point.VerifiedCount++
			} else {
				point.MismatchCount++
			}
		}
	}
	for _, fingerprint := range slices.Sorted(maps.Keys(points)) {
		point := points[fingerprint]
		result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(point)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			continue
		}
		if err := DB.Model(&BeaconUpstreamPrice{}).Where("fingerprint = ?", fingerprint).Updates(map[string]any{
			"first_seen_at":  gorm.Expr("CASE WHEN first_seen_at > ? THEN ? ELSE first_seen_at END", point.FirstSeenAt, point.FirstSeenAt),
			"last_seen_at":   gorm.Expr("CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END", point.LastSeenAt, point.LastSeenAt),
			"charge_count":   gorm.Expr("charge_count + ?", point.ChargeCount),
			"verified_count": gorm.Expr("verified_count + ?", point.VerifiedCount),
			"mismatch_count": gorm.Expr("mismatch_count + ?", point.MismatchCount),
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

// LatestBeaconUpstreamPrice returns the price point seen most recently for a
// supplier model on a channel, or nil.
func LatestBeaconUpstreamPrice(channelID int, upstreamModel string) (*BeaconUpstreamPrice, error) {
	var point BeaconUpstreamPrice
	err := DB.Where("channel_id = ? AND model_name = ?", channelID, upstreamModel).
		Order("last_seen_at DESC, id DESC").Limit(1).Find(&point).Error
	if err != nil || point.ID == 0 {
		return nil, err
	}
	return &point, nil
}
