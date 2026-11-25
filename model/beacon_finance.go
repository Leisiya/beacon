package model

import (
	"context"
	"errors"
	"maps"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	BeaconUpstreamPaymentKind  = "payment"
	BeaconUpstreamReversalKind = "reversal"
)

var (
	ErrBeaconPaymentInput    = errors.New("invalid upstream payment input")
	ErrBeaconPaymentConflict = errors.New("request key was used for another upstream payment")
	ErrBeaconPaymentReversed = errors.New("upstream payment has already been reversed")
	beaconCreditPattern      = regexp.MustCompile(`^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$`)
)

// BeaconUpstreamPayment is money sent to a supplier for credit on one
// channel's account. Rows are append-only: a mistake is cancelled by a linked
// reversal row carrying the opposite amounts.
type BeaconUpstreamPayment struct {
	ID             int64  `json:"id" gorm:"primaryKey"`
	RequestKey     string `json:"-" gorm:"type:varchar(64);not null;uniqueIndex"`
	Kind           string `json:"kind" gorm:"type:varchar(16);not null"`
	ChannelID      int    `json:"channel_id" gorm:"not null;index"`
	CNYAmountMinor int64  `json:"cny_amount_minor" gorm:"type:bigint;not null"`
	// CreditMicro is the upstream credit bought, in millionths of the
	// upstream's "$1", the same unit as BeaconUpstreamCharge.CreditMicro.
	CreditMicro int64  `json:"credit_micro" gorm:"type:bigint;not null"`
	CorrectsID  *int64 `json:"corrects_id" gorm:"uniqueIndex"`
	OccurredAt  int64  `json:"occurred_at" gorm:"not null;index"`
	OperatorID  int    `json:"operator_id" gorm:"not null"`
	RecordedAt  int64  `json:"recorded_at" gorm:"not null"`
	Note        string `json:"note" gorm:"type:varchar(500);not null"`
}

// BeaconUpstreamPaymentInput takes money as decimal text: CNY with up to two
// decimals and upstream credit with up to six. A reversal names only the
// payment it cancels, with its own time and reason.
type BeaconUpstreamPaymentInput struct {
	RequestKey string `json:"request_key"`
	ChannelID  int    `json:"channel_id"`
	Amount     string `json:"amount"`
	Credit     string `json:"credit"`
	CorrectsID int64  `json:"corrects_id"`
	OccurredAt int64  `json:"occurred_at"`
	Note       string `json:"note"`
}

// CreateBeaconUpstreamPayment records a payment or reversal. Repeating a
// request key with the same details returns the stored row with created
// false, so a resubmitted form does not record the payment twice.
func CreateBeaconUpstreamPayment(input BeaconUpstreamPaymentInput, operatorID int, now int64) (*BeaconUpstreamPayment, bool, error) {
	input.RequestKey = strings.TrimSpace(input.RequestKey)
	input.Amount = strings.TrimSpace(input.Amount)
	input.Credit = strings.TrimSpace(input.Credit)
	input.Note = strings.TrimSpace(input.Note)
	if !beaconRequestKeyPattern.MatchString(input.RequestKey) || !utf8.ValidString(input.Note) ||
		utf8.RuneCountInString(input.Note) > 500 || strings.ContainsRune(input.Note, '\x00') ||
		input.OccurredAt < 946684800 || input.OccurredAt > now+300 {
		return nil, false, ErrBeaconPaymentInput
	}
	payment := BeaconUpstreamPayment{RequestKey: input.RequestKey, OccurredAt: input.OccurredAt, OperatorID: operatorID, RecordedAt: now, Note: input.Note}
	if input.CorrectsID == 0 {
		if input.ChannelID <= 0 || !beaconMoneyPattern.MatchString(input.Amount) || !beaconCreditPattern.MatchString(input.Credit) {
			return nil, false, ErrBeaconPaymentInput
		}
		amount, err := decimal.NewFromString(input.Amount)
		if err != nil {
			return nil, false, ErrBeaconPaymentInput
		}
		credit, err := decimal.NewFromString(input.Credit)
		if err != nil {
			return nil, false, ErrBeaconPaymentInput
		}
		cents, micro, limit := amount.Shift(2), credit.Shift(6), decimal.NewFromInt(beaconMaxMoneyMinor)
		if !cents.IsPositive() || !micro.IsPositive() || cents.GreaterThan(limit) || micro.GreaterThan(limit) {
			return nil, false, ErrBeaconPaymentInput
		}
		payment.Kind, payment.ChannelID = BeaconUpstreamPaymentKind, input.ChannelID
		payment.CNYAmountMinor, payment.CreditMicro = cents.IntPart(), micro.IntPart()
	} else {
		if input.CorrectsID < 0 || input.ChannelID != 0 || input.Amount != "" || input.Credit != "" {
			return nil, false, ErrBeaconPaymentInput
		}
		payment.Kind, payment.CorrectsID = BeaconUpstreamReversalKind, &input.CorrectsID
	}

	want := payment
	created := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing BeaconUpstreamPayment
		if err := tx.Where("request_key = ?", payment.RequestKey).Limit(1).Find(&existing).Error; err != nil {
			return err
		}
		if existing.ID != 0 {
			payment = existing
			return nil
		}
		if payment.CorrectsID != nil {
			var original BeaconUpstreamPayment
			if err := tx.First(&original, *payment.CorrectsID).Error; err != nil {
				return err
			}
			if original.Kind != BeaconUpstreamPaymentKind {
				return ErrBeaconPaymentInput
			}
			var reversals int64
			if err := tx.Model(&BeaconUpstreamPayment{}).Where("corrects_id = ?", original.ID).Count(&reversals).Error; err != nil {
				return err
			}
			if reversals > 0 {
				return ErrBeaconPaymentReversed
			}
			payment.ChannelID, payment.CNYAmountMinor, payment.CreditMicro = original.ChannelID, -original.CNYAmountMinor, -original.CreditMicro
		} else if err := tx.Select("id").First(&Channel{}, payment.ChannelID).Error; err != nil {
			return err
		}
		if err := tx.Create(&payment).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if created {
		return &payment, true, nil
	}
	sameTarget := payment.CorrectsID == nil && want.CorrectsID == nil
	if payment.CorrectsID != nil && want.CorrectsID != nil {
		sameTarget = *payment.CorrectsID == *want.CorrectsID
	}
	if payment.Kind != want.Kind || payment.OccurredAt != want.OccurredAt || payment.Note != want.Note || !sameTarget ||
		(want.Kind == BeaconUpstreamPaymentKind && (payment.ChannelID != want.ChannelID ||
			payment.CNYAmountMinor != want.CNYAmountMinor || payment.CreditMicro != want.CreditMicro)) {
		return nil, false, ErrBeaconPaymentConflict
	}
	return &payment, false, nil
}

