package model

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupBeaconCostTest(t *testing.T) (User, User, Channel) {
	t.Helper()
	// Registered first so it runs last, after the ledger fixture restores
	// the database type: reserved column quoting follows the dialect.
	t.Cleanup(initCol)
	operator, user := setupBeaconLedgerTest(t)
	initCol()
	require.NoError(t, DB.AutoMigrate(&Channel{}, &BeaconUpstreamRate{}, &BeaconUpstreamCharge{}))
	t.Cleanup(func() {
		if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			require.NoError(t, DB.Migrator().DropTable(&Channel{}, &BeaconUpstreamRate{}, &BeaconUpstreamCharge{}))
		}
	})
	baseURL := "https://upstream.example"
	channel := Channel{Name: "supplier-a", Key: "sk-test", Status: common.ChannelStatusEnabled, BaseURL: &baseURL}
	require.NoError(t, DB.Create(&channel).Error)
	return operator, user, channel
}

func beaconChargeByLogID(t *testing.T, logID int64) BeaconUpstreamCharge {
	t.Helper()
	var charge BeaconUpstreamCharge
	require.NoError(t, DB.Where("upstream_log_id = ?", logID).First(&charge).Error)
	return charge
}

func TestBeaconUpstreamChargesKeepTheirPricedCost(t *testing.T) {
	operator, user, channel := setupBeaconCostTest(t)
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC).Unix()
	start := now - 3600
	_, err := CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start, CNYPerUnit: "1", Note: "1 CNY per credit"}, operator.Id, now)
	require.NoError(t, err)
	// The channel maps the customer's "haiku-alias" to the upstream model.
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "haiku-alias", Quota: 221, UpstreamRequestId: "up-1", CreatedAt: start + 10}).Error)

	records := []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "up-1", OccurredAt: start + 10, ModelName: "claude-haiku-4-5", Group: "ccmax", GroupRatio: "1.8", Quota: 397},
		{LogID: 2, RequestID: "up-2", OccurredAt: start - 100, ModelName: "claude-sonnet-4-6", Quota: 5465},
		{LogID: 3, RequestID: "up-3", OccurredAt: start + 20, ModelName: "claude-haiku-4-5", Quota: -5},
		{LogID: 4, RequestID: "up-4", OccurredAt: start - 1000, ModelName: "claude-sonnet-4-6", Quota: 1000},
		// The upstream logged request up-1 twice; both deductions are costs.
		{LogID: 5, RequestID: "up-1", OccurredAt: start + 10, ModelName: "claude-haiku-4-5", Group: "ccmax", GroupRatio: "1.8", Quota: 397},
	}
	inserted, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records, now)
	require.NoError(t, err)
	assert.Equal(t, 4, inserted, "negative upstream quota is not stored")
	inserted, err = StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records[:1], now)
	require.NoError(t, err)
	assert.Equal(t, 0, inserted, "the same upstream log is stored once")

	priced := beaconChargeByLogID(t, 1)
	require.NotNil(t, priced.RateID)
	assert.Equal(t, int64(794), priced.CreditMicro)
	assert.Equal(t, int64(794), priced.CostMicroCNY)
	require.NotNil(t, priced.LocalLogID)
	assert.Equal(t, user.Id, priced.UserID)
	assert.Equal(t, int64(221), priced.LocalQuota)
	assert.Equal(t, "haiku-alias", priced.LocalModelName)
	assert.Equal(t, "1.8", priced.GroupRatio)

	pending := beaconChargeByLogID(t, 2)
	assert.Nil(t, pending.RateID, "a charge before the first rate stays pending")
	assert.Nil(t, pending.LocalLogID)

	// A backdated rate prices the pending charge but not the priced one; a
	// later rate change does not reprice existing charges either.
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start - 200, CNYPerUnit: "2", Note: "earlier top-up"}, operator.Id, now)
	require.NoError(t, err)
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start + 5, CNYPerUnit: "3", Note: "price rise"}, operator.Id, now)
	require.NoError(t, err)
	pending = beaconChargeByLogID(t, 2)
	require.NotNil(t, pending.RateID)
	assert.Equal(t, int64(10930), pending.CreditMicro)
	assert.Equal(t, int64(21860), pending.CostMicroCNY)
	assert.Equal(t, int64(794), beaconChargeByLogID(t, 1).CostMicroCNY)

	// A request with no upstream deduction yet, and a refund of part of it.
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: user.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-sonnet-4-6", Quota: 1000, CreatedAt: start + 30},
		{UserId: user.Id, Type: LogTypeRefund, ChannelId: channel.Id, ModelName: "claude-sonnet-4-6", Quota: 100, CreatedAt: start + 40},
	}).Error)
	previousPrice := operation_setting.Price
	t.Cleanup(func() { operation_setting.Price = previousPrice })
	// ¥7.3 per $1 of balance is 14.6 millionths of CNY per quota unit.
	operation_setting.Price = 7.3
	at := time.Unix(now, 0)

	byModel, err := GetBeaconProfitSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "model", at)
	require.NoError(t, err)
	assert.Equal(t, 7.3, byModel.ReferenceCNYPerUnit)
	assert.Equal(t, BeaconProfitRow{
		Key: "total", Label: "total", Requests: 2, UsageQuota: "1121", UsageMicroCNY: "16367",
		CostedRequests: 1, CostedMicroCNY: "3227", CostMicroCNY: "1588",
		UnmatchedRequests: 1, UnmatchedCostMicroCNY: "21860", PendingRequests: 1, ProfitMicroCNY: "-20221",
	}, byModel.Total)
	require.Len(t, byModel.Rows, 2)
	assert.Equal(t, BeaconProfitRow{
		Key: "claude-sonnet-4-6", Label: "claude-sonnet-4-6", Requests: 1, UsageQuota: "900", UsageMicroCNY: "13140",
		CostedMicroCNY: "0", CostMicroCNY: "0", UnmatchedRequests: 1, UnmatchedCostMicroCNY: "21860", PendingRequests: 1, ProfitMicroCNY: "-21860",
	}, byModel.Rows[0], "unmatched and pending deductions keep the upstream model name")
	assert.Equal(t, BeaconProfitRow{
		Key: "haiku-alias", Label: "haiku-alias", Requests: 1, UsageQuota: "221", UsageMicroCNY: "3227",
		CostedRequests: 1, CostedMicroCNY: "3227", CostMicroCNY: "1588", UnmatchedCostMicroCNY: "0", ProfitMicroCNY: "1639",
	}, byModel.Rows[1], "matched deductions count toward the model the customer asked for, and the request's charge counts once")

	byUser, err := GetBeaconProfitSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "user", at)
	require.NoError(t, err)
	require.Len(t, byUser.Rows, 2)
	assert.Equal(t, "0", byUser.Rows[0].Label, "deductions without a local request have no customer")
	assert.Equal(t, "-21860", byUser.Rows[0].ProfitMicroCNY)
	assert.Equal(t, user.Username, byUser.Rows[1].Label)
	assert.Equal(t, "1121", byUser.Rows[1].UsageQuota)
	assert.Equal(t, "1639", byUser.Rows[1].ProfitMicroCNY)

	byDay, err := GetBeaconProfitSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "day", at)
	require.NoError(t, err)
	require.Len(t, byDay.Rows, 1, "logs and deductions fall on the same Shanghai day")
	assert.Equal(t, "2026-11-19", byDay.Rows[0].Key)
	assert.Equal(t, int64(2), byDay.Rows[0].Requests)
	assert.Equal(t, "-20221", byDay.Rows[0].ProfitMicroCNY)

	byChannel, err := GetBeaconProfitSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "channel", at)
	require.NoError(t, err)
	require.Len(t, byChannel.Rows, 1)
	assert.Equal(t, "supplier-a", byChannel.Rows[0].Label)
	assert.Equal(t, "1121", byChannel.Rows[0].UsageQuota)

	observation, err := LatestBeaconChannelObservation(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, observation)
	assert.Equal(t, "1.8", observation.GroupRatio)

	_, err = GetBeaconProfitSummary(context.Background(), "today", "", "", "token", at)
	assert.ErrorIs(t, err, ErrBeaconCostInput)
}

