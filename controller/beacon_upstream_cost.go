package controller

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type beaconCostSource struct {
	model.BeaconCostChannel
	Rates       []model.BeaconUpstreamRate      `json:"rates"`
	Observation *model.BeaconChannelObservation `json:"observation"`
	Sync        *service.BeaconCostSyncStatus   `json:"sync"`
}

func writeBeaconCostError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrBeaconCostInput), errors.Is(err, model.ErrBeaconLedgerInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Check the channel, rate and effective time."))
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("The channel was not found."))
	default:
		_ = c.Error(err)
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Unable to process this upstream cost request."))
	}
}

// GetBeaconCosts lists channels with their purchase prices and sync state.
func GetBeaconCosts(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	channels, err := model.ListBeaconCostChannels()
	if err != nil {
		writeBeaconCostError(c, err)
		return
	}
	rates, err := model.ListBeaconUpstreamRates()
	if err != nil {
		writeBeaconCostError(c, err)
		return
	}
	byChannel := map[int][]model.BeaconUpstreamRate{}
	for _, rate := range rates {
		byChannel[rate.ChannelID] = append(byChannel[rate.ChannelID], rate)
	}
	statuses := service.BeaconCostSyncStatuses()
	sources := make([]beaconCostSource, 0, len(channels))
	for _, channel := range channels {
		source := beaconCostSource{BeaconCostChannel: channel, Rates: byChannel[channel.ID]}
		if source.Rates == nil {
			source.Rates = []model.BeaconUpstreamRate{}
		}
		if status, ok := statuses[channel.ID]; ok {
			source.Sync = &status
		}
		if len(source.Rates) > 0 {
			if source.Observation, err = model.LatestBeaconChannelObservation(channel.ID); err != nil {
				writeBeaconCostError(c, err)
				return
			}
		}
		sources = append(sources, source)
	}
	common.ApiSuccess(c, gin.H{"sources": sources, "now": time.Now().Unix()})
}

func PostBeaconUpstreamRate(c *gin.Context) {
	identity, ok := beaconLedgerOperator(c)
	if !ok {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var input model.BeaconUpstreamRate
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeBeaconCostError(c, model.ErrBeaconCostInput)
		return
	}
	rate, err := model.CreateBeaconUpstreamRate(input, identity.UserID, time.Now().Unix())
	if rate != nil {
		recordManageAuditFor(c, 0, "beacon.cost.rate", map[string]any{
			"rate_id": rate.ID, "channel_id": rate.ChannelID, "cny_per_unit": rate.CNYPerUnit, "effective_at": rate.EffectiveAt,
		})
	}
	if err != nil {
		writeBeaconCostError(c, err)
		return
	}
	// A new rate changes the cost basis of every model the channel serves.
	_, _ = service.EvaluateBeaconPricing()
	common.ApiSuccess(c, gin.H{"rate": rate})
}

func PostBeaconCostSync(c *gin.Context) {
	if _, ok := beaconLedgerOperator(c); !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	common.ApiSuccess(c, gin.H{"statuses": service.SyncBeaconUpstreamCosts(ctx)})
}