// beaconDaySQL is the start of the Asia/Shanghai calendar day of a Unix
// timestamp column. Shanghai has had a fixed UTC+08 offset since 1991.
func beaconDaySQL(column string) string {
	return column + " - (" + column + " + 28800) % 86400"
}

func beaconDayStart(at int64) int64 {
	return at - (at+28800)%86400
}

func beaconDayLabel(dayStart int64) string {
	return time.Unix(dayStart, 0).In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format(time.DateOnly)
}

// beaconCustomerDay is one customer's money and usage on one calendar day.
// Money is in millionths of CNY, quota in quota units.
type beaconCustomerDay struct {
	paid     decimal.Decimal // net cash recorded in the ledger
	revenue  decimal.Decimal // value of the purchased balance used up
	usage    int64           // consume logs minus refund logs
	giftUsed int64
	unpaid   int64 // usage with no recorded credit behind it
}

// beaconCustomerBook replays one customer's ledger credits and usage. Gifted
// balance is used first and earns nothing; purchased balance is valued at its
// average paid price. Paid always equals revenue plus paidValue.
type beaconCustomerBook struct {
	days      map[int64]*beaconCustomerDay
	gift      int64
	paidQuota int64
	paidValue decimal.Decimal
}

func (book *beaconCustomerBook) day(dayStart int64) *beaconCustomerDay {
	day := book.days[dayStart]
	if day == nil {
		day = &beaconCustomerDay{}
		book.days[dayStart] = day
	}
	return day
}

// dayIn returns the day without creating it; a customer with no book has none.
func (book *beaconCustomerBook) dayIn(dayStart int64) *beaconCustomerDay {
	if book == nil {
		return nil
	}
	return book.days[dayStart]
}

// credit applies one ledger row. A row with cash adds or takes back purchased
// balance; a row without cash adds or takes back gifted balance.
func (book *beaconCustomerBook) credit(day *beaconCustomerDay, cents, quota int64) {
	value := decimal.NewFromInt(cents).Shift(4)
	day.paid = day.paid.Add(value)
	switch {
	case quota >= 0 && cents > 0:
		book.paidQuota += quota
		book.paidValue = book.paidValue.Add(value)
	case cents < 0:
		// Money paid back takes back purchased balance first, then gifts. A
		// refund that takes back no balance lowers what the rest is worth.
		taken := min(-quota, book.paidQuota)
		book.paidQuota -= taken
		book.paidValue = book.paidValue.Add(value)
		book.gift -= min(-quota-taken, book.gift)
	case quota >= 0:
		book.gift += quota
	default:
		taken := min(-quota, book.gift)
		book.gift -= taken
		book.paidQuota -= min(-quota-taken, book.paidQuota)
	}
	// Value left with no balance, or a refund larger than the unused value,
	// settles into revenue on the day it happens.
	if book.paidQuota == 0 || book.paidValue.IsNegative() {
		day.revenue = day.revenue.Add(book.paidValue)
		book.paidValue = decimal.Zero
	}
}

