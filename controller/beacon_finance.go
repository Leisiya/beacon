package controller

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func writeBeaconFinanceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrBeaconLedgerInput), errors.Is(err, model.ErrBeaconCostInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Check the period and grouping."))
	case errors.Is(err, model.ErrBeaconPaymentInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Check the channel, amount, credit, date and note."))
	case errors.Is(err, model.ErrBeaconExpenseInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Check the category, amount, date and note."))
	case errors.Is(err, model.ErrBeaconPaymentConflict):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("This request key belongs to a different payment."))
	case errors.Is(err, model.ErrBeaconPaymentReversed):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("This payment has already been reversed."))
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("The channel or payment was not found."))
	default:
		_ = c.Error(err)
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Unable to process this finance request."))
	}
}

// GetBeaconFinance serves the finance views: overview, profit, customers and
// upstreams.
func GetBeaconFinance(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	now := time.Now()
	period, start, end := c.DefaultQuery("period", "today"), c.Query("start"), c.Query("end")
	var result any
	var err error
	switch c.DefaultQuery("view", "overview") {
	case "overview":
		result, err = model.GetBeaconFinanceOverview(ctx, now)
	case "profit":
		result, err = model.GetBeaconProfitSummary(ctx, period, start, end, c.DefaultQuery("group_by", "day"), now)
	case "customers":
		result, err = model.GetBeaconCustomerFinance(ctx, period, start, end, now)
	case "upstreams":
		result, err = model.GetBeaconUpstreamFinance(ctx, period, start, end, now)
	default:
		err = model.ErrBeaconCostInput
	}
	if err != nil {
		writeBeaconFinanceError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func PostBeaconUpstreamPayment(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var input model.BeaconUpstreamPaymentInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconFinanceError(c, model.ErrBeaconPaymentInput)
		return
	}
	payment, created, err := model.CreateBeaconUpstreamPayment(input, identity.UserID, time.Now().Unix())
	if err != nil {
		writeBeaconFinanceError(c, err)
		return
	}
	if created {
		recordManageAuditFor(c, 0, "beacon.finance.payment", map[string]any{
			"payment_id": payment.ID, "kind": payment.Kind, "channel_id": payment.ChannelID,
			"cny_amount_minor": payment.CNYAmountMinor, "credit_micro": payment.CreditMicro, "corrects_id": payment.CorrectsID,
		})
	}
	common.ApiSuccess(c, gin.H{"payment": payment, "created": created})
}

func PostBeaconExpense(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var input model.BeaconExpenseInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconFinanceError(c, model.ErrBeaconExpenseInput)
		return
	}
	expense, created, err := model.CreateBeaconExpense(input, identity.UserID, time.Now().Unix())
	if err != nil {
		writeBeaconFinanceError(c, err)
		return
	}
	if created {
		recordManageAuditFor(c, 0, "beacon.finance.expense", map[string]any{
			"expense_id": expense.ID, "kind": expense.Kind, "category": expense.Category,
			"cny_amount_minor": expense.CNYAmountMinor, "corrects_id": expense.CorrectsID,
		})
	}
	common.ApiSuccess(c, gin.H{"expense": expense, "created": created})
}