func TestBeaconUpstreamRateRejectsUnsafeInput(t *testing.T) {
	operator, _, channel := setupBeaconCostTest(t)
	now := time.Now().Unix()
	for _, value := range []string{"0", "-1", "1e3", "1.123456789", "", "abc"} {
		_, err := CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: now, CNYPerUnit: value}, operator.Id, now)
		assert.ErrorIs(t, err, ErrBeaconCostInput, value)
	}
	_, err := CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: now + 400*24*60*60, CNYPerUnit: "1"}, operator.Id, now)
	assert.ErrorIs(t, err, ErrBeaconCostInput)
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id + 100, EffectiveAt: now, CNYPerUnit: "1"}, operator.Id, now)
	assert.Error(t, err)
	rate, err := CreateBeaconUpstreamRate(BeaconUpstreamRate{ID: 99, ChannelID: channel.Id, EffectiveAt: now, CNYPerUnit: " 1.80 ", OperatorID: 7}, operator.Id, now)
	require.NoError(t, err)
	assert.Equal(t, "1.8", rate.CNYPerUnit)
	assert.Equal(t, operator.Id, rate.OperatorID)
	assert.NotEqual(t, int64(99), rate.ID)

	_, err = StoreBeaconUpstreamCharges(channel.Id, "key-a", 0, nil, now)
	assert.ErrorIs(t, err, ErrBeaconCostInput)
}