// use applies one day's net usage. Net refunds return balance at its current
// value.
func (book *beaconCustomerBook) use(day *beaconCustomerDay, quota int64) {
	day.usage += quota
	if quota < 0 {
		if book.paidQuota > 0 {
			value := book.paidValue.Mul(decimal.NewFromInt(-quota)).Div(decimal.NewFromInt(book.paidQuota))
			book.paidQuota -= quota
			book.paidValue = book.paidValue.Add(value)
			day.revenue = day.revenue.Sub(value)
		} else {
			book.gift -= quota
			day.giftUsed += quota
		}
		return
	}
	fromGift := min(quota, book.gift)
	book.gift -= fromGift
	day.giftUsed += fromGift
	fromPaid := min(quota-fromGift, book.paidQuota)
	if fromPaid > 0 {
		value := book.paidValue.Mul(decimal.NewFromInt(fromPaid)).Div(decimal.NewFromInt(book.paidQuota))
		book.paidQuota -= fromPaid
		book.paidValue = book.paidValue.Sub(value)
		day.revenue = day.revenue.Add(value)
	}
	day.unpaid += quota - fromGift - fromPaid
}

// beaconCustomerBooks replays every customer's ledger and usage before
// endBefore, one calendar day at a time: a day's ledger rows are applied
// before that day's usage.
func beaconCustomerBooks(ctx context.Context, endBefore int64) (map[int]*beaconCustomerBook, error) {
	type movement struct {
		day          int64
		ledger       bool
		cents, quota int64
	}
	movements := map[int][]movement{}
	rows, err := DB.WithContext(ctx).Model(&BeaconLedgerEntry{}).Select("user_id", "cny_amount_minor", "quota_delta", "occurred_at").
		Where("occurred_at < ?", endBefore).Order("occurred_at, id").Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var userID int
		var cents, quota, occurredAt int64
		if err := rows.Scan(&userID, &cents, &quota, &occurredAt); err != nil {
			return nil, err
		}
		movements[userID] = append(movements[userID], movement{day: beaconDayStart(occurredAt), ledger: true, cents: cents, quota: quota})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var usage []struct {
		UserID   int
		UsageDay int64
		Type     int
		Quota    int64
	}
	day := beaconDaySQL("created_at")
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Select("user_id, "+day+" AS usage_day, type, COALESCE(SUM(quota), 0) AS quota").
		Where("type IN ? AND created_at < ?", []int{LogTypeConsume, LogTypeRefund}, endBefore).
		Group("user_id, " + day + ", type").Scan(&usage).Error; err != nil {
		return nil, err
	}
	net := map[int]map[int64]int64{}
	for _, row := range usage {
		if net[row.UserID] == nil {
			net[row.UserID] = map[int64]int64{}
		}
		if row.Type == LogTypeRefund {
			net[row.UserID][row.UsageDay] -= row.Quota
		} else {
			net[row.UserID][row.UsageDay] += row.Quota
		}
	}
	for userID, days := range net {
		for dayStart, quota := range days {
			movements[userID] = append(movements[userID], movement{day: dayStart, quota: quota})
		}
	}

	books := make(map[int]*beaconCustomerBook, len(movements))
	for userID, list := range movements {
		slices.SortStableFunc(list, func(a, b movement) int {
			if a.day != b.day {
				return int(a.day - b.day)
			}
			if a.ledger != b.ledger {
				if a.ledger {
					return -1
				}
				return 1
			}
			return 0
		})
		book := &beaconCustomerBook{days: map[int64]*beaconCustomerDay{}}
		for _, item := range list {
			if item.ledger {
				book.credit(book.day(item.day), item.cents, item.quota)
			} else {
				book.use(book.day(item.day), item.quota)
			}
		}
		books[userID] = book
	}
	return books, nil
}

func beaconMicroString(value decimal.Decimal) string {
	return value.Round(0).String()
}

// BeaconProfitRow is one group's customer revenue against supplier cost.
// Money is in millionths of CNY and quota in quota units, as decimal strings.
type BeaconProfitRow struct {
	Key             string `json:"key"`
	Label           string `json:"label"`
	Requests        int64  `json:"requests"`
	UsageQuota      string `json:"usage_quota"`
	RevenueMicroCNY string `json:"revenue_micro_cny"`
	CostMicroCNY    string `json:"cost_micro_cny"`
	ExpenseMicroCNY string `json:"expense_micro_cny"`
	ProfitMicroCNY  string `json:"profit_micro_cny"`
}

// BeaconProfitSummary: profit = what customers used of their purchased
// balance, valued at what they paid, minus what suppliers deducted, minus
// operating expenses paid in the period.
type BeaconProfitSummary struct {
	Range   BeaconCashRange   `json:"range"`
	GroupBy string            `json:"group_by"`
	Total   BeaconProfitRow   `json:"total"`
	Rows    []BeaconProfitRow `json:"rows"`
	// GiftQuota was used from gifted balance and earned nothing.
	GiftQuota string `json:"gift_quota"`
	// UnpaidQuota was used with no recorded payment behind it, such as a
	// sign-up bonus or balance added outside the ledger.
	UnpaidQuota string `json:"unpaid_quota"`
	// PendingCharges are supplier deductions with no purchase price yet.
	PendingCharges int64 `json:"pending_charges"`
	// UncostedRequests went through channels with no purchase price.
	UncostedRequests int64 `json:"uncosted_requests"`
}

type beaconProfitAccumulator struct {
	requests               int64
	usage                  int64
	revenue, cost, expense decimal.Decimal
}

