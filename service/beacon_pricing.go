package service

import (
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
)

const beaconPricingNotifyType = "beacon_pricing"

var (
	beaconBelowMinimumLock sync.Mutex
	// Models already reported below their minimum markup; a model is reported
	// again only after it has recovered. Reset on restart.
	beaconBelowMinimum = map[string]bool{}
)

// EvaluateBeaconPricing runs the price rules and tells administrators who
// receive channel notices about new proposals, automatic changes, failures and
// models that just fell below their minimum markup.
func EvaluateBeaconPricing() (*model.BeaconPricingOutcome, error) {
	outcome, err := model.EvaluateBeaconPricing(time.Now().Unix())
	if err != nil {
		common.SysError(common.LogText("failed to evaluate price rules: %s", err.Error()))
		return nil, err
	}
	beaconBelowMinimumLock.Lock()
	var newlyBelow []string
	current := map[string]bool{}
	for _, name := range outcome.BelowMinimum {
		current[name] = true
		if !beaconBelowMinimum[name] {
			newlyBelow = append(newlyBelow, name)
		}
	}
	beaconBelowMinimum = current
	beaconBelowMinimumLock.Unlock()

	sections := []struct {
		key    string
		models []string
	}{
		{i18n.MsgBeaconPricingApplied, outcome.Applied},
		{i18n.MsgBeaconPricingProposed, outcome.Proposed},
		{i18n.MsgBeaconPricingFailed, outcome.Failed},
		{i18n.MsgBeaconPricingBelowMinimum, newlyBelow},
	}
	notify := false
	for _, section := range sections {
		notify = notify || len(section.models) > 0
	}
	if !notify {
		return outcome, nil
	}
	NotifyChannelWatchers(beaconPricingNotifyType, func(lang string) (string, string) {
		lines := make([]string, 0, len(sections))
		for _, section := range sections {
			if len(section.models) > 0 {
				lines = append(lines, i18n.Translate(lang, section.key, map[string]any{"Models": strings.Join(section.models, ", ")}))
			}
		}
		return i18n.Translate(lang, i18n.MsgBeaconPricingNotifySubject, nil), strings.Join(lines, "\n")
	})
	return outcome, nil
}
