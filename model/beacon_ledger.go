package model

import (
	"cmp"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	BeaconReceipt  = "receipt"
	BeaconGift     = "gift"
	BeaconRefund   = "refund"
	BeaconReversal = "reversal"
	// Currency amounts are integer minor units, bounded for exact JSON numbers.
	beaconMaxMoneyMinor int64 = 1<<53 - 1
)

var (
	ErrBeaconLedgerInput       = errors.New("invalid manual ledger input")
	ErrBeaconLedgerConflict    = errors.New("idempotency key was used for another ledger request")
	ErrBeaconDuplicatePayment  = errors.New("payment reference has already been recorded")
	ErrBeaconAlreadyCorrected  = errors.New("ledger entry has already been refunded or reversed")
	ErrBeaconInsufficientQuota = errors.New("insufficient available quota for ledger correction")
	ErrBeaconLedgerActor       = errors.New("manual ledger requires an enabled root operator")
	ErrBeaconLedgerMode        = errors.New("manual ledger requires synchronous database quota without Redis or batch updates")
	beaconRequestKeyPattern    = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{15,63}$`)
	beaconMoneyPattern         = regexp.MustCompile(`^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$`)
	beaconRatePattern          = regexp.MustCompile(`^(0|[1-9][0-9]{0,4})(\.[0-9]{1,8})?$`)
)

// BeaconLedgerEntry is append-only through the posting API. A correction adds
// a linked row; the original amount, FX snapshot and operator never change.
// The management API requires a root browser session and a single-use proof.
// Adding this table does not rewrite legacy top-ups.
type BeaconLedgerEntry struct {
	ID                  int64   `json:"id" gorm:"primaryKey"`
	IdempotencyKey      string  `json:"idempotency_key" gorm:"type:varchar(64);not null;uniqueIndex"`
	RequestHash         string  `json:"-" gorm:"type:varchar(64);not null"`
	Kind                string  `json:"kind" gorm:"type:varchar(16);not null"`
	UserID              int     `json:"user_id" gorm:"not null;index"`
	OperatorID          int     `json:"operator_id" gorm:"not null;index"`
	Currency            string  `json:"currency" gorm:"type:varchar(3);not null"`
	OriginalAmountMinor int64   `json:"original_amount_minor" gorm:"type:bigint;not null"`
	CNYAmountMinor      int64   `json:"cny_amount_minor" gorm:"type:bigint;not null"`
	CNYPerUnit          string  `json:"cny_per_unit" gorm:"type:varchar(32);not null"`
	FXSource            string  `json:"fx_source" gorm:"type:varchar(255);not null"`
	QuotaDelta          int     `json:"quota_delta" gorm:"type:bigint;not null"`
	PaymentMethod       string  `json:"payment_method" gorm:"type:varchar(32);not null"`
	PaymentReference    string  `json:"payment_reference" gorm:"type:varchar(128);not null"`
	PaymentIdentity     *string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
	CorrectsID          *int64  `json:"corrects_id" gorm:"uniqueIndex"`
	OccurredAt          int64   `json:"occurred_at" gorm:"not null;index"`
	RecordedAt          int64   `json:"recorded_at" gorm:"not null"`
	Note                string  `json:"note" gorm:"type:varchar(1000);not null"`
}

// BeaconLedgerInput uses decimal text for money and FX, and integer quota.
// Corrections accept only CorrectsID plus their own timestamp/reason/reference;
// their user, amount and quota are derived from the original row server-side.
// The first slice supports full refunds only, with enough available quota.
type BeaconLedgerInput struct {
	IdempotencyKey   string `json:"idempotency_key"`
	Kind             string `json:"kind"`
	UserID           int    `json:"user_id"`
	Amount           string `json:"amount"`
	Currency         string `json:"currency"`
	CNYPerUnit       string `json:"cny_per_unit"`
	FXSource         string `json:"fx_source"`
	Quota            int    `json:"quota"`
	PaymentMethod    string `json:"payment_method"`
	PaymentReference string `json:"payment_reference"`
	CorrectsID       int64  `json:"corrects_id"`
	OccurredAt       int64  `json:"occurred_at"`
	Note             string `json:"note"`
}

// beaconMoneySnapshot accepts only currencies with two decimal minor units.
// Conversion is rounded once, half away from zero, to CNY cents. Unknown
// currencies and exponent notation are rejected rather than guessed.
func beaconMoneySnapshot(amount, currency, rate string) (int64, int64, string, error) {
	if currency != "CNY" && currency != "USD" && currency != "EUR" && currency != "HKD" {
		return 0, 0, "", ErrBeaconLedgerInput
	}
	if !beaconMoneyPattern.MatchString(amount) || !beaconRatePattern.MatchString(rate) {
		return 0, 0, "", ErrBeaconLedgerInput
	}
	value, err := decimal.NewFromString(amount)
	if err != nil {
		return 0, 0, "", ErrBeaconLedgerInput
	}
	fx, err := decimal.NewFromString(rate)
	if err != nil || !fx.IsPositive() || (currency == "CNY" && !fx.Equal(decimal.NewFromInt(1))) {
		return 0, 0, "", ErrBeaconLedgerInput
	}
	original := value.Shift(2)
	converted := original.Mul(fx).Round(0)
	limit := decimal.NewFromInt(beaconMaxMoneyMinor)
	if !original.IsPositive() || !converted.IsPositive() || original.GreaterThan(limit) || converted.GreaterThan(limit) {
		return 0, 0, "", ErrBeaconLedgerInput
	}
	return original.IntPart(), converted.IntPart(), fx.String(), nil
}

func (input BeaconLedgerInput) normalized(now int64) (BeaconLedgerInput, error) {
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.Amount = strings.TrimSpace(input.Amount)
	input.CNYPerUnit = strings.TrimSpace(input.CNYPerUnit)
	input.FXSource = strings.TrimSpace(input.FXSource)
	input.PaymentMethod = strings.ToLower(strings.TrimSpace(input.PaymentMethod))
	input.PaymentReference = strings.ToLower(strings.TrimSpace(input.PaymentReference))
	input.Note = strings.TrimSpace(input.Note)
	if !beaconRequestKeyPattern.MatchString(input.IdempotencyKey) ||
		!utf8.ValidString(input.Note) || utf8.RuneCountInString(input.Note) > 1000 ||
		!utf8.ValidString(input.FXSource) || utf8.RuneCountInString(input.FXSource) > 255 ||
		strings.ContainsRune(input.Note+input.FXSource, '\x00') ||
		len(input.PaymentMethod) > 32 || len(input.PaymentReference) > 128 ||
		strings.ContainsAny(input.PaymentMethod+input.PaymentReference, "\x00\r\n") ||
		!utf8.ValidString(input.PaymentMethod+input.PaymentReference) ||
		input.OccurredAt < 946684800 || input.OccurredAt > now+300 {
		return input, ErrBeaconLedgerInput
	}
	switch input.Kind {
	case BeaconReceipt, BeaconGift:
		if input.UserID <= 0 || input.CorrectsID != 0 || input.Quota <= 0 || input.Quota > common.MaxWalletQuota {
			return input, ErrBeaconLedgerInput
		}
		if input.Kind == BeaconReceipt {
			_, _, rate, err := beaconMoneySnapshot(input.Amount, input.Currency, input.CNYPerUnit)
			if err != nil || input.PaymentMethod == "" || input.PaymentReference == "" {
				return input, ErrBeaconLedgerInput
			}
			amount, _ := decimal.NewFromString(input.Amount)
			input.Amount, input.CNYPerUnit = amount.StringFixed(2), rate
		} else if input.Amount != "" || input.Currency != "" || input.CNYPerUnit != "" || input.FXSource != "" || input.PaymentMethod != "" || input.PaymentReference != "" {
			return input, ErrBeaconLedgerInput
		}
	case BeaconRefund, BeaconReversal:
		if input.CorrectsID <= 0 || input.UserID != 0 || input.Quota != 0 || input.Amount != "" || input.Currency != "" {
			return input, ErrBeaconLedgerInput
		}
		if input.Kind == BeaconRefund {
			if input.PaymentMethod == "" || input.PaymentReference == "" || !beaconRatePattern.MatchString(input.CNYPerUnit) {
				return input, ErrBeaconLedgerInput
			}
			fx, err := decimal.NewFromString(input.CNYPerUnit)
			if err != nil || !fx.IsPositive() {
				return input, ErrBeaconLedgerInput
			}
			input.CNYPerUnit = fx.String()
		} else if input.PaymentMethod != "" || input.PaymentReference != "" || input.CNYPerUnit != "" || input.FXSource != "" {
			return input, ErrBeaconLedgerInput
		}
	default:
		return input, ErrBeaconLedgerInput
	}
	return input, nil
}

// NormalizeBeaconLedgerInput is shared by proof binding and posting so a proof
// covers the same canonical financial details that will actually be recorded.
func NormalizeBeaconLedgerInput(input BeaconLedgerInput) (BeaconLedgerInput, error) {
	return input.normalized(common.GetTimestamp())
}

// The books list customer entries, top-ups paid to upstreams and operating
// expenses together. Rows recorded in the same second are listed in this
// source order.
const (
	BeaconBookCustomer = "customer"
	BeaconBookUpstream = "upstream"
	BeaconBookExpense  = "expense"
)

var beaconBookSources = []string{BeaconBookCustomer, BeaconBookUpstream, BeaconBookExpense}

// BeaconBookEntry is one row of the books. Exactly one of Customer, Upstream
// and Expense is set, according to Source.
type BeaconBookEntry struct {
	Source       string                 `json:"source"`
	CorrectionID *int64                 `json:"correction_id"`
	Customer     *BeaconLedgerEntry     `json:"customer,omitempty"`
	Upstream     *BeaconUpstreamPayment `json:"upstream,omitempty"`
	ChannelName  string                 `json:"channel_name,omitempty"`
	Expense      *BeaconExpense         `json:"expense,omitempty"`
	recordedAt   int64
	rank         int
	id           int64
}

type BeaconBookPage struct {
	Items []BeaconBookEntry `json:"items"`
	// Next is the cursor of the following page, empty on the last page.
	Next string `json:"next"`
}

// ListBeaconBookEntries lists the books newest recorded first. The cursor is
// "recorded_at-source rank-id" of the last row seen, so rows posted meanwhile
// do not shift later pages. A customer filter lists only that customer's
// entries. Corrections are resolved even when they fall outside the page.
func ListBeaconBookEntries(source string, userID int, cursor string, limit int) (*BeaconBookPage, error) {
	if userID < 0 || limit < 1 || limit > 100 || (source != "" && !slices.Contains(beaconBookSources, source)) ||
		(userID > 0 && source != "" && source != BeaconBookCustomer) {
		return nil, ErrBeaconLedgerInput
	}
	var after *BeaconBookEntry
	if cursor != "" {
		parts := strings.Split(cursor, "-")
		if len(parts) != 3 {
			return nil, ErrBeaconLedgerInput
		}
		at, atErr := strconv.ParseInt(parts[0], 10, 64)
		rank, rankErr := strconv.Atoi(parts[1])
		id, idErr := strconv.ParseInt(parts[2], 10, 64)
		if atErr != nil || rankErr != nil || idErr != nil || rank < 0 || rank >= len(beaconBookSources) || id <= 0 {
			return nil, ErrBeaconLedgerInput
		}
		after = &BeaconBookEntry{recordedAt: at, rank: rank, id: id}
	}
	var items []BeaconBookEntry
	for rank, name := range beaconBookSources {
		if (source != "" && source != name) || (userID > 0 && name != BeaconBookCustomer) {
			continue
		}
		query := DB.Order("recorded_at DESC, id DESC").Limit(limit + 1)
		switch {
		case after == nil:
		case rank > after.rank:
			query = query.Where("recorded_at <= ?", after.recordedAt)
		case rank == after.rank:
			query = query.Where("(recorded_at < ? OR (recorded_at = ? AND id < ?))", after.recordedAt, after.recordedAt, after.id)
		default:
			query = query.Where("recorded_at < ?", after.recordedAt)
		}
		switch name {
		case BeaconBookCustomer:
			if userID > 0 {
				query = query.Where("user_id = ?", userID)
			}
			var rows []BeaconLedgerEntry
			if err := query.Find(&rows).Error; err != nil {
				return nil, err
			}
			for i := range rows {
				items = append(items, BeaconBookEntry{Source: name, Customer: &rows[i], recordedAt: rows[i].RecordedAt, rank: rank, id: rows[i].ID})
			}
		case BeaconBookUpstream:
			var rows []BeaconUpstreamPayment
			if err := query.Find(&rows).Error; err != nil {
				return nil, err
			}
			for i := range rows {
				items = append(items, BeaconBookEntry{Source: name, Upstream: &rows[i], recordedAt: rows[i].RecordedAt, rank: rank, id: rows[i].ID})
			}
		case BeaconBookExpense:
			var rows []BeaconExpense
			if err := query.Find(&rows).Error; err != nil {
				return nil, err
			}
			for i := range rows {
				items = append(items, BeaconBookEntry{Source: name, Expense: &rows[i], recordedAt: rows[i].RecordedAt, rank: rank, id: rows[i].ID})
			}
		}
	}
	slices.SortFunc(items, func(a, b BeaconBookEntry) int {
		if a.recordedAt != b.recordedAt {
			return cmp.Compare(b.recordedAt, a.recordedAt)
		}
		if a.rank != b.rank {
			return cmp.Compare(a.rank, b.rank)
		}
		return cmp.Compare(b.id, a.id)
	})
	page := &BeaconBookPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		page.Next = fmt.Sprintf("%d-%d-%d", last.recordedAt, last.rank, last.id)
	}
	if page.Items == nil {
		page.Items = []BeaconBookEntry{}
	}

	ids := map[string][]int64{}
	var channelIDs []int
	for _, item := range page.Items {
		ids[item.Source] = append(ids[item.Source], item.id)
		if item.Upstream != nil {
			channelIDs = append(channelIDs, item.Upstream.ChannelID)
		}
	}
	corrections := map[string]map[int64]int64{}
	for name, tableIDs := range ids {
		var rows []struct {
			ID         int64
			CorrectsID int64
		}
		query := DB.Model(&BeaconLedgerEntry{})
		switch name {
		case BeaconBookUpstream:
			query = DB.Model(&BeaconUpstreamPayment{})
		case BeaconBookExpense:
			query = DB.Model(&BeaconExpense{})
		}
		if err := query.Select("id", "corrects_id").Where("corrects_id IN ?", tableIDs).Scan(&rows).Error; err != nil {
			return nil, err
		}
		corrections[name] = make(map[int64]int64, len(rows))
		for _, row := range rows {
			corrections[name][row.CorrectsID] = row.ID
		}
	}
	channelNames := map[int]string{}
	if len(channelIDs) > 0 {
		var channels []Channel
		if err := DB.Select("id", "name").Where("id IN ?", channelIDs).Find(&channels).Error; err != nil {
			return nil, err
		}
		for _, channel := range channels {
			channelNames[channel.Id] = channel.Name
		}
	}
	for i := range page.Items {
		item := &page.Items[i]
		if id, ok := corrections[item.Source][item.id]; ok {
			item.CorrectionID = &id
		}
		if item.Upstream != nil {
			item.ChannelName = channelNames[item.Upstream.ChannelID]
		}
	}
	return page, nil
}

// PostBeaconLedgerEntry is an internal posting primitive, not an HTTP handler.
// The caller must supply the authenticated operator, never a client-supplied ID.
// created=false means an identical committed request was replayed. Callers must
// reuse the key after timeouts and must not implement a retry with a new key.
// Redis/batch mode is rejected until distributed quota consistency is designed.
func PostBeaconLedgerEntry(input BeaconLedgerInput, operatorID int) (entry *BeaconLedgerEntry, created bool, err error) {
	if operatorID <= 0 {
		return nil, false, ErrBeaconLedgerActor
	}
	if common.RedisEnabled || common.BatchUpdateEnabled {
		return nil, false, ErrBeaconLedgerMode
	}
	input, err = NormalizeBeaconLedgerInput(input)
	if err != nil {
		return nil, false, err
	}
	encoded, err := common.Marshal(struct {
		Input      BeaconLedgerInput
		OperatorID int
	}{input, operatorID})
	if err != nil {
		return nil, false, err
	}
	requestHash := fmt.Sprintf("%x", sha256.Sum256(encoded))
	entry = &BeaconLedgerEntry{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var operator User
		if err := lockForUpdate(tx).Select("id", "role", "status").First(&operator, operatorID).Error; err != nil {
			return ErrBeaconLedgerActor
		}
		if operator.Role != common.RoleRootUser || operator.Status != common.UserStatusEnabled {
			return ErrBeaconLedgerActor
		}
		lookupErr := tx.Where("idempotency_key = ?", input.IdempotencyKey).First(entry).Error
		if lookupErr == nil {
			if entry.RequestHash != requestHash {
				return ErrBeaconLedgerConflict
			}
			return nil
		}
		if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return lookupErr
		}
		*entry = BeaconLedgerEntry{
			IdempotencyKey: input.IdempotencyKey, RequestHash: requestHash, Kind: input.Kind,
			UserID: input.UserID, OperatorID: operatorID, Currency: input.Currency,
			QuotaDelta: input.Quota, FXSource: input.FXSource,
			PaymentMethod: input.PaymentMethod, PaymentReference: input.PaymentReference,
			OccurredAt: input.OccurredAt, RecordedAt: common.GetTimestamp(), Note: input.Note,
		}
		switch input.Kind {
		case BeaconReceipt:
			entry.OriginalAmountMinor, entry.CNYAmountMinor, entry.CNYPerUnit, err = beaconMoneySnapshot(input.Amount, input.Currency, input.CNYPerUnit)
			if err != nil {
				return err
			}
		case BeaconGift:
			entry.Currency, entry.CNYPerUnit = "CNY", "1"
		case BeaconRefund, BeaconReversal:
			var original BeaconLedgerEntry
			if err := lockForUpdate(tx).First(&original, input.CorrectsID).Error; err != nil {
				return err
			}
			if original.CorrectsID != nil || (original.Kind != BeaconReceipt && original.Kind != BeaconGift) || (input.Kind == BeaconRefund && original.Kind != BeaconReceipt) {
				return ErrBeaconLedgerInput
			}
			entry.UserID, entry.Currency, entry.CorrectsID = original.UserID, original.Currency, &original.ID
			entry.QuotaDelta, entry.OriginalAmountMinor, entry.CNYAmountMinor = -original.QuotaDelta, -original.OriginalAmountMinor, -original.CNYAmountMinor
			entry.CNYPerUnit, entry.FXSource = original.CNYPerUnit, original.FXSource
			if input.Kind == BeaconRefund {
				// A real refund has its own FX snapshot; an accounting reversal
				// exactly negates the original snapshot without revaluing it.
				amount := decimal.NewFromInt(original.OriginalAmountMinor).Shift(-2).StringFixed(2)
				_, cny, rate, err := beaconMoneySnapshot(amount, original.Currency, input.CNYPerUnit)
				if err != nil {
					return err
				}
				entry.CNYAmountMinor, entry.CNYPerUnit, entry.FXSource = -cny, rate, input.FXSource
			}
		}
		if entry.PaymentReference != "" {
			identity := fmt.Sprintf("%x", sha256.Sum256([]byte(entry.PaymentMethod+"\x00"+entry.PaymentReference)))
			entry.PaymentIdentity = &identity
		}
		// Insert first: both idempotency and payment/correction uniqueness must
		// succeed before touching the wallet; any failure rolls back both.
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		wallet := tx.Model(&User{}).Where("id = ? AND status = ?", entry.UserID, common.UserStatusEnabled)
		if entry.QuotaDelta > 0 {
			wallet = wallet.Where("quota <= ?", common.MaxWalletQuota-entry.QuotaDelta)
		} else {
			wallet = wallet.Where("quota >= ?", -entry.QuotaDelta)
		}
		result := wallet.Update("quota", gorm.Expr("quota + ?", entry.QuotaDelta))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			var user User
			if err := tx.Select("id", "status").First(&user, entry.UserID).Error; err != nil {
				return err
			}
			if user.Status != common.UserStatusEnabled {
				return ErrBeaconLedgerInput
			}
			if entry.QuotaDelta < 0 {
				return ErrBeaconInsufficientQuota
			}
			return ErrWalletQuotaLimitExceeded
		}
		created = true
		return nil
	})
	if err == nil {
		return entry, created, nil
	}
	// A conflicting insert may have waited for another transaction to commit.
	// Re-read outside the rolled-back transaction (important on PostgreSQL).
	// Never turn an operator authorization failure into a successful replay.
	if errors.Is(err, ErrBeaconLedgerActor) {
		return nil, false, err
	}
	var previous BeaconLedgerEntry
	if DB.Where("idempotency_key = ?", input.IdempotencyKey).First(&previous).Error == nil {
		if previous.RequestHash == requestHash {
			return &previous, false, nil
		}
		return nil, false, ErrBeaconLedgerConflict
	}
	if entry.PaymentIdentity != nil && DB.Where("payment_identity = ?", *entry.PaymentIdentity).First(&previous).Error == nil {
		return nil, false, ErrBeaconDuplicatePayment
	}
	if input.CorrectsID > 0 && DB.Where("corrects_id = ?", input.CorrectsID).First(&previous).Error == nil {
		return nil, false, ErrBeaconAlreadyCorrected
	}
	return nil, false, err
}