func (acc *beaconProfitAccumulator) row(key string) BeaconProfitRow {
	return BeaconProfitRow{
		Key: key, Label: key, Requests: acc.requests, UsageQuota: strconv.FormatInt(acc.usage, 10),
		RevenueMicroCNY: beaconMicroString(acc.revenue), CostMicroCNY: beaconMicroString(acc.cost),
		ExpenseMicroCNY: beaconMicroString(acc.expense),
		ProfitMicroCNY:  beaconMicroString(acc.revenue.Sub(acc.cost).Sub(acc.expense)),
	}
}

// beaconProfitAdjustmentKey groups revenue that no request carries, such as a
// refund larger than the unused balance, when grouping by model or channel.
const beaconProfitAdjustmentKey = "adjustment"

// beaconProfitExpenseKey groups operating expenses, which belong to no
// customer, model or channel, when not grouping by day.
const beaconProfitExpenseKey = "expenses"

var beaconProfitLogColumns = map[string]string{
	"channel": "channel_id",
	"model":   "model_name",
	"user":    "user_id",
	"day":     beaconDaySQL("created_at"),
}

var beaconProfitChargeColumns = map[string]string{
	"channel": "channel_id",
	"model":   "CASE WHEN local_log_id IS NOT NULL AND local_model_name <> '' THEN local_model_name ELSE model_name END",
	"user":    "user_id",
	"day":     beaconDaySQL("occurred_at"),
}

// GetBeaconProfitSummary groups profit by day, customer, model or channel.
// Revenue reaches a model or channel in proportion to the quota its requests
// used on that customer's day. A supplier deduction counts toward the model
// the customer asked for, and one with no local request toward customer 0.
// Operating expenses count on the day they were paid.
func GetBeaconProfitSummary(ctx context.Context, period, startDate, endDate, groupBy string, now time.Time) (*BeaconProfitSummary, error) {
	window, err := ResolveBeaconCashRange(period, startDate, endDate, now)
	if err != nil {
		return nil, err
	}
	logColumn, ok := beaconProfitLogColumns[groupBy]
	if !ok {
		return nil, ErrBeaconCostInput
	}
	books, err := beaconCustomerBooks(ctx, window.EndBefore)
	if err != nil {
		return nil, err
	}
	groups := map[string]*beaconProfitAccumulator{}
	group := func(key string) *beaconProfitAccumulator {
		acc := groups[key]
		if acc == nil {
			acc = &beaconProfitAccumulator{}
			groups[key] = acc
		}
		return acc
	}
	dayKey := func(raw string) (string, error) {
		if groupBy != "day" {
			return raw, nil
		}
		dayStart, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return "", err
		}
		return beaconDayLabel(dayStart), nil
	}

	var usage []struct {
		UserID   int
		UsageDay int64
		GroupKey string
		Type     int
		Requests int64
		Quota    int64
	}
	day := beaconDaySQL("created_at")
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).
		Select("user_id, "+day+" AS usage_day, "+logColumn+" AS group_key, type, COUNT(*) AS requests, COALESCE(SUM(quota), 0) AS quota").
		Where("type IN ? AND created_at >= ? AND created_at < ?", []int{LogTypeConsume, LogTypeRefund}, window.StartAt, window.EndBefore).
		Group("user_id, " + day + ", " + logColumn + ", type").Scan(&usage).Error; err != nil {
		return nil, err
	}
	for _, row := range usage {
		key, err := dayKey(row.GroupKey)
		if err != nil {
			return nil, err
		}
		acc := group(key)
		quota := row.Quota
		if row.Type == LogTypeRefund {
			quota = -quota
		} else {
			acc.requests += row.Requests
		}
		acc.usage += quota
		if customerDay := books[row.UserID].dayIn(row.UsageDay); customerDay != nil && customerDay.usage != 0 {
			share := customerDay.revenue.Mul(decimal.NewFromInt(quota)).Div(decimal.NewFromInt(customerDay.usage))
			acc.revenue = acc.revenue.Add(share)
		}
	}
	summary := &BeaconProfitSummary{Range: window, GroupBy: groupBy, Rows: []BeaconProfitRow{}}
	var giftQuota, unpaidQuota int64
	for _, userID := range slices.Sorted(maps.Keys(books)) {
		for dayStart, customerDay := range books[userID].days {
			if dayStart < beaconDayStart(window.StartAt) || dayStart >= window.EndBefore {
				continue
			}
			giftQuota += customerDay.giftUsed
			unpaidQuota += customerDay.unpaid
			if customerDay.usage != 0 || customerDay.revenue.IsZero() {
				continue
			}
			key := beaconProfitAdjustmentKey
			switch groupBy {
			case "day":
				key = beaconDayLabel(dayStart)
			case "user":
				key = strconv.Itoa(userID)
			}
			group(key).revenue = group(key).revenue.Add(customerDay.revenue)
		}
	}
	summary.GiftQuota, summary.UnpaidQuota = strconv.FormatInt(giftQuota, 10), strconv.FormatInt(unpaidQuota, 10)

	var costs []struct {
		GroupKey string
		Priced   int64
		Cost     int64
		Pending  int64
	}
	chargeColumn := beaconProfitChargeColumns[groupBy]
	if err := DB.WithContext(ctx).Model(&BeaconUpstreamCharge{}).
		Select(chargeColumn+" AS group_key, "+
			"SUM(CASE WHEN rate_id IS NULL THEN 0 ELSE 1 END) AS priced, "+
			"COALESCE(SUM(CASE WHEN rate_id IS NULL THEN 0 ELSE cost_micro_cny END), 0) AS cost, "+
			"SUM(CASE WHEN rate_id IS NULL THEN 1 ELSE 0 END) AS pending").
		Where("occurred_at >= ? AND occurred_at < ?", window.StartAt, window.EndBefore).
		Group(chargeColumn).Scan(&costs).Error; err != nil {
		return nil, err
	}
	for _, row := range costs {
		summary.PendingCharges += row.Pending
		if row.Priced == 0 {
			continue
		}
		key, err := dayKey(row.GroupKey)
		if err != nil {
			return nil, err
		}
		acc := group(key)
		acc.cost = acc.cost.Add(decimal.NewFromInt(row.Cost))
	}
	var expenses []struct {
		ExpenseDay int64
		Amount     int64
	}
	expenseDay := beaconDaySQL("occurred_at")
	if err := DB.WithContext(ctx).Model(&BeaconExpense{}).
		Select(expenseDay+" AS expense_day, COALESCE(SUM(cny_amount_minor), 0) AS amount").
		Where("occurred_at >= ? AND occurred_at < ?", window.StartAt, window.EndBefore).
		Group(expenseDay).Scan(&expenses).Error; err != nil {
		return nil, err
	}
	for _, row := range expenses {
		if row.Amount == 0 {
			continue
		}
		key := beaconProfitExpenseKey
		if groupBy == "day" {
			key = beaconDayLabel(row.ExpenseDay)
		}
		acc := group(key)
		acc.expense = acc.expense.Add(decimal.NewFromInt(row.Amount).Shift(4))
	}

	summary.UncostedRequests, err = beaconUncostedRequests(ctx, window)
	if err != nil {
		return nil, err
	}
	keys := slices.Sorted(maps.Keys(groups))
	if groupBy == "day" {
		slices.Reverse(keys)
	} else if index := slices.Index(keys, beaconProfitExpenseKey); index >= 0 {
		keys = append(slices.Delete(keys, index, index+1), beaconProfitExpenseKey)
	}
	var total beaconProfitAccumulator
	for _, key := range keys {
		acc := groups[key]
		total.requests += acc.requests
		total.usage += acc.usage
		total.revenue = total.revenue.Add(acc.revenue)
		total.cost = total.cost.Add(acc.cost)
		total.expense = total.expense.Add(acc.expense)
		summary.Rows = append(summary.Rows, acc.row(key))
	}
	if err := labelBeaconProfitRows(ctx, groupBy, summary.Rows); err != nil {
		return nil, err
	}
	summary.Total = total.row("total")
	return summary, nil
}

