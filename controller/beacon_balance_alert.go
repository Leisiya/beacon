package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

const (
	beaconBalanceAlertLow     = "low"
	beaconBalanceAlertUnknown = "unknown"
	// Failed balance queries in a row before the group hears about it, so one
	// upstream hiccup does not page anyone.
	beaconBalanceFailuresBeforeAlert = 3
)

type beaconBalanceReading struct {
	ChannelID int
	Name      string
	Balance   float64
	Err       error
}

type beaconBalanceState struct {
	failures int
	// alert is the alert last posted and not yet cleared by a recovery notice.
	alert      string
	notifiedAt time.Time
}

// beaconBalanceAlert posts to a Feishu group when an upstream balance drops
// below the threshold, reminds while it stays low, and says when it recovers.
type beaconBalanceAlert struct {
	threshold float64
	remind    time.Duration
	lang      string
	send      func(text string) error
	states    map[int]*beaconBalanceState
}

// StartBeaconBalanceAlert checks every enabled upstream's balance on a timer
// when BEACON_BALANCE_ALERT_FEISHU_WEBHOOK is set. Balances are in the
// upstream's own dollars, as the channel balance query reports them.
func StartBeaconBalanceAlert() {
	webhook := strings.TrimSpace(os.Getenv("BEACON_BALANCE_ALERT_FEISHU_WEBHOOK"))
	if webhook == "" {
		return
	}
	threshold := 100.0
	if raw := strings.TrimSpace(os.Getenv("BEACON_BALANCE_ALERT_USD")); raw != "" {
		parsed, err := strconv.ParseFloat(raw, 64)
		if err != nil || parsed <= 0 {
			common.SysError(common.LogText("invalid BEACON_BALANCE_ALERT_USD: %s", raw))
			return
		}
		threshold = parsed
	}
	minutes := common.GetEnvOrDefault("BEACON_BALANCE_ALERT_MINUTES", 5)
	remindMinutes := common.GetEnvOrDefault("BEACON_BALANCE_ALERT_REMIND_MINUTES", 60)
	if minutes <= 0 || remindMinutes <= 0 {
		common.SysError(common.LogText("invalid upstream balance alert interval: check every %d minutes, remind every %d minutes", minutes, remindMinutes))
		return
	}
	secret := strings.TrimSpace(os.Getenv("BEACON_BALANCE_ALERT_FEISHU_SECRET"))
	alert := &beaconBalanceAlert{
		threshold: threshold,
		remind:    time.Duration(remindMinutes) * time.Minute,
		lang:      strings.TrimSpace(os.Getenv("BEACON_BALANCE_ALERT_LANGUAGE")),
		send: func(text string) error {
			return sendFeishuText(service.GetHttpClient(), webhook, secret, text)
		},
		states: map[int]*beaconBalanceState{},
	}
	common.SysLog(common.LogText("upstream balance alert on: below $%s, checked every %d minutes", strconv.FormatFloat(threshold, 'f', -1, 64), minutes))
	go func() {
		for {
			alert.post(readBeaconUpstreamBalances(), time.Now())
			time.Sleep(time.Duration(minutes) * time.Minute)
		}
	}()
}

// readBeaconUpstreamBalances queries the balance of every enabled upstream
// that supports a balance query; the query also stores the balance on the
// channel, so the ledger's upstream tab stays current.
func readBeaconUpstreamBalances() []beaconBalanceReading {
	channels, err := model.GetAllChannels(0, 0, true, false)
	if err != nil {
		common.SysError(common.LogText("failed to list channels for the balance alert: %s", err.Error()))
		return nil
	}
	var readings []beaconBalanceReading
	for _, channel := range channels {
		if channel.Status != common.ChannelStatusEnabled || channel.ChannelInfo.IsMultiKey || channel.Type == constant.ChannelTypeTaskPlugin {
			continue
		}
		result, err := updateChannelBalance(channel)
		var message *common.Message
		if errors.As(err, &message) && message.Key == "Not implemented yet" {
			continue
		}
		if err == nil && result.RawResponse != "" {
			continue
		}
		readings = append(readings, beaconBalanceReading{ChannelID: channel.Id, Name: channel.Name, Balance: result.Balance, Err: err})
		time.Sleep(common.RequestInterval)
	}
	return readings
}

