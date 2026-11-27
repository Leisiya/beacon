package model

import (
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
	"gorm.io/gorm"
)

func setupBeaconCostTest(t *testing.T) (User, User, Channel) {
	t.Helper()
	// Registered first so it runs last, after the ledger fixture restores
	// the database type: reserved column quoting follows the dialect.
	t.Cleanup(initCol)
	operator, user := setupBeaconLedgerTest(t)
	initCol()
	require.NoError(t, DB.AutoMigrate(&Channel{}, &BeaconUpstreamRate{}, &BeaconUpstreamCharge{}, &BeaconUpstreamPayment{}, &BeaconExpense{}))
	t.Cleanup(func() {
		if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			require.NoError(t, DB.Migrator().DropTable(&Channel{}, &BeaconUpstreamRate{}, &BeaconUpstreamCharge{}, &BeaconUpstreamPayment{}, &BeaconExpense{}))
		}
	})
	baseURL := "https://upstream.example"
	channel := Channel{Name: "supplier-a", Key: "sk-test", Status: common.ChannelStatusEnabled, BaseURL: &baseURL}
	require.NoError(t, DB.Create(&channel).Error)
	return operator, user, channel
}

func beaconChargeByRequest(t *testing.T, requestID string) BeaconUpstreamCharge {
	t.Helper()
	var charge BeaconUpstreamCharge
	require.NoError(t, DB.Where("upstream_request_id = ?", requestID).First(&charge).Error)
	return charge
}

func TestBeaconUpstreamChargesKeepTheirPricedCost(t *testing.T) {
	operator, user, channel := setupBeaconCostTest(t)
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC).Unix()
	start := now - 3600
	_, err := CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start, CNYPerUnit: "1", Note: "1 CNY per credit"}, operator.Id, now)
	require.NoError(t, err)
	// The channel maps the customer's "haiku-alias" to the upstream model.
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: user.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "haiku-alias", Quota: 221, UpstreamRequestId: "up-1", CreatedAt: start + 10},
		{UserId: user.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-haiku-4-5", Quota: 50, UpstreamRequestId: "up-5", CreatedAt: start + 50},
	}).Error)

	// New API numbers its token log list by position, newest first.
	records := []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "up-1", OccurredAt: start + 10, ModelName: "claude-haiku-4-5", Group: "ccmax", GroupRatio: "1.8", Quota: 397},
		{LogID: 2, RequestID: "up-3", OccurredAt: start + 5, ModelName: "claude-haiku-4-5", Quota: -5},
		{LogID: 3, RequestID: "up-2", OccurredAt: start - 100, ModelName: "claude-sonnet-4-6", Quota: 5465},
		{LogID: 4, RequestID: "up-4", OccurredAt: start - 1000, ModelName: "claude-sonnet-4-6", Quota: 1000},
	}
	inserted, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records, now)
	require.NoError(t, err)
	assert.Equal(t, 3, inserted, "negative upstream quota is not stored")
	inserted, err = StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records[:1], now)
	require.NoError(t, err)
	assert.Equal(t, 0, inserted, "the same upstream record is stored once")

	// A newer request takes position 1 and every older record moves down one.
	shifted := []BeaconUpstreamRecord{{LogID: 1, RequestID: "up-5", OccurredAt: start + 50, ModelName: "claude-haiku-4-5", Group: "ccmax", GroupRatio: "1.8", Quota: 100}}
	for _, record := range records {
		record.LogID++
		shifted = append(shifted, record)
	}
	inserted, err = StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, shifted, now+300)
	require.NoError(t, err)
	assert.Equal(t, 1, inserted, "only the new record is stored after the list shifts")
	var stored int64
	require.NoError(t, DB.Model(&BeaconUpstreamCharge{}).Count(&stored).Error)
	assert.Equal(t, int64(4), stored)
	fresh := beaconChargeByRequest(t, "up-5")
	require.NotNil(t, fresh.LocalLogID, "the record at a position seen before is matched, not skipped")
	assert.Equal(t, int64(200), fresh.CostMicroCNY)

	priced := beaconChargeByRequest(t, "up-1")
	require.NotNil(t, priced.RateID)
	assert.Equal(t, int64(794), priced.CreditMicro)
	assert.Equal(t, int64(794), priced.CostMicroCNY)
	require.NotNil(t, priced.LocalLogID)
	assert.Equal(t, user.Id, priced.UserID)
	assert.Equal(t, int64(221), priced.LocalQuota)
	assert.Equal(t, "haiku-alias", priced.LocalModelName)
	assert.Equal(t, "1.8", priced.GroupRatio)

	pending := beaconChargeByRequest(t, "up-2")
	assert.Nil(t, pending.RateID, "a charge before the first rate stays pending")
	assert.Nil(t, pending.LocalLogID)

	// A backdated rate prices the pending charge but not the priced one; a
	// later rate change does not reprice existing charges either.
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start - 200, CNYPerUnit: "2", Note: "earlier top-up"}, operator.Id, now)
	require.NoError(t, err)
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: start + 5, CNYPerUnit: "3", Note: "price rise"}, operator.Id, now)
	require.NoError(t, err)
	pending = beaconChargeByRequest(t, "up-2")
	require.NotNil(t, pending.RateID)
	assert.Equal(t, int64(10930), pending.CreditMicro)
	assert.Equal(t, int64(21860), pending.CostMicroCNY)
	assert.Equal(t, int64(794), beaconChargeByRequest(t, "up-1").CostMicroCNY)
	assert.Nil(t, beaconChargeByRequest(t, "up-4").RateID, "a charge before every rate stays pending")

	observation, err := LatestBeaconChannelObservation(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, observation)
	assert.Equal(t, "1.8", observation.GroupRatio)
}

