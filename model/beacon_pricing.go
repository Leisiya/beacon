package model

import (
	"errors"
	"maps"
	"math"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/expr-lang/expr/file"
	"github.com/expr-lang/expr/parser/lexer"
	"github.com/shopspring/decimal"
)

// Beacon price rules compare each model's sale price with what its
// suppliers charge (beacon_upstream_price.go) and propose, or apply, a new
// sale price. A change scales every price coefficient of the model's billing
// expression by one factor and is saved through UpdateModelPricing, so it
// takes effect for every customer at once and keeps the usual validation and
// version check. Requests already billed are not touched.

const (
	BeaconPricingCostPlus = "cost_plus"
	BeaconPricingFixed    = "fixed"

	BeaconProposalPending    = "pending"
	BeaconProposalApplied    = "applied"
	BeaconProposalDismissed  = "dismissed"
	BeaconProposalSuperseded = "superseded"
	BeaconProposalFailed     = "failed"

	// Changes smaller than this are not proposed.
	beaconPricingMinStep = 0.01
	// Scaled coefficients keep four significant digits, rounded up.
	beaconPriceDigits     = 4
	beaconPricingMaxBP    = 100000
	beaconPricingHistory  = 30
	beaconProbeTokens     = 1_000_000
	beaconStandardContext = 1000
	// At most one automatic change per model in this many seconds.
	beaconAutomaticInterval = 24 * 60 * 60
)

var (
	ErrBeaconPricingInput     = errors.New("invalid price rule input")
	ErrBeaconPricingShape     = errors.New("billing expression cannot be scaled automatically")
	ErrBeaconProposalClosed   = errors.New("price proposal is no longer pending")
	ErrBeaconProposalOutdated = errors.New("model pricing changed after the proposal was made")
	ErrBeaconReferencePrice   = errors.New("invalid top-up price")

	beaconPriceVariables = map[string]bool{
		"p": true, "c": true, "cr": true, "cc": true, "cc1h": true, "img": true,
		"img_cr": true, "img_o": true, "ai": true, "ao": true,
	}
	// Tier probes cover common context thresholds when an expression uses len.
	beaconContextProbes = []float64{beaconStandardContext, 150_000, 300_000, 1_000_000}
)

// BeaconPricingRule is the default rule (empty ModelName) or one model's
// override. Percentages are basis points: 3000 means 30%.
type BeaconPricingRule struct {
	ID          int64  `json:"id" gorm:"primaryKey"`
	ModelName   string `json:"model_name" gorm:"type:varchar(255);not null;uniqueIndex"`
	Mode        string `json:"mode" gorm:"type:varchar(16);not null"`
	MarkupBP    int    `json:"markup_bp" gorm:"not null"`
	MinMarkupBP int    `json:"min_markup_bp" gorm:"not null"`
	AutoApply   bool   `json:"auto_apply" gorm:"not null"`
	FollowDown  bool   `json:"follow_down" gorm:"not null"`
	MaxStepBP   int    `json:"max_step_bp" gorm:"not null"`
	UpdatedAt   int64  `json:"updated_at" gorm:"not null"`
	OperatorID  int    `json:"operator_id" gorm:"not null"`
}

func DefaultBeaconPricingRule() BeaconPricingRule {
	return BeaconPricingRule{Mode: BeaconPricingCostPlus, MarkupBP: 3000, MinMarkupBP: 1500, MaxStepBP: 5000}
}

// BeaconPriceProposal records one suggested or applied sale price change.
// OldVersion is the model pricing version it was computed from; applying it
// fails once the model's pricing has changed since.
type BeaconPriceProposal struct {
	ID              int64  `json:"id" gorm:"primaryKey"`
	ModelName       string `json:"model_name" gorm:"type:varchar(255);not null;index"`
	Status          string `json:"status" gorm:"type:varchar(16);not null;index"`
	CreatedAt       int64  `json:"created_at" gorm:"not null;index"`
	DecidedAt       int64  `json:"decided_at" gorm:"not null"`
	DeciderID       int    `json:"decider_id" gorm:"not null"`
	Automatic       bool   `json:"automatic" gorm:"not null"`
	BasisChannelID  int    `json:"basis_channel_id" gorm:"not null"`
	Factor          string `json:"factor" gorm:"type:varchar(32);not null"`
	CurrentMarkupBP int    `json:"current_markup_bp" gorm:"not null"`
	TargetMarkupBP  int    `json:"target_markup_bp" gorm:"not null"`
	OldVersion      string `json:"-" gorm:"type:varchar(64);not null"`
	OldExpr         string `json:"old_expr" gorm:"type:text;not null"`
	NewExpr         string `json:"new_expr" gorm:"type:text;not null"`
	Detail          string `json:"detail" gorm:"type:text;not null"`
	Error           string `json:"error" gorm:"type:varchar(500);not null"`
}

