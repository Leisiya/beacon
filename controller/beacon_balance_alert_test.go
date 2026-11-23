package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestBeaconBalanceAlert(t *testing.T, sent *[]string, sendErr *error) *beaconBalanceAlert {
	t.Helper()
	require.NoError(t, i18n.Init())
	return &beaconBalanceAlert{
		threshold: 100,
		remind:    time.Hour,
		lang:      i18n.LangEn,
		send: func(text string) error {
			if *sendErr != nil {
				return *sendErr
			}
			*sent = append(*sent, text)
			return nil
		},
		states: map[int]*beaconBalanceState{},
	}
}

func TestBeaconBalanceAlertPostsOnceThenRemindsAndRecovers(t *testing.T) {
	var sent []string
	var sendErr error
	alert := newTestBeaconBalanceAlert(t, &sent, &sendErr)
	start := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	low := []beaconBalanceReading{{ChannelID: 1, Name: "novaris", Balance: 5.284}, {ChannelID: 2, Name: "spare", Balance: 300}}

	alert.post(low, start)
	alert.post(low, start.Add(5*time.Minute))
	alert.post(low, start.Add(time.Hour))
	alert.post([]beaconBalanceReading{{ChannelID: 1, Name: "novaris", Balance: 250}}, start.Add(time.Hour+5*time.Minute))
	alert.post([]beaconBalanceReading{{ChannelID: 1, Name: "novaris", Balance: 250}}, start.Add(time.Hour+10*time.Minute))

	require.Len(t, sent, 3)
	assert.Equal(t, "Beacon upstream balance\nnovaris (#1) has $5.28 left, below $100. Top it up soon.", sent[0])
	assert.Equal(t, sent[0], sent[1])
	assert.Equal(t, "Beacon upstream balance\nnovaris (#1) has $250.00 again; back to normal.", sent[2])
}

func TestBeaconBalanceAlertWaitsForRepeatedQueryFailures(t *testing.T) {
	var sent []string
	var sendErr error
	alert := newTestBeaconBalanceAlert(t, &sent, &sendErr)
	start := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	failed := []beaconBalanceReading{{ChannelID: 1, Name: "novaris", Err: errors.New("connection refused")}}

	alert.post(failed, start)
	alert.post(failed, start.Add(5*time.Minute))
	assert.Empty(t, sent)
	alert.post(failed, start.Add(10*time.Minute))
	alert.post(failed, start.Add(15*time.Minute))
	alert.post([]beaconBalanceReading{{ChannelID: 1, Name: "novaris", Balance: 40}}, start.Add(20*time.Minute))

	require.Len(t, sent, 2)
	assert.Equal(t, "Beacon upstream balance\nnovaris (#1): the balance could not be read 3 times in a row: connection refused", sent[0])
	assert.Contains(t, sent[1], "novaris (#1) has $40.00 left, below $100.")
}

func TestBeaconBalanceAlertRetriesAfterAFailedSend(t *testing.T) {
	var sent []string
	sendErr := errors.New("feishu down")
	alert := newTestBeaconBalanceAlert(t, &sent, &sendErr)
	start := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	low := []beaconBalanceReading{{ChannelID: 1, Name: "novaris", Balance: 5}}

	alert.post(low, start)
	sendErr = nil
	alert.post(low, start.Add(5*time.Minute))

	require.Len(t, sent, 1)
	assert.Contains(t, sent[0], "has $5.00 left")
}

func TestSendFeishuTextSignsTheMessage(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		require.NoError(t, common.Unmarshal(raw, &body))
		_, _ = w.Write([]byte(`{"code":0,"msg":"success","data":{}}`))
	}))
	defer server.Close()

	require.NoError(t, sendFeishuText(server.Client(), server.URL, "s3cret", "hello"))

	assert.Equal(t, "text", body["msg_type"])
	assert.Equal(t, map[string]any{"text": "hello"}, body["content"])
	timestamp, ok := body["timestamp"].(string)
	require.True(t, ok)
	mac := hmac.New(sha256.New, []byte(timestamp+"\n"+"s3cret"))
	assert.Equal(t, base64.StdEncoding.EncodeToString(mac.Sum(nil)), body["sign"])
}

func TestSendFeishuTextReportsARejectedMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":19021,"msg":"sign match fail or timestamp is not within one hour from current time"}`))
	}))
	defer server.Close()

	err := sendFeishuText(server.Client(), server.URL, "", "hello")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "19021")
}