func TestBeaconUpstreamChargesSkipUseBeforeTheChannelWasAdded(t *testing.T) {
	_, _, channel := setupBeaconCostTest(t)
	added := time.Date(2026, 11, 24, 14, 16, 24, 0, time.UTC).Unix()
	require.NoError(t, DB.Model(&channel).Update("created_time", added).Error)
	records := []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "elsewhere", OccurredAt: added - 86400, ModelName: "claude-opus-4-6", Quota: 1000},
		{LogID: 2, RequestID: "skewed-test", OccurredAt: added - 5, ModelName: "claude-opus-4-6", Quota: 220},
		{LogID: 3, RequestID: "after", OccurredAt: added + 60, ModelName: "claude-opus-4-6", Quota: 220},
	}
	inserted, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records, added+600)
	require.NoError(t, err)
	assert.Equal(t, 2, inserted, "a day-old record from before the channel was added is not this site's cost")
	var requests []string
	require.NoError(t, DB.Model(&BeaconUpstreamCharge{}).Order("occurred_at").Pluck("upstream_request_id", &requests).Error)
	assert.Equal(t, []string{"skewed-test", "after"}, requests, "a record seconds early is kept for clock skew")
}

func TestBeaconChannelsStartWithTheirPurchasePrice(t *testing.T) {
	operator, _, _ := setupBeaconCostTest(t)
	require.NoError(t, DB.AutoMigrate(&Ability{}))
	t.Cleanup(func() {
		if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			require.NoError(t, DB.Migrator().DropTable(&Ability{}))
		}
	})
	now := time.Date(2026, 11, 27, 16, 0, 0, 0, time.UTC).Unix()
	batch := func(prefix string, count int) []Channel {
		channels := make([]Channel, count)
		for i := range channels {
			channels[i] = Channel{Name: fmt.Sprintf("%s-%d", prefix, i), Key: "sk", Group: "default", Models: "claude-sonnet-4-6", Status: common.ChannelStatusEnabled, CreatedTime: now}
		}
		return channels
	}
	var channelsBefore, abilitiesBefore int64
	require.NoError(t, DB.Model(&Channel{}).Count(&channelsBefore).Error)
	require.NoError(t, DB.Model(&Ability{}).Count(&abilitiesBefore).Error)

	assert.ErrorIs(t, InsertChannelsWithBeaconRate(batch("unpriced", 2), "", operator.Id, now), ErrBeaconCostInput)
	assert.ErrorIs(t, InsertChannelsWithBeaconRate(batch("free", 2), "0", operator.Id, now), ErrBeaconCostInput)
	var channelsAfter, abilitiesAfter, ratesAfter int64
	require.NoError(t, DB.Model(&Channel{}).Count(&channelsAfter).Error)
	require.NoError(t, DB.Model(&Ability{}).Count(&abilitiesAfter).Error)
	require.NoError(t, DB.Model(&BeaconUpstreamRate{}).Count(&ratesAfter).Error)
	assert.Equal(t, channelsBefore, channelsAfter, "a channel without a valid purchase price is not created")
	assert.Equal(t, abilitiesBefore, abilitiesAfter)
	assert.Zero(t, ratesAfter)

	// More than one insert chunk, so every chunk's channels get their rate.
	channels := batch("priced", 51)
	require.NoError(t, InsertChannelsWithBeaconRate(channels, "1.10", operator.Id, now))
	var rates []BeaconUpstreamRate
	require.NoError(t, DB.Order("channel_id").Find(&rates).Error)
	require.Len(t, rates, 51)
	for i, rate := range rates {
		assert.Equal(t, channels[i].Id, rate.ChannelID)
		assert.Equal(t, "1.1", rate.CNYPerUnit)
		assert.Equal(t, now-beaconChannelAddedSkew, rate.EffectiveAt, "the rate covers every upstream record cost sync keeps")
		assert.Equal(t, operator.Id, rate.OperatorID)
	}
	require.NoError(t, DB.Model(&Ability{}).Count(&abilitiesAfter).Error)
	assert.Equal(t, int64(51), abilitiesAfter)

	last := channels[50].Id
	require.NoError(t, DB.Create(&BeaconUpstreamRate{ChannelID: last, EffectiveAt: now + 3600, CNYPerUnit: "1.2", RecordedAt: now}).Error)
	inEffect, err := BeaconRateInEffect(last, now)
	require.NoError(t, err)
	require.NotNil(t, inEffect)
	assert.Equal(t, "1.1", inEffect.CNYPerUnit, "a later rate is not in effect yet")
	inEffect, err = BeaconRateInEffect(last, now+3600)
	require.NoError(t, err)
	assert.Equal(t, "1.2", inEffect.CNYPerUnit)
	inEffect, err = BeaconRateInEffect(last, now-beaconChannelAddedSkew-1)
	require.NoError(t, err)
	assert.Nil(t, inEffect)
}