// BeaconPriceLine compares cost and sale for one usage type, in CNY per 1M
// tokens (or per request for request-priced models).
type BeaconPriceLine struct {
	Kind     string  `json:"kind"`
	Context  int     `json:"context"`
	CostCNY  float64 `json:"cost_cny"`
	SaleCNY  float64 `json:"sale_cny"`
	MarkupBP *int    `json:"markup_bp"`
}

type BeaconChannelCost struct {
	ChannelID     int               `json:"channel_id"`
	ChannelName   string            `json:"channel_name"`
	UpstreamModel string            `json:"upstream_model"`
	Status        string            `json:"status"`
	CNYPerUnit    string            `json:"cny_per_unit"`
	UpstreamGroup string            `json:"upstream_group"`
	GroupRatio    string            `json:"group_ratio"`
	Source        string            `json:"source"`
	ObservedAt    int64             `json:"observed_at"`
	VerifiedCount int64             `json:"verified_count"`
	MismatchCount int64             `json:"mismatch_count"`
	MinMarkupBP   *int              `json:"min_markup_bp"`
	Lines         []BeaconPriceLine `json:"lines"`
	factor        float64
}

type BeaconModelPricing struct {
	ModelName       string              `json:"model_name"`
	Status          string              `json:"status"`
	SaleExpr        string              `json:"sale_expr"`
	Rule            BeaconPricingRule   `json:"rule"`
	RuleOverridden  bool                `json:"rule_overridden"`
	Channels        []BeaconChannelCost `json:"channels"`
	BasisChannelID  int                 `json:"basis_channel_id"`
	CurrentMarkupBP *int                `json:"current_markup_bp"`
	BelowMinimum    bool                `json:"below_minimum"`
	Factor          string              `json:"factor"`
	ProposedExpr    string              `json:"proposed_expr"`
	// GroupRatio is what customers pay on top of the model price: the lowest
	// ratio among the groups an enabled channel sells the model in.
	GroupRatio float64 `json:"group_ratio"`
	// Sale is the CNY sale price of each usage type at standard context.
	Sale    []BeaconPriceLine `json:"sale"`
	version string
	factor  float64
}

type BeaconPricingReport struct {
	ReferenceCNYPerUnit float64               `json:"reference_cny_per_unit"`
	DefaultGroupRatio   float64               `json:"default_group_ratio"`
	DefaultRule         BeaconPricingRule     `json:"default_rule"`
	Overrides           []BeaconPricingRule   `json:"overrides"`
	Models              []BeaconModelPricing  `json:"models"`
	Proposals           []BeaconPriceProposal `json:"proposals"`
	History             []BeaconPriceProposal `json:"history"`
}

// NormalizeBeaconPricingRule validates a rule; percentages are bounded so a
// typo cannot multiply prices without limit.
func NormalizeBeaconPricingRule(rule BeaconPricingRule) (BeaconPricingRule, error) {
	rule.ModelName = strings.TrimSpace(rule.ModelName)
	if (rule.Mode != BeaconPricingCostPlus && rule.Mode != BeaconPricingFixed) ||
		rule.MarkupBP < 0 || rule.MarkupBP > beaconPricingMaxBP ||
		rule.MinMarkupBP < -10000 || rule.MinMarkupBP > beaconPricingMaxBP ||
		rule.MaxStepBP < 100 || rule.MaxStepBP > beaconPricingMaxBP ||
		utf8.RuneCountInString(rule.ModelName) > 255 || !utf8.ValidString(rule.ModelName) ||
		strings.ContainsAny(rule.ModelName, "\x00\r\n") {
		return rule, ErrBeaconPricingInput
	}
	return rule, nil
}

func SaveBeaconPricingRule(rule BeaconPricingRule, operatorID int, now int64) (*BeaconPricingRule, error) {
	rule, err := NormalizeBeaconPricingRule(rule)
	if err != nil {
		return nil, err
	}
	rule.UpdatedAt, rule.OperatorID = now, operatorID
	var existing BeaconPricingRule
	if err := DB.Where("model_name = ?", rule.ModelName).Limit(1).Find(&existing).Error; err != nil {
		return nil, err
	}
	rule.ID = existing.ID
	if rule.ID == 0 {
		err = DB.Create(&rule).Error
	} else {
		err = DB.Model(&BeaconPricingRule{}).Where("id = ?", rule.ID).Updates(map[string]any{
			"mode": rule.Mode, "markup_bp": rule.MarkupBP, "min_markup_bp": rule.MinMarkupBP,
			"auto_apply": rule.AutoApply, "follow_down": rule.FollowDown, "max_step_bp": rule.MaxStepBP,
			"updated_at": rule.UpdatedAt, "operator_id": rule.OperatorID,
		}).Error
	}
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// DeleteBeaconPricingRule removes a model override; the default rule stays.
func DeleteBeaconPricingRule(modelName string) error {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return ErrBeaconPricingInput
	}
	return DB.Where("model_name = ?", modelName).Delete(&BeaconPricingRule{}).Error
}

