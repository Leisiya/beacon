package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func beaconLedgerOperator(c *gin.Context) (service.AuthIdentity, bool) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok || c.GetInt("role") != common.RoleRootUser {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Manual ledger requires a root browser sign-in."))
		return service.AuthIdentity{}, false
	}
	return identity, true
}

func writeBeaconLedgerError(c *gin.Context, err error) {
	status, message := http.StatusConflict, "Unable to process this ledger request."
	switch {
	case errors.Is(err, model.ErrBeaconLedgerInput):
		status, message = http.StatusBadRequest, "Check the ledger amount, currency, quota, reference, date and reason."
	case errors.Is(err, model.ErrBeaconLedgerConflict):
		message = "This request key belongs to different ledger details."
	case errors.Is(err, model.ErrBeaconDuplicatePayment):
		message = "This payment reference has already been recorded."
	case errors.Is(err, model.ErrBeaconAlreadyCorrected):
		message = "This entry has already been refunded or reversed."
	case errors.Is(err, model.ErrBeaconInsufficientQuota):
		message = "The customer's available quota is insufficient for a full correction."
	case errors.Is(err, model.ErrWalletQuotaLimitExceeded):
		message = "Wallet quota limit exceeded"
	case errors.Is(err, model.ErrBeaconLedgerActor):
		status, message = http.StatusForbidden, "Manual ledger requires a root browser sign-in."
	case errors.Is(err, model.ErrBeaconLedgerMode):
		message = "Manual ledger is unavailable while Redis or batch quota updates are enabled."
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, message = http.StatusNotFound, "The customer or original ledger entry was not found."
	default:
		status = http.StatusInternalServerError
		_ = c.Error(err)
	}
	common.ApiErrorStatus(c, status, common.NewMessage(message))
}

func GetBeaconLedger(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	if c.Query("view") == "cash_summary" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		summary, err := model.GetBeaconCashSummary(ctx, c.DefaultQuery("period", "today"), c.Query("start"), c.Query("end"), time.Now())
		if err != nil {
			writeBeaconLedgerError(c, err)
			return
		}
		common.ApiSuccess(c, summary)
		return
	}
	if c.Query("view") == "reconciliation" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		reconciliation, err := model.GetBeaconQuotaReconciliation(ctx, time.Now())
		if err != nil {
			writeBeaconLedgerError(c, err)
			return
		}
		common.ApiSuccess(c, reconciliation)
		return
	}
	userID, userErr := strconv.Atoi(c.DefaultQuery("user_id", "0"))
	before, cursorErr := strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	limit, limitErr := strconv.Atoi(c.DefaultQuery("limit", "25"))
	if userErr != nil || cursorErr != nil || limitErr != nil {
		writeBeaconLedgerError(c, model.ErrBeaconLedgerInput)
		return
	}
	page, err := model.ListBeaconLedgerEntries(userID, before, limit)
	if err != nil {
		writeBeaconLedgerError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items": page.Items, "next_before": page.NextBefore,
		"base_currency": "CNY", "business_timezone": "Asia/Shanghai",
		"posting_available": !common.RedisEnabled && !common.BatchUpdateEnabled,
	})
}

func PostBeaconLedger(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var input model.BeaconLedgerInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconLedgerError(c, model.ErrBeaconLedgerInput)
		return
	}
	input, err := model.NormalizeBeaconLedgerInput(input)
	if err != nil {
		writeBeaconLedgerError(c, err)
		return
	}
	if common.RedisEnabled || common.BatchUpdateEnabled {
		writeBeaconLedgerError(c, model.ErrBeaconLedgerMode)
		return
	}
	context, err := common.Marshal(service.BeaconLedgerPostContext{Entry: input})
	if err != nil {
		writeBeaconLedgerError(c, err)
		return
	}
	authorization := middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeBeaconLedgerPost, Context: context})
	if authorization == nil {
		return
	}
	entry, created, err := model.PostBeaconLedgerEntry(input, identity.UserID)
	if err != nil {
		writeBeaconLedgerError(c, err)
		return
	}
	if created {
		recordManageAuditFor(c, entry.UserID, "beacon.ledger.post", map[string]any{
			"entry_id": entry.ID, "kind": entry.Kind, "verification_method": authorization.Method,
		})
	}
	common.ApiSuccess(c, gin.H{"entry": entry, "created": created})
}
