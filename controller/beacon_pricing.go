package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func writeBeaconPricingError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrBeaconPricingInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Check the price rule mode and percentages."))
	case errors.Is(err, model.ErrBeaconReferencePrice):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Enter a top-up price above 0 with up to 8 decimal places."))
	case errors.Is(err, model.ErrBeaconProposalClosed):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("This price change is no longer pending."))
	case errors.Is(err, model.ErrBeaconProposalOutdated):
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage("The model price changed after this suggestion was made. Recalculate and review the new suggestion."))
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("The price change was not found."))
	default:
		_ = c.Error(err)
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Unable to process this price rule request."))
	}
}

func GetBeaconPricing(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	report, err := model.AnalyzeBeaconPricing()
	if err != nil {
		writeBeaconPricingError(c, err)
		return
	}
	common.ApiSuccess(c, report)
}

func PostBeaconPricingRule(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var input model.BeaconPricingRule
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconPricingError(c, model.ErrBeaconPricingInput)
		return
	}
	rule, err := model.SaveBeaconPricingRule(input, identity.UserID, time.Now().Unix())
	if err != nil {
		writeBeaconPricingError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "beacon.pricing.rule", map[string]any{
		"model_name": rule.ModelName, "mode": rule.Mode, "markup_bp": rule.MarkupBP, "auto_apply": rule.AutoApply,
		"follow_down": rule.FollowDown, "max_step_bp": rule.MaxStepBP, "min_markup_bp": rule.MinMarkupBP,
	})
	_, _ = service.EvaluateBeaconPricing()
	common.ApiSuccess(c, gin.H{"rule": rule})
}

func DeleteBeaconPricingRule(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	name := c.Query("model")
	if err := model.DeleteBeaconPricingRule(name); err != nil {
		writeBeaconPricingError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "beacon.pricing.rule_delete", map[string]any{"model_name": name})
	_, _ = service.EvaluateBeaconPricing()
	common.ApiSuccess(c, nil)
}

func PostBeaconReferencePrice(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<10)
	var input struct {
		CNYPerUnit string `json:"cny_per_unit"`
	}
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconPricingError(c, model.ErrBeaconReferencePrice)
		return
	}
	previous := operation_setting.Price
	value, err := model.SetBeaconReferencePrice(input.CNYPerUnit)
	if err != nil {
		writeBeaconPricingError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "beacon.pricing.reference", map[string]any{"previous": previous, "cny_per_unit": value})
	_, _ = service.EvaluateBeaconPricing()
	common.ApiSuccess(c, gin.H{"cny_per_unit": value})
}

func PostBeaconPricingEvaluate(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	outcome, err := service.EvaluateBeaconPricing()
	if err != nil {
		writeBeaconPricingError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"proposed": outcome.Proposed, "applied": outcome.Applied,
		"failed": outcome.Failed, "below_minimum": outcome.BelowMinimum,
	})
}

func PostBeaconPriceProposal(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		writeBeaconPricingError(c, gorm.ErrRecordNotFound)
		return
	}
	now := time.Now().Unix()
	action := c.Param("action")
	switch action {
	case "apply":
		err = model.ApplyBeaconPriceProposal(id, identity.UserID, now)
	case "dismiss":
		err = model.DismissBeaconPriceProposal(id, identity.UserID, now)
	default:
		writeBeaconPricingError(c, gorm.ErrRecordNotFound)
		return
	}
	if err != nil {
		if !errors.Is(err, model.ErrBeaconProposalClosed) && !errors.Is(err, model.ErrBeaconProposalOutdated) && !errors.Is(err, gorm.ErrRecordNotFound) {
			_ = c.Error(err)
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("The new price failed model pricing validation. Review the model's billing expression."))
			return
		}
		writeBeaconPricingError(c, err)
		return
	}
	recordManageAuditFor(c, 0, "beacon.pricing."+action, map[string]any{"proposal_id": id})
	common.ApiSuccess(c, nil)
}