func beaconPricingRules() (BeaconPricingRule, map[string]BeaconPricingRule, error) {
	var rules []BeaconPricingRule
	if err := DB.Order("model_name").Find(&rules).Error; err != nil {
		return BeaconPricingRule{}, nil, err
	}
	defaultRule := DefaultBeaconPricingRule()
	overrides := map[string]BeaconPricingRule{}
	for _, rule := range rules {
		if rule.ModelName == "" {
			defaultRule = rule
			continue
		}
		overrides[rule.ModelName] = rule
	}
	return defaultRule, overrides, nil
}

func beaconCeilSignificant(value decimal.Decimal) decimal.Decimal {
	if !value.IsPositive() {
		return decimal.Zero
	}
	magnitude, _ := value.Float64()
	quantum := decimal.New(1, int32(math.Floor(math.Log10(magnitude)))-beaconPriceDigits+1)
	return value.Div(quantum).Ceil().Mul(quantum)
}

func beaconIsPriceVariable(token lexer.Token) bool {
	return token.Kind == lexer.Identifier && beaconPriceVariables[token.Value]
}

// beaconScaleProbes are usage vectors where a scaled expression must cost
// the factor times the original: each usage type alone, at several contexts.
func beaconScaleProbes() []billingexpr.TokenParams {
	probes := []billingexpr.TokenParams{{}}
	for _, context := range beaconContextProbes {
		for _, probe := range []billingexpr.TokenParams{
			{P: 1000}, {C: 1000}, {CR: 1000}, {CC: 1000}, {CC1h: 1000}, {Img: 1000},
			{ImgCR: 1000}, {ImgO: 1000}, {AI: 1000}, {AO: 1000}, {P: 700, C: 300, CR: 200, CC: 100},
		} {
			probe.Len = context
			probes = append(probes, probe)
		}
	}
	return probes
}

// ScaleBeaconBillingExpr multiplies every price coefficient (a number
// multiplied by a token variable, or a fixed() request price) by factor,
// rounding each up to four significant digits. Conditions, tier names and
// request-rule multipliers are left as written. The result must cost the
// factor times the original on every probe, otherwise the expression is not
// in a shape that can be scaled and ErrBeaconPricingShape is returned.
func ScaleBeaconBillingExpr(expression string, factor float64) (string, error) {
	if !(factor > 0) || math.IsInf(factor, 0) || len(billingexpr.UsedUsageKeys(expression)) > 0 {
		return "", ErrBeaconPricingShape
	}
	_, body := billingexpr.ParseExprVersion(expression)
	prefix := expression[:len(expression)-len(body)]
	tokens, err := lexer.Lex(file.NewSource(body))
	if err != nil {
		return "", ErrBeaconPricingShape
	}
	runes := []rune(body)
	scale := decimal.NewFromFloat(factor)
	var builder strings.Builder
	last, scaled := 0, 0
	for i, token := range tokens {
		if token.Kind != lexer.Number {
			continue
		}
		operator := func(j int) bool { return tokens[j].Kind == lexer.Operator && tokens[j].Value == "*" }
		priced := (i >= 2 && operator(i-1) && beaconIsPriceVariable(tokens[i-2])) ||
			(i+2 < len(tokens) && operator(i+1) && beaconIsPriceVariable(tokens[i+2])) ||
			(i >= 2 && tokens[i-1].Value == "(" && tokens[i-2].Kind == lexer.Identifier && tokens[i-2].Value == "fixed")
		if !priced {
			continue
		}
		if token.From < last || token.To > len(runes) || string(runes[token.From:token.To]) != token.Value {
			return "", ErrBeaconPricingShape
		}
		value, err := decimal.NewFromString(token.Value)
		if err != nil {
			return "", ErrBeaconPricingShape
		}
		builder.WriteString(string(runes[last:token.From]))
		builder.WriteString(beaconCeilSignificant(value.Mul(scale)).String())
		last = token.To
		scaled++
	}
	if scaled == 0 {
		return "", ErrBeaconPricingShape
	}
	builder.WriteString(string(runes[last:]))
	result := prefix + builder.String()
	if billing_setting.SmokeTestExpr(result) != nil {
		return "", ErrBeaconPricingShape
	}
	for _, probe := range beaconScaleProbes() {
		before, _, errBefore := billingexpr.RunExpr(expression, probe)
		after, _, errAfter := billingexpr.RunExpr(result, probe)
		if errBefore != nil || errAfter != nil {
			return "", ErrBeaconPricingShape
		}
		if before == 0 {
			if after != 0 {
				return "", ErrBeaconPricingShape
			}
			continue
		}
		ratio := after / before
		if ratio < factor*(1-1e-9) || ratio > factor*1.0011+1e-12 {
			return "", ErrBeaconPricingShape
		}
	}
	return result, nil
}