func TestMigrateBeaconChargeSourceKeyRemovesShiftedCopies(t *testing.T) {
	_, _, channel := setupBeaconCostTest(t)
	migrator := DB.Migrator()
	statement := &gorm.Statement{DB: DB}
	require.NoError(t, statement.Parse(&BeaconUpstreamCharge{}))
	table := statement.Schema.Table
	// Recreate the earlier identity: unique by upstream list position.
	require.NoError(t, migrator.DropIndex(&BeaconUpstreamCharge{}, "idx_beacon_charge_record"))
	require.NoError(t, DB.Exec("CREATE UNIQUE INDEX idx_beacon_charge_source ON "+table+" (channel_id, key_fingerprint, upstream_log_id)").Error)
	base := BeaconUpstreamCharge{ChannelID: channel.Id, KeyFingerprint: "key-a", OccurredAt: 1795000000, ModelName: "claude-haiku-4-5", QuotaPerUnit: 500000}
	rows := []BeaconUpstreamCharge{base, base, base, base}
	rows[0].UpstreamLogID, rows[0].UpstreamRequestID, rows[0].UpstreamQuota = 1, "up-1", 70
	rows[1].UpstreamLogID, rows[1].UpstreamRequestID, rows[1].UpstreamQuota = 2, "up-2", 66
	// The same two records stored again after the list shifted by two.
	rows[2].UpstreamLogID, rows[2].UpstreamRequestID, rows[2].UpstreamQuota = 3, "up-1", 70
	rows[3].UpstreamLogID, rows[3].UpstreamRequestID, rows[3].UpstreamQuota = 4, "up-2", 66
	require.NoError(t, DB.Create(&rows).Error)

	for range 2 {
		require.NoError(t, migrateBeaconChargeSourceKey(DB))
		require.NoError(t, DB.AutoMigrate(&BeaconUpstreamCharge{}))
	}

	var kept []BeaconUpstreamCharge
	require.NoError(t, DB.Order("id").Find(&kept).Error)
	require.Len(t, kept, 2)
	assert.Equal(t, []int64{rows[0].ID, rows[1].ID}, []int64{kept[0].ID, kept[1].ID}, "the first copy of each record is kept")
	assert.Equal(t, beaconChargeSourceKey(&kept[0]), kept[0].SourceKey)
	assert.NotEqual(t, kept[0].SourceKey, kept[1].SourceKey)
	assert.False(t, migrator.HasIndex(&BeaconUpstreamCharge{}, "idx_beacon_charge_source"))
	assert.True(t, migrator.HasIndex(&BeaconUpstreamCharge{}, "idx_beacon_charge_record"))
	inserted, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "up-3", OccurredAt: 1795000100, ModelName: "claude-haiku-4-5", Quota: 80},
		{LogID: 2, RequestID: "up-1", OccurredAt: 1795000000, ModelName: "claude-haiku-4-5", Quota: 70},
	}, 1795000200)
	require.NoError(t, err)
	assert.Equal(t, 1, inserted, "a migrated record is recognised at its new position")
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
	previousPrice, previousRate := operation_setting.Price, operation_setting.USDExchangeRate
	operation_setting.Price, operation_setting.USDExchangeRate = 7.3, 7.3
	t.Cleanup(func() { operation_setting.Price, operation_setting.USDExchangeRate = previousPrice, previousRate })
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
	assert.Equal(t, float64(1), analysis.GroupRatio)

	// Customers pay their group's ratio on top; the cheapest group selling
	// the model is the price compared, whatever the default group's ratio.
	previousGroupRatio := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroupRatio)) })
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":2,"vip":1.5,"ccmax":1.2}`))
	require.NoError(t, DB.Create(&[]Ability{{Group: "vip", Model: name, ChannelId: channel.Id, Enabled: true}, {Group: "ccmax", Model: name, ChannelId: channel.Id, Enabled: true}}).Error)
	report, err = AnalyzeBeaconPricing()
	require.NoError(t, err)
	require.Len(t, report.Models, 1)
	assert.Equal(t, 1.2, report.Models[0].GroupRatio)
	assert.InDelta(t, 21.9*1.2, report.Models[0].Sale[0].SaleCNY, 1e-9)
	require.NotNil(t, report.Models[0].CurrentMarkupBP)
	assert.Equal(t, 38666, *report.Models[0].CurrentMarkupBP, "¥26.28 against ¥5.4")
	require.NoError(t, DB.Where(commonGroupCol+" IN ?", []string{"vip", "ccmax"}).Delete(&Ability{}).Error)
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroupRatio))

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
	assert.Equal(t, 3.65, operation_setting.USDExchangeRate, "the display rate follows, so every page shows the same price")
	report, err = AnalyzeBeaconPricing()
	require.NoError(t, err)
	assert.Equal(t, 3.65, report.ReferenceCNYPerUnit)
	assert.InDelta(t, 7.3, report.Models[0].Sale[0].SaleCNY, 1e-9, "$2 per 1M input at ¥3.65")

	// A raise worked out at ¥3.65 must not be applied once the top-up price
	// is back at ¥7.3, where the current price already clears the target.
	outcome, err = EvaluateBeaconPricing(now)
	require.NoError(t, err)
	require.Equal(t, []string{name}, outcome.Proposed)
	proposal = BeaconPriceProposal{}
	require.NoError(t, DB.Where("status = ?", BeaconProposalPending).First(&proposal).Error)
	_, err = SetBeaconReferencePrice("7.3")
	require.NoError(t, err)
	assert.ErrorIs(t, ApplyBeaconPriceProposal(proposal.ID, operator.Id, now), ErrBeaconProposalOutdated)
	require.NoError(t, DB.Where("id = ?", proposal.ID).First(&proposal).Error)
	assert.Equal(t, BeaconProposalSuperseded, proposal.Status)
	assert.Equal(t, `tier("base", p * 2 + c * 10 + cr * 0.2 + cc * 2.5 + cc1h * 4)`, salePrice(), "the sale price is unchanged")
}