// post sends one message covering every upstream that went low, stayed low
// past the reminder interval, could not be read, or recovered. A failed send
// leaves the alerts pending so the next check tries again.
func (a *beaconBalanceAlert) post(readings []beaconBalanceReading, now time.Time) {
	var lines []string
	posted := map[int]string{}
	for _, reading := range readings {
		state := a.states[reading.ChannelID]
		if state == nil {
			state = &beaconBalanceState{}
			a.states[reading.ChannelID] = state
		}
		data := map[string]any{"Name": reading.Name, "ID": reading.ChannelID}
		due := now.Sub(state.notifiedAt) >= a.remind
		if reading.Err != nil {
			state.failures++
			if state.failures < beaconBalanceFailuresBeforeAlert || (state.alert == beaconBalanceAlertUnknown && !due) {
				continue
			}
			data["Count"] = state.failures
			data["Error"] = reading.Err.Error()
			lines = append(lines, i18n.Translate(a.lang, i18n.MsgBeaconBalanceUnknown, data))
			posted[reading.ChannelID] = beaconBalanceAlertUnknown
			continue
		}
		state.failures = 0
		data["Balance"] = fmt.Sprintf("%.2f", reading.Balance)
		if reading.Balance >= a.threshold {
			if state.alert != "" {
				lines = append(lines, i18n.Translate(a.lang, i18n.MsgBeaconBalanceRecovered, data))
				posted[reading.ChannelID] = ""
			}
			continue
		}
		if state.alert == beaconBalanceAlertLow && !due {
			continue
		}
		data["Threshold"] = strconv.FormatFloat(a.threshold, 'f', -1, 64)
		lines = append(lines, i18n.Translate(a.lang, i18n.MsgBeaconBalanceLow, data))
		posted[reading.ChannelID] = beaconBalanceAlertLow
	}
	if len(lines) == 0 {
		return
	}
	text := i18n.Translate(a.lang, i18n.MsgBeaconBalanceAlertTitle, nil) + "\n" + strings.Join(lines, "\n")
	if err := a.send(text); err != nil {
		common.SysError(common.LogText("failed to send the upstream balance alert: %s", err.Error()))
		return
	}
	for id, alert := range posted {
		a.states[id].alert = alert
		a.states[id].notifiedAt = now
	}
}

// sendFeishuText posts a text message to a Feishu or Lark custom group bot.
// With a secret, the request carries the signature the bot's signature check
// expects.
func sendFeishuText(client *http.Client, webhookURL, secret, text string) error {
	payload := map[string]any{
		"msg_type": "text",
		"content":  map[string]string{"text": text},
	}
	if secret != "" {
		timestamp := strconv.FormatInt(time.Now().Unix(), 10)
		mac := hmac.New(sha256.New, []byte(timestamp+"\n"+secret))
		payload["timestamp"] = timestamp
		payload["sign"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		// Keep the webhook token, which the request error quotes, out of the logs.
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return fmt.Errorf("feishu bot request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("feishu bot returned HTTP %d: %s", resp.StatusCode, respBody)
	}
	// Feishu answers {"code":0,...}; older bots answer {"StatusCode":0,...}.
	var result struct {
		Code       int `json:"code"`
		StatusCode int `json:"StatusCode"`
	}
	if err := common.Unmarshal(respBody, &result); err != nil || result.Code != 0 || result.StatusCode != 0 {
		return fmt.Errorf("feishu bot rejected the message: %s", respBody)
	}
	return nil
}