// beaconUsageParams builds the token parameters for one million tokens of a
// usage kind, folded the way settlement folds usage an expression does not
// price separately. Claude usage reports cache separately and only adds
// unpriced cache reads back to input; other usage includes every
// sub-category in prompt tokens.
func beaconUsageParams(kind string, context float64, used map[string]bool, claude bool) billingexpr.TokenParams {
	tokens := float64(beaconProbeTokens)
	params := billingexpr.TokenParams{Len: context}
	switch kind {
	case "input":
		params.P = tokens
	case "output":
		params.C = tokens
	case "cache_read":
		if used["cr"] {
			params.CR = tokens
		} else {
			params.P = tokens
		}
	case "cache_write", "cache_write_1h":
		variable := map[string]string{"cache_write": "cc", "cache_write_1h": "cc1h"}[kind]
		switch {
		case used[variable] && variable == "cc":
			params.CC = tokens
		case used[variable]:
			params.CC1h = tokens
		case !claude:
			params.P = tokens
		}
	case "image_input":
		if used["img"] {
			params.Img = tokens
		} else {
			params.P = tokens
		}
	case "audio_input":
		if used["ai"] {
			params.AI = tokens
		} else {
			params.P = tokens
		}
	case "audio_output":
		if used["ao"] {
			params.AO = tokens
		} else {
			params.C = tokens
		}
	case "image_output":
		if used["img_o"] {
			params.ImgO = tokens
		} else {
			params.C = tokens
		}
	}
	return params
}

// beaconUsagePrice returns USD per 1M tokens of the kind (or per request for
// a request-priced branch) before group ratios.
func beaconUsagePrice(expression, kind string, context float64, claude bool) (float64, bool, error) {
	params := beaconUsageParams(kind, context, billingexpr.UsedVars(expression), claude)
	raw, trace, err := billingexpr.RunExpr(expression, params)
	if err != nil || math.IsNaN(raw) || math.IsInf(raw, 0) || raw < 0 {
		return 0, false, ErrBeaconPricingShape
	}
	return raw / 1_000_000, trace.BillingUnit == billingexpr.BillingUnitRequest, nil
}

func beaconMarkupBP(sale, cost float64) *int {
	if !(cost > 0) {
		return nil
	}
	markup := (sale/cost - 1) * 10000
	markup = math.Max(math.Min(markup, math.MaxInt32), math.MinInt32)
	bp := int(math.Floor(markup))
	return &bp
}

var beaconUsageKinds = []struct {
	kind     string
	variable string
}{
	{"input", ""}, {"output", ""}, {"cache_read", "cr"}, {"cache_write", "cc"}, {"cache_write_1h", "cc1h"},
	{"image_input", "img"}, {"audio_input", "ai"}, {"audio_output", "ao"}, {"image_output", "img_o"},
}

// compareBeaconChannelCost fills the cost lines of one channel and the factor
// its price needs to reach the target markup.
func compareBeaconChannelCost(cost *BeaconChannelCost, saleExpr, upstreamExpr string, upstreamRatio, cnyPerUnit, saleCNYPerUSD float64, claude bool, targetBP int) error {
	saleVars, costVars := billingexpr.UsedVars(saleExpr), billingexpr.UsedVars(upstreamExpr)
	contexts := []float64{beaconStandardContext}
	if saleVars["len"] || costVars["len"] {
		contexts = beaconContextProbes
	}
	// Later contexts only add a line when the tier changes the price.
	previous := map[string][2]float64{}
	cost.factor = 0
	minMarkup := math.Inf(1)
	for _, context := range contexts {
		for _, usage := range beaconUsageKinds {
			if usage.variable != "" && !saleVars[usage.variable] && !costVars[usage.variable] {
				continue
			}
			sale, saleRequest, err := beaconUsagePrice(saleExpr, usage.kind, context, claude)
			if err != nil {
				return err
			}
			upstream, costRequest, err := beaconUsagePrice(upstreamExpr, usage.kind, context, claude)
			if err != nil {
				return err
			}
			if saleRequest != costRequest {
				return ErrBeaconPricingShape
			}
			kind := usage.kind
			if saleRequest {
				kind = "request"
			}
			saleCNY, costCNY := sale*saleCNYPerUSD, upstream*upstreamRatio*cnyPerUnit
			if last, ok := previous[kind]; ok && last == [2]float64{costCNY, saleCNY} {
				continue
			}
			previous[kind] = [2]float64{costCNY, saleCNY}
			line := BeaconPriceLine{Kind: kind, Context: int(context), CostCNY: costCNY, SaleCNY: saleCNY, MarkupBP: beaconMarkupBP(saleCNY, costCNY)}
			cost.Lines = append(cost.Lines, line)
			if !(costCNY > 0) {
				continue
			}
			if !(saleCNY > 0) {
				cost.factor = math.Inf(1)
				minMarkup = -1
				continue
			}
			cost.factor = math.Max(cost.factor, (1+float64(targetBP)/10000)*costCNY/saleCNY)
			minMarkup = math.Min(minMarkup, saleCNY/costCNY-1)
		}
	}
	if !math.IsInf(minMarkup, 1) {
		bp := int(math.Floor(math.Max(math.Min(minMarkup*10000, math.MaxInt32), math.MinInt32)))
		cost.MinMarkupBP = &bp
	}
	return nil
}

