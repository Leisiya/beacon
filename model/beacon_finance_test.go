package model

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBeaconCustomerBookUsesGiftFirstAndPaidAtAveragePrice(t *testing.T) {
	type step struct {
		ledger       bool
		cents, quota int64
	}
	for _, tc := range []struct {
		name      string
		steps     []step
		revenue   int64
		giftUsed  int64
		unpaid    int64
		paidQuota int64
		paidValue int64
	}{
		{
			name:    "gifted balance is used before purchased balance",
			steps:   []step{{true, 10000, 1_000_000}, {true, 0, 250_000}, {false, 0, 400_000}},
			revenue: 15_000_000, giftUsed: 250_000, paidQuota: 850_000, paidValue: 85_000_000,
		},
		{
			name:   "usage with no recorded credit earns nothing",
			steps:  []step{{false, 0, 100}},
			unpaid: 100,
		},
		{
			name: "a refund larger than the unused value settles into revenue",
			steps: []step{
				{true, 10000, 1_000_000}, {true, 1000, 1_000_000}, {false, 0, 1_000_000},
				{true, -10000, -1_000_000},
			},
			revenue: 10_000_000,
		},
		{
			name:    "net refunded usage returns balance at its value",
			steps:   []step{{true, 10000, 1_000_000}, {false, 0, 500_000}, {false, 0, -100_000}},
			revenue: 40_000_000, paidQuota: 600_000, paidValue: 60_000_000,
		},
		{
			name:   "a gift reversal takes back unused gifted balance",
			steps:  []step{{true, 0, 100}, {true, 0, -100}, {false, 0, 50}},
			unpaid: 50,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			book := &beaconCustomerBook{days: map[int64]*beaconCustomerDay{}}
			for i, item := range tc.steps {
				day := book.day(int64(i))
				if item.ledger {
					book.credit(day, item.cents, item.quota)
				} else {
					book.use(day, item.quota)
				}
			}
			var paid, revenue decimal.Decimal
			var giftUsed, unpaid int64
			for _, day := range book.days {
				paid, revenue = paid.Add(day.paid), revenue.Add(day.revenue)
				giftUsed, unpaid = giftUsed+day.giftUsed, unpaid+day.unpaid
			}
			assert.Equal(t, strconv.FormatInt(tc.revenue, 10), beaconMicroString(revenue))
			assert.Equal(t, tc.giftUsed, giftUsed)
			assert.Equal(t, tc.unpaid, unpaid)
			assert.Equal(t, tc.paidQuota, book.paidQuota)
			assert.Equal(t, strconv.FormatInt(tc.paidValue, 10), beaconMicroString(book.paidValue))
			assert.True(t, paid.Equal(revenue.Add(book.paidValue)), "paid = revenue + unused value")
		})
	}
}