// beaconUncostedRequests counts requests in the window that went through a
// channel without any purchase price, so their cost is missing from profit.
func beaconUncostedRequests(ctx context.Context, window BeaconCashRange) (int64, error) {
	priced, err := BeaconChannelIDsWithRates()
	if err != nil {
		return 0, err
	}
	query := LOG_DB.WithContext(ctx).Model(&Log{}).
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeConsume, window.StartAt, window.EndBefore)
	if len(priced) > 0 {
		query = query.Where("channel_id NOT IN ?", priced)
	}
	var count int64
	return count, query.Count(&count).Error
}

func labelBeaconProfitRows(ctx context.Context, groupBy string, rows []BeaconProfitRow) error {
	if groupBy != "channel" && groupBy != "user" {
		return nil
	}
	// Skip the adjustment and expense rows: PostgreSQL rejects a non-numeric
	// text in an integer IN list.
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		if id, err := strconv.Atoi(row.Key); err == nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
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

// BeaconCustomerFinanceRow is what one customer paid and used in a period and
// what is left now. Money is in millionths of CNY, quota in quota units.
type BeaconCustomerFinanceRow struct {
	UserID            int    `json:"user_id"`
	Username          string `json:"username"`
	PaidMicroCNY      string `json:"paid_micro_cny"`
	UsedMicroCNY      string `json:"used_micro_cny"`
	UsageQuota        string `json:"usage_quota"`
	GiftQuota         string `json:"gift_quota"`
	UnpaidQuota       string `json:"unpaid_quota"`
	RemainingMicroCNY string `json:"remaining_micro_cny"`
	// BalanceQuota is the wallet balance now, gifted balance included.
	BalanceQuota string `json:"balance_quota"`
}

type BeaconCustomerFinance struct {
	Range BeaconCashRange            `json:"range"`
	Total BeaconCustomerFinanceRow   `json:"total"`
	Rows  []BeaconCustomerFinanceRow `json:"rows"`
}

type beaconCustomerTotals struct {
	paid, used, remaining        decimal.Decimal
	usage, gift, unpaid, balance int64
}

func (totals *beaconCustomerTotals) row(userID int, username string) BeaconCustomerFinanceRow {
	return BeaconCustomerFinanceRow{
		UserID: userID, Username: username, PaidMicroCNY: beaconMicroString(totals.paid), UsedMicroCNY: beaconMicroString(totals.used),
		UsageQuota: strconv.FormatInt(totals.usage, 10), GiftQuota: strconv.FormatInt(totals.gift, 10),
		UnpaidQuota: strconv.FormatInt(totals.unpaid, 10), RemainingMicroCNY: beaconMicroString(totals.remaining),
		BalanceQuota: strconv.FormatInt(totals.balance, 10),
	}
}

// GetBeaconCustomerFinance lists every customer with ledger rows or usage.
// Paid and used cover the period; remaining is the unused purchased balance
// now, valued at what the customer paid for it.
func GetBeaconCustomerFinance(ctx context.Context, period, startDate, endDate string, now time.Time) (*BeaconCustomerFinance, error) {
	window, err := ResolveBeaconCashRange(period, startDate, endDate, now)
	if err != nil {
		return nil, err
	}
	books, err := beaconCustomerBooks(ctx, now.Unix()+1)
	if err != nil {
		return nil, err
	}
	ids := slices.Sorted(maps.Keys(books))
	var users []User
	if len(ids) > 0 {
		if err := DB.WithContext(ctx).Unscoped().Select("id", "username", "quota").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return nil, err
		}
	}
	byID := make(map[int]User, len(users))
	for _, user := range users {
		byID[user.Id] = user
	}
	result := &BeaconCustomerFinance{Range: window, Rows: make([]BeaconCustomerFinanceRow, 0, len(ids))}
	var total beaconCustomerTotals
	for _, userID := range ids {
		book := books[userID]
		totals := beaconCustomerTotals{remaining: book.paidValue, balance: int64(byID[userID].Quota)}
		for dayStart, customerDay := range book.days {
			if dayStart < beaconDayStart(window.StartAt) || dayStart >= window.EndBefore {
				continue
			}
			totals.paid = totals.paid.Add(customerDay.paid)
			totals.used = totals.used.Add(customerDay.revenue)
			totals.usage += customerDay.usage
			totals.gift += customerDay.giftUsed
			totals.unpaid += customerDay.unpaid
		}
		total.paid, total.used = total.paid.Add(totals.paid), total.used.Add(totals.used)
		total.remaining = total.remaining.Add(totals.remaining)
		total.usage, total.gift, total.unpaid = total.usage+totals.usage, total.gift+totals.gift, total.unpaid+totals.unpaid
		total.balance += totals.balance
		result.Rows = append(result.Rows, totals.row(userID, byID[userID].Username))
	}
	result.Total = total.row(0, "total")
	return result, nil
}