func beaconMappedModel(channel *Channel, modelName string) string {
	mapping := map[string]string{}
	if raw := strings.TrimSpace(channel.GetModelMapping()); raw != "" && raw != "{}" {
		if common.UnmarshalJsonStr(raw, &mapping) != nil {
			return modelName
		}
	}
	current := modelName
	for range 10 {
		next, ok := mapping[current]
		if !ok || next == "" || next == current {
			break
		}
		current = next
	}
	return current
}

// AnalyzeBeaconPricing compares every model offered by an enabled channel.
func AnalyzeBeaconPricing() (*BeaconPricingReport, error) {
	defaultRule, overrides, err := beaconPricingRules()
	if err != nil {
		return nil, err
	}
	report := &BeaconPricingReport{
		ReferenceCNYPerUnit: operation_setting.Price, DefaultGroupRatio: ratio_setting.GetGroupRatio("default"),
		DefaultRule: defaultRule, Overrides: slices.Collect(maps.Values(overrides)), Models: []BeaconModelPricing{},
	}
	slices.SortFunc(report.Overrides, func(a, b BeaconPricingRule) int { return strings.Compare(a.ModelName, b.ModelName) })
	var abilities []Ability
	if err := DB.Select("model, channel_id, "+commonGroupCol).Where("enabled = ?", true).Find(&abilities).Error; err != nil {
		return nil, err
	}
	channelsByModel := map[string][]int{}
	channelIDs := map[int]bool{}
	for _, ability := range abilities {
		if !slices.Contains(channelsByModel[ability.Model], ability.ChannelId) {
			channelsByModel[ability.Model] = append(channelsByModel[ability.Model], ability.ChannelId)
		}
		channelIDs[ability.ChannelId] = true
	}
	var channels []Channel
	if err := DB.Select("id", "name", "status", "model_mapping").Where("id IN ?", slices.Collect(maps.Keys(channelIDs))).Find(&channels).Error; err != nil {
		return nil, err
	}
	channelByID := map[int]*Channel{}
	for i := range channels {
		if channels[i].Status == common.ChannelStatusEnabled {
			channelByID[channels[i].Id] = &channels[i]
		}
	}
	groupsByModel := map[string][]string{}
	for _, ability := range abilities {
		if channelByID[ability.ChannelId] != nil && !slices.Contains(groupsByModel[ability.Model], ability.Group) {
			groupsByModel[ability.Model] = append(groupsByModel[ability.Model], ability.Group)
		}
	}
	names := slices.Sorted(maps.Keys(channelsByModel))
	// An empty list would ask GetModelPricingSnapshot for every priced model.
	snapshot := &ModelPricingSnapshot{}
	if len(names) > 0 {
		if snapshot, err = GetModelPricingSnapshot(names); err != nil {
			return nil, err
		}
	}
	now := common.GetTimestamp()
	for _, entry := range snapshot.Entries {
		analysis := BeaconModelPricing{ModelName: entry.ModelName, Rule: defaultRule, version: entry.Version, Channels: []BeaconChannelCost{}, Sale: []BeaconPriceLine{}}
		// The cheapest group is the lowest price a customer can get, so it
		// is the one that has to cover the cost.
		analysis.GroupRatio = report.DefaultGroupRatio
		for i, group := range groupsByModel[entry.ModelName] {
			if ratio := ratio_setting.GetGroupRatio(group); i == 0 || ratio < analysis.GroupRatio {
				analysis.GroupRatio = ratio
			}
		}
		saleCNYPerUSD := report.ReferenceCNYPerUnit * analysis.GroupRatio
		if rule, ok := overrides[entry.ModelName]; ok {
			analysis.Rule, analysis.RuleOverridden = rule, true
		}
		mode, _ := entry.Effective["billing_setting.billing_mode"].(string)
		analysis.SaleExpr, _ = entry.Effective["billing_setting.billing_expr"].(string)
		switch {
		case len(entry.PluginVariants) > 0 || entry.UsageSchema != nil:
			continue
		case mode != billing_setting.BillingModeTieredExpr || analysis.SaleExpr == "":
			analysis.Status = "legacy_pricing"
			report.Models = append(report.Models, analysis)
			continue
		}
		claude := strings.Contains(strings.ToLower(entry.ModelName), "claude")
		saleVars := billingexpr.UsedVars(analysis.SaleExpr)
		for _, usage := range beaconUsageKinds {
			if usage.variable != "" && !saleVars[usage.variable] {
				continue
			}
			price, request, err := beaconUsagePrice(analysis.SaleExpr, usage.kind, beaconStandardContext, claude)
			if err != nil {
				break
			}
			if request {
				analysis.Sale = []BeaconPriceLine{{Kind: "request", Context: beaconStandardContext, SaleCNY: price * saleCNYPerUSD}}
				break
			}
			analysis.Sale = append(analysis.Sale, BeaconPriceLine{Kind: usage.kind, Context: beaconStandardContext, SaleCNY: price * saleCNYPerUSD})
		}
		basis := -1
		for _, channelID := range slices.Sorted(slices.Values(channelsByModel[entry.ModelName])) {
			channel := channelByID[channelID]
			if channel == nil {
				continue
			}
			cost := BeaconChannelCost{ChannelID: channel.Id, ChannelName: channel.Name, UpstreamModel: beaconMappedModel(channel, entry.ModelName), Lines: []BeaconPriceLine{}}
			rates, err := beaconChannelRates(DB, channel.Id)
			if err != nil {
				return nil, err
			}
			rate := beaconRateAt(rates, now)
			point, err := LatestBeaconUpstreamPrice(channel.Id, cost.UpstreamModel)
			if err != nil {
				return nil, err
			}
			switch {
			case rate == nil:
				cost.Status = "no_rate"
			case point == nil:
				cost.Status = "no_observation"
			}
			if rate != nil {
				cost.CNYPerUnit = rate.CNYPerUnit
			}
			if point != nil {
				cost.UpstreamGroup, cost.GroupRatio, cost.Source = point.UpstreamGroup, point.GroupRatio, point.Source
				cost.ObservedAt, cost.VerifiedCount, cost.MismatchCount = point.LastSeenAt, point.VerifiedCount, point.MismatchCount
			}
			if cost.Status == "" {
				cnyPerUnit, _ := decimal.RequireFromString(rate.CNYPerUnit).Float64()
				ratio, ratioErr := decimal.NewFromString(point.GroupRatio)
				upstreamRatio, _ := ratio.Float64()
				if ratioErr != nil || compareBeaconChannelCost(&cost, analysis.SaleExpr, point.Expr, upstreamRatio, cnyPerUnit, saleCNYPerUSD, claude, analysis.Rule.MarkupBP) != nil {
					cost.Status, cost.Lines, cost.MinMarkupBP = "unsupported", []BeaconPriceLine{}, nil
				} else {
					cost.Status = "ok"
				}
			}
			analysis.Channels = append(analysis.Channels, cost)
			// The most expensive supplier is the basis, so a fallback to any
			// channel still meets the target markup.
			if cost.Status == "ok" && (basis < 0 || cost.factor > analysis.Channels[basis].factor) {
				basis = len(analysis.Channels) - 1
			}
		}
		if basis < 0 {
			analysis.Status = "no_cost"
			report.Models = append(report.Models, analysis)
			continue
		}
		basisCost := analysis.Channels[basis]
		analysis.BasisChannelID, analysis.CurrentMarkupBP, analysis.factor = basisCost.ChannelID, basisCost.MinMarkupBP, basisCost.factor
		analysis.BelowMinimum = analysis.CurrentMarkupBP != nil && *analysis.CurrentMarkupBP < analysis.Rule.MinMarkupBP
		analysis.Status = "ok"
		if math.IsInf(basisCost.factor, 1) {
			analysis.Status = "free_sale"
		} else if analysis.Rule.Mode == BeaconPricingCostPlus && basisCost.factor > 0 &&
			(basisCost.factor >= 1+beaconPricingMinStep || (analysis.Rule.FollowDown && basisCost.factor <= 1-beaconPricingMinStep)) {
			proposed, err := ScaleBeaconBillingExpr(analysis.SaleExpr, basisCost.factor)
			if err != nil {
				analysis.Status = "unsupported_expr"
			} else if proposed != analysis.SaleExpr {
				analysis.ProposedExpr, analysis.Factor = proposed, decimal.NewFromFloat(basisCost.factor).Round(4).String()
			}
		}
		report.Models = append(report.Models, analysis)
	}
	if err := DB.Where("status = ?", BeaconProposalPending).Order("id DESC").Find(&report.Proposals).Error; err != nil {
		return nil, err
	}
	if err := DB.Where("status <> ?", BeaconProposalPending).Order("id DESC").Limit(beaconPricingHistory).Find(&report.History).Error; err != nil {
		return nil, err
	}
	return report, nil
}