func TestScaleBeaconBillingExpr(t *testing.T) {
	const sonnet = `tier("base", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)`
	cases := []struct {
		name, expression string
		factor           float64
		want             string
	}{
		{"flat token prices", sonnet, 0.5, `tier("base", p * 1.5 + c * 7.5 + cr * 0.15 + cc * 1.875 + cc1h * 3)`},
		{"rounds up to four significant digits", sonnet, 1.3 * 5.4 / 21.9,
			`tier("base", p * 0.9617 + c * 4.809 + cr * 0.09617 + cc * 1.203 + cc1h * 1.924)`},
		{"context tiers keep thresholds", `len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", 6 * p + 22.5 * c)`, 2,
			`len <= 200000 ? tier("standard", p * 6 + c * 30) : tier("long", 12 * p + 45 * c)`},
		{"request rules keep multipliers", `(tier("base", p * 5 + c * 25)) * (header("anthropic-beta") contains "fast-mode" ? 6 : 1)`, 1.5,
			`(tier("base", p * 7.5 + c * 37.5)) * (header("anthropic-beta") contains "fast-mode" ? 6 : 1)`},
		{"request price", `v1:tier("request", fixed(0.04))`, 2, `v1:tier("request", fixed(0.08))`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ScaleBeaconBillingExpr(tc.expression, tc.factor)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
	for _, expression := range []string{
		`tier("base", (p + c) * 3)`,
		`tier("base", p * 3 + 5)`,
		`tier("base", 3 * p * 2)`,
		`tier("base", u("seconds") * 0.4)`,
	} {
		_, err := ScaleBeaconBillingExpr(expression, 1.2)
		assert.ErrorIs(t, err, ErrBeaconPricingShape, expression)
	}
	_, err := ScaleBeaconBillingExpr(sonnet, 0)
	assert.ErrorIs(t, err, ErrBeaconPricingShape)
}

func TestBeaconUpstreamPriceExpr(t *testing.T) {
	const sonnet = `tier("base", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)`
	source, expression, ok := beaconUpstreamPriceExpr(BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: sonnet}, 500000, map[string]bool{})
	require.True(t, ok)
	assert.Equal(t, BeaconPriceSourceExpr, source)
	assert.Equal(t, sonnet, expression)
	for _, unsafe := range []string{
		`header("x") == "y" ? tier("a", p * 1) : tier("b", p * 2)`,
		`tier("base", p * 3) * (param("n") ?? 1)`,
		`tier("base", p * len(repeat("a", 100000)))`,
		`tier("base", p * 3 + c * 15)` + strings.Repeat(" ", 2000),
	} {
		_, _, ok := beaconUpstreamPriceExpr(BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: unsafe}, 500000, map[string]bool{})
		assert.False(t, ok, unsafe)
	}
	_, expression, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{ModelRatio: 1.5, CompletionRatio: 5, CacheRatio: 0.1}, 500000, nil)
	require.True(t, ok)
	assert.Equal(t, `tier("base", p * 3 + c * 15 + cr * 0.3)`, expression)
	_, expression, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{ModelPrice: 0.04, ModelRatio: 9}, 500000, nil)
	require.True(t, ok)
	assert.Equal(t, `tier("request", fixed(0.04))`, expression)
	_, _, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{}, 500000, nil)
	assert.False(t, ok)
	checked := map[string]bool{}
	for i := range beaconMaxUpstreamExprsPerSync {
		_, _, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: fmt.Sprintf(`tier("base", p * %d)`, i+1)}, 500000, checked)
		require.True(t, ok)
	}
	_, _, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: `tier("base", p * 99)`}, 500000, checked)
	assert.False(t, ok, "one sync checks a bounded number of distinct supplier expressions")
	_, _, ok = beaconUpstreamPriceExpr(BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: `tier("base", p * 1)`}, 500000, checked)
	assert.True(t, ok)
}