func TestBeaconFinanceViews(t *testing.T) {
	operator, customer, channel := setupBeaconCostTest(t)
	ctx := context.Background()
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	// 10:00 in Shanghai yesterday (2026-11-18) and today (2026-11-19).
	yesterday := time.Date(2026, 11, 18, 2, 0, 0, 0, time.UTC).Unix()
	today := yesterday + 86400

	_, _, err := PostBeaconLedgerEntry(BeaconLedgerInput{
		IdempotencyKey: "finance-receipt-0001", Kind: BeaconReceipt, UserID: customer.Id,
		Amount: "100.00", Currency: "CNY", CNYPerUnit: "1", FXSource: "received in CNY",
		Quota: 1_000_000, PaymentMethod: "wechat", PaymentReference: "finance-receipt-0001",
		OccurredAt: yesterday, Note: "test receipt, no real funds",
	}, operator.Id)
	require.NoError(t, err)
	_, _, err = PostBeaconLedgerEntry(BeaconLedgerInput{
		IdempotencyKey: "finance-gift-000001", Kind: BeaconGift, UserID: customer.Id, Quota: 250_000,
		OccurredAt: yesterday + 60, Note: "trial gift",
	}, operator.Id)
	require.NoError(t, err)
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: customer.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-sonnet-4-6", Quota: 400_000, UpstreamRequestId: "f-1", CreatedAt: yesterday + 3600},
		{UserId: customer.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-sonnet-4-6", Quota: 200_000, UpstreamRequestId: "f-2", CreatedAt: today},
		{UserId: customer.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-haiku-4-5", Quota: 100_000, UpstreamRequestId: "f-3", CreatedAt: today + 60},
		{UserId: customer.Id, Type: LogTypeRefund, ChannelId: channel.Id, ModelName: "claude-sonnet-4-6", Quota: 100_000, CreatedAt: today + 120},
		// Testing by the operator, whose balance never went through the ledger.
		{UserId: operator.Id, Type: LogTypeConsume, ChannelId: channel.Id, ModelName: "claude-haiku-4-5", Quota: 50_000, CreatedAt: today + 180},
	}).Error)
	_, err = CreateBeaconUpstreamRate(BeaconUpstreamRate{ChannelID: channel.Id, EffectiveAt: yesterday - 3600, CNYPerUnit: "1", Note: "1 CNY per credit"}, operator.Id, now.Unix())
	require.NoError(t, err)
	_, err = StoreBeaconUpstreamCharges(channel.Id, "key-a", 500000, []BeaconUpstreamRecord{
		{LogID: 1, RequestID: "x-1", OccurredAt: today + 300, ModelName: "claude-sonnet-4-6", Quota: 500_000},
		{LogID: 2, RequestID: "f-2", OccurredAt: today, ModelName: "claude-sonnet-4-6", Quota: 1_500_000},
		{LogID: 3, RequestID: "f-1", OccurredAt: yesterday + 3600, ModelName: "claude-sonnet-4-6", Quota: 2_000_000},
		{LogID: 4, RequestID: "p-1", OccurredAt: yesterday - 7200, ModelName: "claude-sonnet-4-6", Quota: 250_000},
	}, now.Unix())
	require.NoError(t, err)

	first, created, err := CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
		RequestKey: "finance-payment-0001", ChannelID: channel.Id, Amount: "50", Credit: "50", OccurredAt: yesterday, Note: "first top-up",
	}, operator.Id, now.Unix())
	require.NoError(t, err)
	assert.True(t, created)
	second, _, err := CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
		RequestKey: "finance-payment-0002", ChannelID: channel.Id, Amount: "20.00", Credit: "20", OccurredAt: today,
	}, operator.Id, now.Unix())
	require.NoError(t, err)
	reversal, _, err := CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
		RequestKey: "finance-reversal-002", CorrectsID: second.ID, OccurredAt: today + 60, Note: "entered twice",
	}, operator.Id, now.Unix())
	require.NoError(t, err)
	assert.Equal(t, int64(-2000), reversal.CNYAmountMinor)
	assert.Equal(t, int64(-20_000_000), reversal.CreditMicro)
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", channel.Id).Updates(map[string]any{"balance": 41.2, "balance_updated_time": today}).Error)

	t.Run("overview", func(t *testing.T) {
		overview, err := GetBeaconFinanceOverview(ctx, now)
		require.NoError(t, err)
		assert.Equal(t, BeaconProfitTotals{RevenueMicroCNY: "20000000", CostMicroCNY: "4000000", ProfitMicroCNY: "16000000"}, overview.Today)
		assert.Equal(t, BeaconProfitTotals{RevenueMicroCNY: "35000000", CostMicroCNY: "8000000", ProfitMicroCNY: "27000000"}, overview.Month)
		assert.Equal(t, overview.Month, overview.All)
		assert.Equal(t, []string{"100000000", "35000000", "65000000"},
			[]string{overview.CustomerPaidMicroCNY, overview.CustomerUsedMicroCNY, overview.CustomerRemainingMicroCNY}, "customers: paid = used + remaining")
		assert.Equal(t, []string{"50000000", "8000000", "42000000"},
			[]string{overview.UpstreamPaidMicroCNY, overview.UpstreamUsedMicroCNY, overview.UpstreamRemainingMicroCNY}, "a reversed payment counts for nothing")
		assert.Equal(t, "50000000", overview.CashMicroCNY)
		assert.Equal(t, int64(1), overview.PendingCharges)
	})

	t.Run("profit by day", func(t *testing.T) {
		byDay, err := GetBeaconProfitSummary(ctx, "custom", "2026-11-18", "2026-11-19", "day", now)
		require.NoError(t, err)
		assert.Equal(t, []BeaconProfitRow{
			{Key: "2026-11-19", Label: "2026-11-19", Requests: 3, UsageQuota: "250000", RevenueMicroCNY: "20000000", CostMicroCNY: "4000000", ProfitMicroCNY: "16000000"},
			{Key: "2026-11-18", Label: "2026-11-18", Requests: 1, UsageQuota: "400000", RevenueMicroCNY: "15000000", CostMicroCNY: "4000000", ProfitMicroCNY: "11000000"},
		}, byDay.Rows, "newest day first")
		assert.Equal(t, BeaconProfitRow{Key: "total", Label: "total", Requests: 4, UsageQuota: "650000", RevenueMicroCNY: "35000000", CostMicroCNY: "8000000", ProfitMicroCNY: "27000000"}, byDay.Total)
		assert.Equal(t, "250000", byDay.GiftQuota)
		assert.Equal(t, "50000", byDay.UnpaidQuota)
		assert.Equal(t, int64(1), byDay.PendingCharges)
		assert.Zero(t, byDay.UncostedRequests)
	})

	t.Run("profit by customer, model and channel", func(t *testing.T) {
		byUser, err := GetBeaconProfitSummary(ctx, "today", "", "", "user", now)
		require.NoError(t, err)
		assert.Equal(t, []BeaconProfitRow{
			{Key: "0", Label: "0", UsageQuota: "0", RevenueMicroCNY: "0", CostMicroCNY: "1000000", ProfitMicroCNY: "-1000000"},
			{Key: strconv.Itoa(operator.Id), Label: operator.Username, Requests: 1, UsageQuota: "50000", RevenueMicroCNY: "0", CostMicroCNY: "0", ProfitMicroCNY: "0"},
			{Key: strconv.Itoa(customer.Id), Label: customer.Username, Requests: 2, UsageQuota: "200000", RevenueMicroCNY: "20000000", CostMicroCNY: "3000000", ProfitMicroCNY: "17000000"},
		}, byUser.Rows, "a deduction with no local request has no customer")

		byModel, err := GetBeaconProfitSummary(ctx, "today", "", "", "model", now)
		require.NoError(t, err)
		assert.Equal(t, []BeaconProfitRow{
			{Key: "claude-haiku-4-5", Label: "claude-haiku-4-5", Requests: 2, UsageQuota: "150000", RevenueMicroCNY: "10000000", CostMicroCNY: "0", ProfitMicroCNY: "10000000"},
			{Key: "claude-sonnet-4-6", Label: "claude-sonnet-4-6", Requests: 1, UsageQuota: "100000", RevenueMicroCNY: "10000000", CostMicroCNY: "4000000", ProfitMicroCNY: "6000000"},
		}, byModel.Rows, "a day's revenue is shared by quota; refunds reduce their model's share")

		byChannel, err := GetBeaconProfitSummary(ctx, "today", "", "", "channel", now)
		require.NoError(t, err)
		require.Len(t, byChannel.Rows, 1)
		assert.Equal(t, "supplier-a", byChannel.Rows[0].Label)
		assert.Equal(t, "16000000", byChannel.Rows[0].ProfitMicroCNY)

		_, err = GetBeaconProfitSummary(ctx, "today", "", "", "token", now)
		assert.ErrorIs(t, err, ErrBeaconCostInput)
	})

	t.Run("customers", func(t *testing.T) {
		todayRows, err := GetBeaconCustomerFinance(ctx, "today", "", "", now)
		require.NoError(t, err)
		require.Len(t, todayRows.Rows, 2)
		assert.Equal(t, BeaconCustomerFinanceRow{
			UserID: operator.Id, Username: operator.Username, PaidMicroCNY: "0", UsedMicroCNY: "0", UsageQuota: "50000",
			GiftQuota: "0", UnpaidQuota: "50000", RemainingMicroCNY: "0", BalanceQuota: "0",
		}, todayRows.Rows[0])
		assert.Equal(t, BeaconCustomerFinanceRow{
			UserID: customer.Id, Username: customer.Username, PaidMicroCNY: "0", UsedMicroCNY: "20000000", UsageQuota: "200000",
			GiftQuota: "0", UnpaidQuota: "0", RemainingMicroCNY: "65000000", BalanceQuota: "1250000",
		}, todayRows.Rows[1], "remaining is now, whatever the period")

		month, err := GetBeaconCustomerFinance(ctx, "month", "", "", now)
		require.NoError(t, err)
		assert.Equal(t, "100000000", month.Total.PaidMicroCNY)
		assert.Equal(t, "35000000", month.Total.UsedMicroCNY)
		assert.Equal(t, "250000", month.Total.GiftQuota)
		assert.Equal(t, "65000000", month.Total.RemainingMicroCNY)
	})

	t.Run("upstreams and payments", func(t *testing.T) {
		todayRows, err := GetBeaconUpstreamFinance(ctx, "today", "", "", now)
		require.NoError(t, err)
		require.Len(t, todayRows.Rows, 1)
		assert.Equal(t, BeaconUpstreamFinanceRow{
			ChannelID: channel.Id, Name: "supplier-a", PaidMicroCNY: "0", PaidCreditMicro: "0",
			UsedMicroCNY: "4000000", UsedCreditMicro: "4000000", RemainingMicroCNY: "42000000", RemainingCreditMicro: "41500000",
			CNYPerUnit: "1", ReportedBalance: 41.2, ReportedAt: today,
		}, todayRows.Rows[0], "a payment and its reversal on the same day cancel out")

		month, err := GetBeaconUpstreamFinance(ctx, "month", "", "", now)
		require.NoError(t, err)
		assert.Equal(t, "50000000", month.Total.PaidMicroCNY)
		assert.Equal(t, "8000000", month.Total.UsedMicroCNY)
		assert.Equal(t, "8500000", month.Total.UsedCreditMicro, "pending deductions still use up credit")
		assert.Equal(t, int64(1), month.Total.PendingCharges)

		payments, err := ListBeaconUpstreamPayments(channel.Id)
		require.NoError(t, err)
		require.Len(t, payments, 3)
		assert.Equal(t, []int64{reversal.ID, second.ID, first.ID}, []int64{payments[0].ID, payments[1].ID, payments[2].ID})
		require.NotNil(t, payments[1].ReversalID)
		assert.Equal(t, reversal.ID, *payments[1].ReversalID)
		assert.Nil(t, payments[2].ReversalID)
	})

	t.Run("payment input", func(t *testing.T) {
		repeat, created, err := CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
			RequestKey: "finance-payment-0001", ChannelID: channel.Id, Amount: "50.00", Credit: "50.000", OccurredAt: yesterday, Note: "first top-up",
		}, operator.Id, now.Unix())
		require.NoError(t, err)
		assert.False(t, created, "a resubmitted form returns the stored payment")
		assert.Equal(t, first.ID, repeat.ID)
		_, _, err = CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
			RequestKey: "finance-payment-0001", ChannelID: channel.Id, Amount: "60", Credit: "50", OccurredAt: yesterday, Note: "first top-up",
		}, operator.Id, now.Unix())
		assert.ErrorIs(t, err, ErrBeaconPaymentConflict)
		_, _, err = CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
			RequestKey: "finance-reversal-003", CorrectsID: second.ID, OccurredAt: today, Note: "again",
		}, operator.Id, now.Unix())
		assert.ErrorIs(t, err, ErrBeaconPaymentReversed)
		_, _, err = CreateBeaconUpstreamPayment(BeaconUpstreamPaymentInput{
			RequestKey: "finance-payment-0404", ChannelID: channel.Id + 1000, Amount: "1", Credit: "1", OccurredAt: today,
		}, operator.Id, now.Unix())
		assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
		for _, input := range []BeaconUpstreamPaymentInput{
			{ChannelID: channel.Id, Amount: "0", Credit: "1"},
			{ChannelID: channel.Id, Amount: "1", Credit: "-1"},
			{ChannelID: channel.Id, Amount: "1.001", Credit: "1"},
			{ChannelID: channel.Id, Amount: "1", Credit: "1.0000001"},
			{ChannelID: channel.Id, Amount: "1", Credit: "1", Note: strings.Repeat("x", 501)},
			{ChannelID: channel.Id, Amount: "1", Credit: "1", OccurredAt: now.Unix() + 3600},
			{CorrectsID: reversal.ID, Note: "reverse a reversal"},
			{CorrectsID: first.ID},
			{CorrectsID: first.ID, ChannelID: channel.Id, Note: "with amounts"},
		} {
			input.RequestKey = "finance-invalid-0001"
			if input.OccurredAt == 0 {
				input.OccurredAt = today
			}
			_, _, err := CreateBeaconUpstreamPayment(input, operator.Id, now.Unix())
			assert.ErrorIs(t, err, ErrBeaconPaymentInput, "%+v", input)
		}
	})
}