// SetBeaconReferencePrice saves the top-up price: the CNY a customer pays for
// $1 of balance. Manual receipts are prefilled with it, and sale prices and
// customer charges are converted to CNY with it. The display exchange rate is
// set to the same value: the model list, the pricing editor, balances and
// logs convert with it, and a different value would show other prices there.
func SetBeaconReferencePrice(value string) (string, error) {
	value = strings.TrimSpace(value)
	price, err := decimal.NewFromString(value)
	if err != nil || !beaconRatePattern.MatchString(value) || !price.IsPositive() {
		return "", ErrBeaconReferencePrice
	}
	value = price.String()
	if err := UpdateOption("USDExchangeRate", value); err != nil {
		return "", err
	}
	return value, UpdateOption("Price", value)
}

type BeaconPricingOutcome struct {
	Proposed     []string
	Applied      []string
	Failed       []string
	BelowMinimum []string
}

type beaconProposalDetail struct {
	Rule                BeaconPricingRule `json:"rule"`
	ReferenceCNYPerUnit float64           `json:"reference_cny_per_unit"`
	GroupRatio          float64           `json:"group_ratio"`
	Basis               BeaconChannelCost `json:"basis"`
}

// EvaluateBeaconPricing turns the current analysis into proposals: a stale
// pending proposal is superseded, a dismissed one is not repeated for the
// same prices, and an automatic rule applies changes within its step limit.
var beaconPricingMu sync.Mutex