func TestBeaconPricingProposalLifecycle(t *testing.T) {
	operator, _, channel := setupBeaconCostTest(t)
	require.NoError(t, DB.AutoMigrate(&Option{}, &Ability{}, &BeaconUpstreamPrice{}, &BeaconPricingRule{}, &BeaconPriceProposal{}))
	t.Cleanup(func() {
		if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			require.NoError(t, DB.Migrator().DropTable(&Option{}, &Ability{}, &BeaconUpstreamPrice{}, &BeaconPricingRule{}, &BeaconPriceProposal{}))
		}
	})
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	const name = "claude-beacon-test"
	const sonnet = `tier("base", p * 3 + c * 15 + cr * 0.3 + cc * 3.75 + cc1h * 6)`
	previousPrice := operation_setting.Price
	operation_setting.Price = 7.3
	t.Cleanup(func() { operation_setting.Price = previousPrice })
	require.Equal(t, float64(1), ratio_setting.GetGroupRatio("default"))
	require.NoError(t, DB.Create(&Ability{Group: "default", Model: name, ChannelId: channel.Id, Enabled: true}).Error)
	setSalePrice := func(expression string) {
		snapshot, err := GetModelPricingSnapshot([]string{name})
		require.NoError(t, err)
		require.NoError(t, UpdateModelPricing([]ModelPricingChange{{ModelName: name, ExpectedVersion: snapshot.Entries[0].Version,
			Pricing: PricingValues{"billing_setting.billing_mode": "tiered_expr", "billing_setting.billing_expr": expression}}}))
	}
	salePrice := func() string {
		snapshot, err := GetModelPricingSnapshot([]string{name})
		require.NoError(t, err)
		return snapshot.Entries[0].Effective["billing_setting.billing_expr"].(string)
	}
	setSalePrice(sonnet)
	require.NoError(t, DB.Model(&Ability{}).Where("model = ?", name).Update("enabled", false).Error)
	report, err := AnalyzeBeaconPricing()
	require.NoError(t, err)
	assert.Empty(t, report.Models, "only models offered by an enabled channel are compared")
	require.NoError(t, DB.Model(&Ability{}).Where("model = ?", name).Update("enabled", true).Error)
	now := time.Now().Unix()
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: now - 3600, CNYPerUnit: "1"}, operator.Id, now)
	require.NoError(t, err)
	logID := int64(0)
	observe := func(groupRatio float64, at int64) {
		logID++
		quota := int64(math.Round((24*3 + 400*15) / 1e6 * 500000 * groupRatio))
		_, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, []BeaconUpstreamRecord{{
			LogID: logID, RequestID: "up-" + strconv.FormatInt(logID, 10), OccurredAt: at, ModelName: name, Group: "ccmax",
			GroupRatio: formatBeaconNumber(groupRatio), PromptTokens: 24, CompletionTokens: 400, Quota: quota,
			Pricing: BeaconUpstreamPricing{BillingMode: "tiered_expr", Expr: sonnet, GroupRatio: groupRatio, HasGroupRatio: true},
		}}, now)
		require.NoError(t, err)
	}
	observe(1.8, now-60)

	// List price ¥21.9 per 1M input against ¥5.4 cost: far above 30%, and the
	// default rule does not follow prices down.
	report, err = AnalyzeBeaconPricing()
	require.NoError(t, err)
	require.Len(t, report.Models, 1)
	analysis := report.Models[0]
	assert.Equal(t, "ok", analysis.Status)
	require.NotNil(t, analysis.CurrentMarkupBP)
	assert.Equal(t, 30555, *analysis.CurrentMarkupBP)
	assert.Empty(t, analysis.ProposedExpr)
	require.Len(t, analysis.Channels, 1)
	assert.Equal(t, int64(1), analysis.Channels[0].VerifiedCount, "the price point reproduces the deducted quota")
	require.Len(t, analysis.Sale, 5)
	for i, want := range []struct {
		kind string
		cny  float64
	}{{"input", 21.9}, {"output", 109.5}, {"cache_read", 2.19}, {"cache_write", 27.375}, {"cache_write_1h", 43.8}} {
		assert.Equal(t, want.kind, analysis.Sale[i].Kind)
		assert.InDelta(t, want.cny, analysis.Sale[i].SaleCNY, 1e-9, want.kind)
	}

	rule := DefaultBeaconPricingRule()
	rule.FollowDown = true
	_, err = SaveBeaconPricingRule(rule, operator.Id, now)
	require.NoError(t, err)
	outcome, err := EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Equal(t, []string{name}, outcome.Proposed)
	var proposal BeaconPriceProposal
	require.NoError(t, DB.Where("status = ?", BeaconProposalPending).First(&proposal).Error)
	assert.Equal(t, `tier("base", p * 0.9617 + c * 4.809 + cr * 0.09617 + cc * 1.203 + cc1h * 1.924)`, proposal.NewExpr)
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Empty(t, outcome.Proposed, "an unchanged proposal stays pending once")
	require.NoError(t, ApplyBeaconPriceProposal(proposal.ID, operator.Id, now))
	assert.Equal(t, proposal.NewExpr, salePrice())
	assert.ErrorIs(t, ApplyBeaconPriceProposal(proposal.ID, operator.Id, now), ErrBeaconProposalClosed)
	report, err = AnalyzeBeaconPricing()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, *report.Models[0].CurrentMarkupBP, 3000)
	assert.Empty(t, report.Models[0].ProposedExpr)

	// The supplier raises its group ratio by a third; an automatic rule within
	// its step limit applies the matching rise at once.
	rule.AutoApply = true
	_, err = SaveBeaconPricingRule(rule, operator.Id, now)
	require.NoError(t, err)
	observe(2.4, now-30)
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Equal(t, []string{name}, outcome.Applied)
	assert.Equal(t, `tier("base", p * 1.283 + c * 6.412 + cr * 0.1283 + cc * 1.604 + cc1h * 2.566)`, salePrice())

	// A second move within a day waits for confirmation, as does a fall
	// beyond the step limit.
	observe(2.6, now-25)
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Equal(t, []string{name}, outcome.Proposed)
	assert.Empty(t, outcome.Applied)
	analysisAt := func() BeaconModelPricing {
		report, err := AnalyzeBeaconPricing()
		require.NoError(t, err)
		return report.Models[0]
	}
	fall := analysisAt()
	fall.factor = 0.4
	allowed, err := beaconAutomaticChangeAllowed(fall, now+2*beaconAutomaticInterval)
	require.NoError(t, err)
	assert.False(t, allowed)
	fall.factor = 0.8
	allowed, err = beaconAutomaticChangeAllowed(fall, now+2*beaconAutomaticInterval)
	require.NoError(t, err)
	assert.True(t, allowed)
	fall.Channels[0].MismatchCount = 1
	allowed, err = beaconAutomaticChangeAllowed(fall, now+2*beaconAutomaticInterval)
	require.NoError(t, err)
	assert.False(t, allowed, "a supplier price that did not reproduce its charges needs confirmation")

	// A rise beyond the step limit waits for confirmation; dismissing it stops
	// the same suggestion from coming back.
	rule.MaxStepBP = 2000
	_, err = SaveBeaconPricingRule(rule, operator.Id, now)
	require.NoError(t, err)
	observe(3.6, now-20)
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Equal(t, []string{name}, outcome.Proposed)
	assert.Empty(t, outcome.Applied)
	proposal = BeaconPriceProposal{}
	require.NoError(t, DB.Where("status = ?", BeaconProposalPending).First(&proposal).Error)
	require.NoError(t, DismissBeaconPriceProposal(proposal.ID, operator.Id, now))
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	assert.Empty(t, outcome.Proposed)
	assert.Equal(t, []string{name}, outcome.BelowMinimum)

	// A manual price edit makes a pending proposal outdated.
	rule.AutoApply = false
	_, err = SaveBeaconPricingRule(rule, operator.Id, now)
	require.NoError(t, err)
	setSalePrice(`tier("base", p * 1 + c * 5 + cr * 0.1 + cc * 1.25 + cc1h * 2)`)
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	require.Equal(t, []string{name}, outcome.Proposed)
	proposal = BeaconPriceProposal{}
	require.NoError(t, DB.Where("status = ?", BeaconProposalPending).First(&proposal).Error)
	setSalePrice(`tier("base", p * 2 + c * 10 + cr * 0.2 + cc * 2.5 + cc1h * 4)`)
	assert.ErrorIs(t, ApplyBeaconPriceProposal(proposal.ID, operator.Id, now), ErrBeaconProposalOutdated)
	require.NoError(t, DB.Where("id = ?", proposal.ID).First(&proposal).Error)
	assert.Equal(t, BeaconProposalSuperseded, proposal.Status)
	assert.Equal(t, `tier("base", p * 2 + c * 10 + cr * 0.2 + cc * 2.5 + cc1h * 4)`, salePrice())

	// The top-up price converts sale prices to CNY; a lower one lowers the
	// sale side of every comparison.
	for _, value := range []string{"0", "-1", "1e3", "abc", "", "1.123456789"} {
		_, err := SetBeaconReferencePrice(value)
		assert.ErrorIs(t, err, ErrBeaconReferencePrice, value)
	}
	assert.Equal(t, 7.3, operation_setting.Price, "a rejected value leaves the price unchanged")
	saved, err := SetBeaconReferencePrice(" 3.650 ")
	require.NoError(t, err)
	assert.Equal(t, "3.65", saved)
	assert.Equal(t, 3.65, operation_setting.Price)
	report, err = AnalyzeBeaconPricing()
	require.NoError(t, err)
	assert.Equal(t, 3.65, report.ReferenceCNYPerUnit)
	assert.InDelta(t, 7.3, report.Models[0].Sale[0].SaleCNY, 1e-9, "$2 per 1M input at ¥3.65")
}