// BeaconUpstreamFinanceRow is what was paid to one channel's supplier and
// what the supplier deducted in a period, and what should be left now.
// Money is in millionths of CNY; credit in millionths of the upstream's $1.
type BeaconUpstreamFinanceRow struct {
	ChannelID       int    `json:"channel_id"`
	Name            string `json:"name"`
	PaidMicroCNY    string `json:"paid_micro_cny"`
	PaidCreditMicro string `json:"paid_credit_micro"`
	UsedMicroCNY    string `json:"used_micro_cny"`
	UsedCreditMicro string `json:"used_credit_micro"`
	// PendingCharges in the period have no purchase price, so their cost is
	// missing from UsedMicroCNY.
	PendingCharges int64 `json:"pending_charges"`
	// Remaining is everything paid minus everything deducted, all time.
	RemainingMicroCNY    string `json:"remaining_micro_cny"`
	RemainingCreditMicro string `json:"remaining_credit_micro"`
	CNYPerUnit           string `json:"cny_per_unit"`
	// ReportedBalance is the balance the upstream last reported for this
	// channel's key (channel balance check), in the upstream's $.
	ReportedBalance float64 `json:"reported_balance"`
	ReportedAt      int64   `json:"reported_at"`
}

type BeaconUpstreamFinance struct {
	Range BeaconCashRange            `json:"range"`
	Total BeaconUpstreamFinanceRow   `json:"total"`
	Rows  []BeaconUpstreamFinanceRow `json:"rows"`
}

type beaconUpstreamTotals struct {
	paid, paidCredit, used, usedCredit int64
	pending                            int64
	allPaid, allPaidCredit             int64
	allUsed, allUsedCredit             int64
}

func (totals *beaconUpstreamTotals) add(other beaconUpstreamTotals) {
	totals.paid += other.paid
	totals.paidCredit += other.paidCredit
	totals.used += other.used
	totals.usedCredit += other.usedCredit
	totals.pending += other.pending
	totals.allPaid += other.allPaid
	totals.allPaidCredit += other.allPaidCredit
	totals.allUsed += other.allUsed
	totals.allUsedCredit += other.allUsedCredit
}

func (totals *beaconUpstreamTotals) row(channelID int, name string) BeaconUpstreamFinanceRow {
	return BeaconUpstreamFinanceRow{
		ChannelID: channelID, Name: name,
		PaidMicroCNY: strconv.FormatInt(totals.paid*10_000, 10), PaidCreditMicro: strconv.FormatInt(totals.paidCredit, 10),
		UsedMicroCNY: strconv.FormatInt(totals.used, 10), UsedCreditMicro: strconv.FormatInt(totals.usedCredit, 10),
		PendingCharges:       totals.pending,
		RemainingMicroCNY:    strconv.FormatInt(totals.allPaid*10_000-totals.allUsed, 10),
		RemainingCreditMicro: strconv.FormatInt(totals.allPaidCredit-totals.allUsedCredit, 10),
	}
}