func EvaluateBeaconPricing(now int64) (*BeaconPricingOutcome, error) {
	beaconPricingMu.Lock()
	defer beaconPricingMu.Unlock()
	report, err := AnalyzeBeaconPricing()
	if err != nil {
		return nil, err
	}
	pending := map[string]BeaconPriceProposal{}
	for _, proposal := range report.Proposals {
		pending[proposal.ModelName] = proposal
	}
	outcome := &BeaconPricingOutcome{}
	for _, analysis := range report.Models {
		if analysis.BelowMinimum {
			outcome.BelowMinimum = append(outcome.BelowMinimum, analysis.ModelName)
		}
		existing, hasPending := pending[analysis.ModelName]
		if analysis.ProposedExpr == "" {
			if hasPending {
				if err := closeBeaconProposal(existing.ID, BeaconProposalSuperseded, 0, now, ""); err != nil {
					return nil, err
				}
			}
			continue
		}
		proposalID := existing.ID
		if !hasPending || existing.OldVersion != analysis.version || existing.NewExpr != analysis.ProposedExpr {
			if hasPending {
				if err := closeBeaconProposal(existing.ID, BeaconProposalSuperseded, 0, now, ""); err != nil {
					return nil, err
				}
			}
			// A dismissed or failed change is not proposed again until the
			// price or the cost moves.
			var closed int64
			if err := DB.Model(&BeaconPriceProposal{}).Where("model_name = ? AND status IN ? AND old_version = ? AND new_expr = ?",
				analysis.ModelName, []string{BeaconProposalDismissed, BeaconProposalFailed}, analysis.version, analysis.ProposedExpr).Count(&closed).Error; err != nil {
				return nil, err
			}
			if closed > 0 {
				continue
			}
			proposal, err := createBeaconProposal(report, analysis, now)
			if err != nil {
				return nil, err
			}
			proposalID = proposal.ID
			outcome.Proposed = append(outcome.Proposed, analysis.ModelName)
		}
		automatic, err := beaconAutomaticChangeAllowed(analysis, now)
		if err != nil {
			return nil, err
		}
		if !automatic {
			continue
		}
		if err := ApplyBeaconPriceProposal(proposalID, 0, now); err != nil {
			outcome.Failed = append(outcome.Failed, analysis.ModelName)
			continue
		}
		outcome.Applied = append(outcome.Applied, analysis.ModelName)
		outcome.Proposed = slices.DeleteFunc(outcome.Proposed, func(name string) bool { return name == analysis.ModelName })
	}
	return outcome, nil
}

// beaconAutomaticChangeAllowed limits what a rule may change without a
// person: the step in either direction, one automatic change per model per
// day so repeated supplier moves cannot compound, and only on a supplier
// price that reproduced its own charges.
func beaconAutomaticChangeAllowed(analysis BeaconModelPricing, now int64) (bool, error) {
	step := float64(analysis.Rule.MaxStepBP) / 10000
	if !analysis.Rule.AutoApply || analysis.factor > 1+step || analysis.factor < 1-step {
		return false, nil
	}
	verified := false
	for _, channel := range analysis.Channels {
		if channel.ChannelID == analysis.BasisChannelID {
			verified = channel.VerifiedCount > 0 && channel.MismatchCount == 0
		}
	}
	if !verified {
		return false, nil
	}
	var recent int64
	err := DB.Model(&BeaconPriceProposal{}).Where("model_name = ? AND status = ? AND automatic = ? AND decided_at > ?",
		analysis.ModelName, BeaconProposalApplied, true, now-beaconAutomaticInterval).Count(&recent).Error
	return recent == 0, err
}

