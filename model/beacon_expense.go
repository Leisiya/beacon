package model

import (
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	BeaconExpenseKind         = "expense"
	BeaconExpenseReversalKind = "reversal"
)

// Operating expense categories. Upstream top-ups are not expenses: they buy
// credit, which becomes cost as the upstream deducts it.
var beaconExpenseCategories = []string{"server", "promotion", "other"}

var ErrBeaconExpenseInput = errors.New("invalid expense input")

// BeaconExpense is money spent on running the business, such as servers or
// promotion. It counts against profit on the Shanghai day it was paid. Rows
// are append-only: a mistake is cancelled by a linked reversal row carrying
// the opposite amount.
type BeaconExpense struct {
	ID             int64  `json:"id" gorm:"primaryKey"`
	RequestKey     string `json:"-" gorm:"type:varchar(64);not null;uniqueIndex"`
	Kind           string `json:"kind" gorm:"type:varchar(16);not null"`
	Category       string `json:"category" gorm:"type:varchar(16);not null"`
	CNYAmountMinor int64  `json:"cny_amount_minor" gorm:"type:bigint;not null"`
	CorrectsID     *int64 `json:"corrects_id" gorm:"uniqueIndex"`
	OccurredAt     int64  `json:"occurred_at" gorm:"not null;index"`
	OperatorID     int    `json:"operator_id" gorm:"not null"`
	RecordedAt     int64  `json:"recorded_at" gorm:"not null"`
	Note           string `json:"note" gorm:"type:varchar(500);not null"`
}

// BeaconExpenseInput takes the CNY amount as decimal text with up to two
// decimals. A reversal names only the expense it cancels, with its own time.
type BeaconExpenseInput struct {
	RequestKey string `json:"request_key"`
	Category   string `json:"category"`
	Amount     string `json:"amount"`
	CorrectsID int64  `json:"corrects_id"`
	OccurredAt int64  `json:"occurred_at"`
	Note       string `json:"note"`
}

// CreateBeaconExpense records an expense or a reversal. Repeating a request
// key with the same details returns the stored row with created false.
func CreateBeaconExpense(input BeaconExpenseInput, operatorID int, now int64) (*BeaconExpense, bool, error) {
	input.RequestKey = strings.TrimSpace(input.RequestKey)
	input.Category = strings.TrimSpace(input.Category)
	input.Amount = strings.TrimSpace(input.Amount)
	input.Note = strings.TrimSpace(input.Note)
	if !beaconRequestKeyPattern.MatchString(input.RequestKey) || !utf8.ValidString(input.Note) ||
		utf8.RuneCountInString(input.Note) > 500 || strings.ContainsRune(input.Note, '\x00') ||
		input.OccurredAt < 946684800 || input.OccurredAt > now+300 {
		return nil, false, ErrBeaconExpenseInput
	}
	expense := BeaconExpense{RequestKey: input.RequestKey, OccurredAt: input.OccurredAt, OperatorID: operatorID, RecordedAt: now, Note: input.Note}
	if input.CorrectsID == 0 {
		if !beaconMoneyPattern.MatchString(input.Amount) || !slices.Contains(beaconExpenseCategories, input.Category) {
			return nil, false, ErrBeaconExpenseInput
		}
		amount, err := decimal.NewFromString(input.Amount)
		if err != nil {
			return nil, false, ErrBeaconExpenseInput
		}
		cents := amount.Shift(2)
		if !cents.IsPositive() || cents.GreaterThan(decimal.NewFromInt(beaconMaxMoneyMinor)) {
			return nil, false, ErrBeaconExpenseInput
		}
		expense.Kind, expense.Category, expense.CNYAmountMinor = BeaconExpenseKind, input.Category, cents.IntPart()
	} else {
		if input.CorrectsID < 0 || input.Category != "" || input.Amount != "" {
			return nil, false, ErrBeaconExpenseInput
		}
		expense.Kind, expense.CorrectsID = BeaconExpenseReversalKind, &input.CorrectsID
	}

	want := expense
	created := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing BeaconExpense
		if err := tx.Where("request_key = ?", expense.RequestKey).Limit(1).Find(&existing).Error; err != nil {
			return err
		}
		if existing.ID != 0 {
			expense = existing
			return nil
		}
		if expense.CorrectsID != nil {
			var original BeaconExpense
			if err := tx.First(&original, *expense.CorrectsID).Error; err != nil {
				return err
			}
			if original.Kind != BeaconExpenseKind {
				return ErrBeaconExpenseInput
			}
			var reversals int64
			if err := tx.Model(&BeaconExpense{}).Where("corrects_id = ?", original.ID).Count(&reversals).Error; err != nil {
				return err
			}
			if reversals > 0 {
				return ErrBeaconPaymentReversed
			}
			expense.Category, expense.CNYAmountMinor = original.Category, -original.CNYAmountMinor
		}
		if err := tx.Create(&expense).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	if created {
		return &expense, true, nil
	}
	sameTarget := expense.CorrectsID == nil && want.CorrectsID == nil
	if expense.CorrectsID != nil && want.CorrectsID != nil {
		sameTarget = *expense.CorrectsID == *want.CorrectsID
	}
	if expense.Kind != want.Kind || expense.OccurredAt != want.OccurredAt || expense.Note != want.Note || !sameTarget ||
		(want.Kind == BeaconExpenseKind && (expense.Category != want.Category || expense.CNYAmountMinor != want.CNYAmountMinor)) {
		return nil, false, ErrBeaconPaymentConflict
	}
	return &expense, false, nil
}