// GetBeaconUpstreamFinance lists every channel with a purchase price, a
// payment or a synced deduction.
func GetBeaconUpstreamFinance(ctx context.Context, period, startDate, endDate string, now time.Time) (*BeaconUpstreamFinance, error) {
	window, err := ResolveBeaconCashRange(period, startDate, endDate, now)
	if err != nil {
		return nil, err
	}
	totals := map[int]*beaconUpstreamTotals{}
	channel := func(id int) *beaconUpstreamTotals {
		acc := totals[id]
		if acc == nil {
			acc = &beaconUpstreamTotals{}
			totals[id] = acc
		}
		return acc
	}
	var payments []BeaconUpstreamPayment
	if err := DB.WithContext(ctx).Select("channel_id", "cny_amount_minor", "credit_micro", "occurred_at").Find(&payments).Error; err != nil {
		return nil, err
	}
	for _, payment := range payments {
		acc := channel(payment.ChannelID)
		acc.allPaid += payment.CNYAmountMinor
		acc.allPaidCredit += payment.CreditMicro
		if payment.OccurredAt >= window.StartAt && payment.OccurredAt < window.EndBefore {
			acc.paid += payment.CNYAmountMinor
			acc.paidCredit += payment.CreditMicro
		}
	}
	var charges []struct {
		ChannelID int
		InRange   int
		Credit    int64
		Cost      int64
		Pending   int64
	}
	// The bounds are integers; GROUP BY repeats the expression without arguments.
	inRange := "CASE WHEN occurred_at >= " + strconv.FormatInt(window.StartAt, 10) +
		" AND occurred_at < " + strconv.FormatInt(window.EndBefore, 10) + " THEN 1 ELSE 0 END"
	if err := DB.WithContext(ctx).Model(&BeaconUpstreamCharge{}).
		Select("channel_id, " + inRange + " AS in_range, COALESCE(SUM(credit_micro), 0) AS credit, " +
			"COALESCE(SUM(CASE WHEN rate_id IS NULL THEN 0 ELSE cost_micro_cny END), 0) AS cost, " +
			"SUM(CASE WHEN rate_id IS NULL THEN 1 ELSE 0 END) AS pending").
		Group("channel_id, " + inRange).Scan(&charges).Error; err != nil {
		return nil, err
	}
	for _, row := range charges {
		acc := channel(row.ChannelID)
		acc.allUsed += row.Cost
		acc.allUsedCredit += row.Credit
		if row.InRange == 1 {
			acc.used += row.Cost
			acc.usedCredit += row.Credit
			acc.pending += row.Pending
		}
	}
	rates, err := ListBeaconUpstreamRates()
	if err != nil {
		return nil, err
	}
	// Rates come newest first per channel; the first one in effect is current.
	currentRate := map[int]string{}
	for _, rate := range rates {
		channel(rate.ChannelID)
		if _, ok := currentRate[rate.ChannelID]; !ok && rate.EffectiveAt <= now.Unix() {
			currentRate[rate.ChannelID] = rate.CNYPerUnit
		}
	}
	ids := slices.Sorted(maps.Keys(totals))
	var channels []Channel
	if len(ids) > 0 {
		if err := DB.WithContext(ctx).Select("id", "name", "balance", "balance_updated_time").Where("id IN ?", ids).Find(&channels).Error; err != nil {
			return nil, err
		}
	}
	byID := make(map[int]Channel, len(channels))
	for _, item := range channels {
		byID[item.Id] = item
	}
	result := &BeaconUpstreamFinance{Range: window, Rows: make([]BeaconUpstreamFinanceRow, 0, len(ids))}
	var total beaconUpstreamTotals
	for _, id := range ids {
		total.add(*totals[id])
		row := totals[id].row(id, byID[id].Name)
		row.CNYPerUnit = currentRate[id]
		row.ReportedBalance, row.ReportedAt = byID[id].Balance, byID[id].BalanceUpdatedTime
		result.Rows = append(result.Rows, row)
	}
	result.Total = total.row(0, "total")
	return result, nil
}

// BeaconProfitTotals is revenue, upstream cost, operating expenses and profit
// in millionths of CNY.
type BeaconProfitTotals struct {
	RevenueMicroCNY string `json:"revenue_micro_cny"`
	CostMicroCNY    string `json:"cost_micro_cny"`
	ExpenseMicroCNY string `json:"expense_micro_cny"`
	ProfitMicroCNY  string `json:"profit_micro_cny"`
}