func createBeaconProposal(report *BeaconPricingReport, analysis BeaconModelPricing, now int64) (*BeaconPriceProposal, error) {
	detail := beaconProposalDetail{Rule: analysis.Rule, ReferenceCNYPerUnit: report.ReferenceCNYPerUnit, GroupRatio: analysis.GroupRatio}
	for _, channel := range analysis.Channels {
		if channel.ChannelID == analysis.BasisChannelID {
			detail.Basis = channel
		}
	}
	encoded, err := common.Marshal(detail)
	if err != nil {
		return nil, err
	}
	current := 0
	if analysis.CurrentMarkupBP != nil {
		current = *analysis.CurrentMarkupBP
	}
	proposal := BeaconPriceProposal{
		ModelName: analysis.ModelName, Status: BeaconProposalPending, CreatedAt: now, BasisChannelID: analysis.BasisChannelID,
		Factor: analysis.Factor, CurrentMarkupBP: current, TargetMarkupBP: analysis.Rule.MarkupBP,
		OldVersion: analysis.version, OldExpr: analysis.SaleExpr, NewExpr: analysis.ProposedExpr, Detail: string(encoded),
	}
	return &proposal, DB.Create(&proposal).Error
}

func closeBeaconProposal(id int64, status string, deciderID int, now int64, reason string) error {
	result := DB.Model(&BeaconPriceProposal{}).Where("id = ? AND status = ?", id, BeaconProposalPending).Updates(map[string]any{
		"status": status, "decided_at": now, "decider_id": deciderID, "automatic": deciderID == 0 && status == BeaconProposalApplied,
		"error": truncateRunes(reason, 500),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrBeaconProposalClosed
	}
	return nil
}

func GetBeaconPriceProposal(id int64) (*BeaconPriceProposal, error) {
	var proposal BeaconPriceProposal
	if err := DB.Where("id = ?", id).First(&proposal).Error; err != nil {
		return nil, err
	}
	return &proposal, nil
}

// ApplyBeaconPriceProposal saves the proposed expression as the model's sale
// price. deciderID 0 marks an automatic change.
func ApplyBeaconPriceProposal(id int64, deciderID int, now int64) error {
	proposal, err := GetBeaconPriceProposal(id)
	if err != nil {
		return err
	}
	if proposal.Status != BeaconProposalPending {
		return ErrBeaconProposalClosed
	}
	snapshot, err := GetModelPricingSnapshot([]string{proposal.ModelName})
	if err != nil {
		return err
	}
	if len(snapshot.Entries) != 1 || snapshot.Entries[0].Version != proposal.OldVersion {
		_ = closeBeaconProposal(id, BeaconProposalSuperseded, deciderID, now, ErrBeaconProposalOutdated.Error())
		return ErrBeaconProposalOutdated
	}
	// The proposal was worked out from the top-up price, group ratio and
	// supplier costs of its time. If any changed, today's analysis no longer
	// proposes the same price, and applying the old one could sell below cost.
	report, err := AnalyzeBeaconPricing()
	if err != nil {
		return err
	}
	current := ""
	for _, analysis := range report.Models {
		if analysis.ModelName == proposal.ModelName {
			current = analysis.ProposedExpr
		}
	}
	if current != proposal.NewExpr {
		_ = closeBeaconProposal(id, BeaconProposalSuperseded, deciderID, now, ErrBeaconProposalOutdated.Error())
		return ErrBeaconProposalOutdated
	}
	pricing := maps.Clone(snapshot.Entries[0].Configured)
	pricing["billing_setting.billing_mode"] = billing_setting.BillingModeTieredExpr
	pricing["billing_setting.billing_expr"] = proposal.NewExpr
	if err := UpdateModelPricing([]ModelPricingChange{{ModelName: proposal.ModelName, ExpectedVersion: proposal.OldVersion, Pricing: pricing}}); err != nil {
		status := BeaconProposalFailed
		if errors.Is(err, ErrModelPricingConflict) {
			status, err = BeaconProposalSuperseded, ErrBeaconProposalOutdated
		}
		_ = closeBeaconProposal(id, status, deciderID, now, err.Error())
		return err
	}
	return closeBeaconProposal(id, BeaconProposalApplied, deciderID, now, "")
}

func DismissBeaconPriceProposal(id int64, deciderID int, now int64) error {
	return closeBeaconProposal(id, BeaconProposalDismissed, deciderID, now, "")
}
