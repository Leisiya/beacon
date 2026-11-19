package model

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupBeaconCostTest(t *testing.T) (User, User, Channel) {
	t.Helper()
	operator, user := setupBeaconLedgerTest(t)
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
	require.NoError(t, LOG_DB.Create(&Log{UserId: user.Id, Type: LogTypeConsume, ChannelId: channel.Id, Quota: 221, UpstreamRequestId: "up-1", CreatedAt: start + 10}).Error)

	records := []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "up-1", OccurredAt: start + 10, ModelName: "claude-haiku-4-5", Group: "ccmax", GroupRatio: "1.8", Quota: 397},
		{LogID: 2, RequestID: "up-2", OccurredAt: start - 100, ModelName: "claude-sonnet-4-6", Quota: 5465},
		{LogID: 3, RequestID: "up-3", OccurredAt: start + 20, ModelName: "claude-haiku-4-5", Quota: -5},
	}
	inserted, err := StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, records, now)
	require.NoError(t, err)
	assert.Equal(t, 2, inserted, "negative upstream quota is not stored")
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

	summary, err := GetBeaconCostSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "model", time.Unix(now, 0))
	require.NoError(t, err)
	assert.Equal(t, int64(2), summary.Total.Calls)
	assert.Equal(t, int64(1), summary.Total.UnmatchedCalls)
	assert.Equal(t, int64(0), summary.Total.PendingCalls)
	assert.Equal(t, "22654", summary.Total.CostMicroCNY)
	assert.Equal(t, "11724", summary.Total.CreditMicro)
	assert.Equal(t, "221", summary.Total.LocalQuota)
	require.Len(t, summary.Rows, 2)
	assert.Equal(t, "claude-haiku-4-5", summary.Rows[0].Key)
	assert.Equal(t, "794", summary.Rows[0].CostMicroCNY)

	byChannel, err := GetBeaconCostSummary(context.Background(), "custom", "2026-11-19", "2026-11-19", "channel", time.Unix(now, 0))
	require.NoError(t, err)
	require.Len(t, byChannel.Rows, 1)
	assert.Equal(t, "supplier-a", byChannel.Rows[0].Label)

	observation, err := LatestBeaconChannelObservation(channel.Id)
	require.NoError(t, err)
	require.NotNil(t, observation)
	assert.Equal(t, "1.8", observation.GroupRatio)

	_, err = GetBeaconCostSummary(context.Background(), "today", "", "", "token", time.Unix(now, 0))
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