// BeaconFinanceOverview is the three headline numbers: profit, what customers
// paid and what suppliers were paid. Customer and supplier totals are all
// time; money is in millionths of CNY.
type BeaconFinanceOverview struct {
	AsOf  int64              `json:"as_of"`
	Today BeaconProfitTotals `json:"today"`
	Month BeaconProfitTotals `json:"month"`
	All   BeaconProfitTotals `json:"all"`
	// Customer paid = used + remaining.
	CustomerPaidMicroCNY      string `json:"customer_paid_micro_cny"`
	CustomerUsedMicroCNY      string `json:"customer_used_micro_cny"`
	CustomerRemainingMicroCNY string `json:"customer_remaining_micro_cny"`
	// Upstream remaining = paid − used.
	UpstreamPaidMicroCNY      string `json:"upstream_paid_micro_cny"`
	UpstreamUsedMicroCNY      string `json:"upstream_used_micro_cny"`
	UpstreamRemainingMicroCNY string `json:"upstream_remaining_micro_cny"`
	// CashMicroCNY is what should be on hand: customer payments minus
	// supplier payments and operating expenses. It is not profit.
	CashMicroCNY   string `json:"cash_micro_cny"`
	PendingCharges int64  `json:"pending_charges"`
}

func GetBeaconFinanceOverview(ctx context.Context, now time.Time) (*BeaconFinanceOverview, error) {
	today, err := ResolveBeaconCashRange("today", "", "", now)
	if err != nil {
		return nil, err
	}
	month, err := ResolveBeaconCashRange("month", "", "", now)
	if err != nil {
		return nil, err
	}
	books, err := beaconCustomerBooks(ctx, now.Unix()+1)
	if err != nil {
		return nil, err
	}
	var revenueToday, revenueMonth, revenueAll, paid, remaining decimal.Decimal
	for _, book := range books {
		remaining = remaining.Add(book.paidValue)
		for dayStart, customerDay := range book.days {
			paid = paid.Add(customerDay.paid)
			revenueAll = revenueAll.Add(customerDay.revenue)
			if dayStart >= month.StartAt {
				revenueMonth = revenueMonth.Add(customerDay.revenue)
			}
			if dayStart >= today.StartAt {
				revenueToday = revenueToday.Add(customerDay.revenue)
			}
		}
	}
	var costs []struct {
		CostDay int64
		Cost    int64
		Pending int64
	}
	day := beaconDaySQL("occurred_at")
	if err := DB.WithContext(ctx).Model(&BeaconUpstreamCharge{}).
		Select(day + " AS cost_day, COALESCE(SUM(CASE WHEN rate_id IS NULL THEN 0 ELSE cost_micro_cny END), 0) AS cost, " +
			"SUM(CASE WHEN rate_id IS NULL THEN 1 ELSE 0 END) AS pending").
		Group(day).Scan(&costs).Error; err != nil {
		return nil, err
	}
	result := &BeaconFinanceOverview{AsOf: now.Unix()}
	var costToday, costMonth, costAll int64
	for _, row := range costs {
		costAll += row.Cost
		result.PendingCharges += row.Pending
		if row.CostDay >= month.StartAt {
			costMonth += row.Cost
		}
		if row.CostDay >= today.StartAt {
			costToday += row.Cost
		}
	}
	var expenses []struct {
		ExpenseDay int64
		Amount     int64
	}
	if err := DB.WithContext(ctx).Model(&BeaconExpense{}).
		Select(day + " AS expense_day, COALESCE(SUM(cny_amount_minor), 0) AS amount").
		Group(day).Scan(&expenses).Error; err != nil {
		return nil, err
	}
	var expenseToday, expenseMonth, expenseAll int64
	for _, row := range expenses {
		expenseAll += row.Amount
		if row.ExpenseDay >= month.StartAt {
			expenseMonth += row.Amount
		}
		if row.ExpenseDay >= today.StartAt {
			expenseToday += row.Amount
		}
	}
	totals := func(revenue decimal.Decimal, cost, expenseCents int64) BeaconProfitTotals {
		costValue, expense := decimal.NewFromInt(cost), decimal.NewFromInt(expenseCents).Shift(4)
		return BeaconProfitTotals{
			RevenueMicroCNY: beaconMicroString(revenue), CostMicroCNY: costValue.String(), ExpenseMicroCNY: expense.String(),
			ProfitMicroCNY: beaconMicroString(revenue.Sub(costValue).Sub(expense)),
		}
	}
	result.Today = totals(revenueToday, costToday, expenseToday)
	result.Month = totals(revenueMonth, costMonth, expenseMonth)
	result.All = totals(revenueAll, costAll, expenseAll)
	result.CustomerPaidMicroCNY = beaconMicroString(paid)
	result.CustomerUsedMicroCNY = beaconMicroString(revenueAll)
	result.CustomerRemainingMicroCNY = beaconMicroString(remaining)

	var upstreamPaid int64
	if err := DB.WithContext(ctx).Model(&BeaconUpstreamPayment{}).Select("COALESCE(SUM(cny_amount_minor), 0)").Scan(&upstreamPaid).Error; err != nil {
		return nil, err
	}
	result.UpstreamPaidMicroCNY = strconv.FormatInt(upstreamPaid*10_000, 10)
	result.UpstreamUsedMicroCNY = strconv.FormatInt(costAll, 10)
	result.UpstreamRemainingMicroCNY = strconv.FormatInt(upstreamPaid*10_000-costAll, 10)
	result.CashMicroCNY = beaconMicroString(paid.Sub(decimal.NewFromInt(upstreamPaid * 10_000)).Sub(decimal.NewFromInt(expenseAll).Shift(4)))
	return result, nil
}
