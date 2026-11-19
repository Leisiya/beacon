package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"maps"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Beacon reads each supplier's own per-request deductions back from upstreams
// built on New API, which expose a key's recent consume log at
// /api/log/token. Only channels with a configured CNY rate are synced.

const (
	beaconUpstreamLogPath     = "/api/log/token"
	beaconUpstreamStatusPath  = "/api/status"
	beaconUpstreamBodyLimit   = 16 << 20
	beaconUpstreamTimeout     = 30 * time.Second
	beaconUpstreamConsumeType = 2
	beaconUpstreamExprLimit   = 4096
)

type BeaconCostSyncStatus struct {
	ChannelID     int    `json:"channel_id"`
	LastAttemptAt int64  `json:"last_attempt_at"`
	LastSuccessAt int64  `json:"last_success_at"`
	LastError     string `json:"last_error"`
	Fetched       int    `json:"fetched"`
	Inserted      int    `json:"inserted"`
}

var (
	beaconCostSyncLock   sync.Mutex
	beaconCostStatusLock sync.RWMutex
	beaconCostStatuses   = map[int]BeaconCostSyncStatus{}
)

func BeaconCostSyncStatuses() map[int]BeaconCostSyncStatus {
	beaconCostStatusLock.RLock()
	defer beaconCostStatusLock.RUnlock()
	result := make(map[int]BeaconCostSyncStatus, len(beaconCostStatuses))
	maps.Copy(result, beaconCostStatuses)
	return result
}

// StartBeaconCostSync syncs every BEACON_COST_SYNC_MINUTES (default 5, 0 off).
func StartBeaconCostSync() {
	minutes := 5
	if raw := strings.TrimSpace(os.Getenv("BEACON_COST_SYNC_MINUTES")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			common.SysError(common.LogText("invalid BEACON_COST_SYNC_MINUTES: %s", raw))
			return
		}
		minutes = parsed
	}
	if minutes == 0 {
		return
	}
	go func() {
		for {
			time.Sleep(time.Duration(minutes) * time.Minute)
			SyncBeaconUpstreamCosts(context.Background())
		}
	}()
}

// SyncBeaconUpstreamCosts syncs all channels that have a rate. Concurrent
// calls wait for the running sync instead of fetching twice.
func SyncBeaconUpstreamCosts(ctx context.Context) map[int]BeaconCostSyncStatus {
	beaconCostSyncLock.Lock()
	defer beaconCostSyncLock.Unlock()
	ids, err := model.BeaconChannelIDsWithRates()
	if err != nil {
		common.SysError(common.LogText("failed to list upstream cost channels: %s", err.Error()))
		return BeaconCostSyncStatuses()
	}
	for _, id := range ids {
		status := BeaconCostSyncStatus{ChannelID: id, LastAttemptAt: time.Now().Unix()}
		beaconCostStatusLock.RLock()
		status.LastSuccessAt = beaconCostStatuses[id].LastSuccessAt
		beaconCostStatusLock.RUnlock()
		fetched, inserted, err := syncBeaconChannelCosts(ctx, id)
		status.Fetched, status.Inserted = fetched, inserted
		if err != nil {
			status.LastError = err.Error()
		} else {
			status.LastSuccessAt = status.LastAttemptAt
		}
		beaconCostStatusLock.Lock()
		beaconCostStatuses[id] = status
		beaconCostStatusLock.Unlock()
	}
	if len(ids) > 0 {
		// New charges can carry a changed supplier price; errors are logged
		// by EvaluateBeaconPricing and do not fail the sync.
		_, _ = EvaluateBeaconPricing()
	}
	return BeaconCostSyncStatuses()
}

func syncBeaconChannelCosts(ctx context.Context, channelID int) (int, int, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return 0, 0, fmt.Errorf("channel not found")
	}
	baseURL := strings.TrimRight(channel.GetBaseURL(), "/")
	baseURL = strings.TrimSuffix(baseURL, "/v1")
	if baseURL == "" {
		return 0, 0, fmt.Errorf("channel has no API base URL")
	}
	setting := channel.GetSetting()
	client, err := GetHttpClientWithProxySettings(setting.Proxy, setting)
	if err != nil {
		return 0, 0, err
	}
	var status struct {
		Data struct {
			QuotaPerUnit float64 `json:"quota_per_unit"`
		} `json:"data"`
	}
	if err := fetchBeaconUpstreamJSON(ctx, client, baseURL+beaconUpstreamStatusPath, "", &status); err != nil {
		return 0, 0, fmt.Errorf("upstream status: %w", err)
	}
	quotaPerUnit := int64(status.Data.QuotaPerUnit)
	if quotaPerUnit <= 0 || float64(quotaPerUnit) != status.Data.QuotaPerUnit {
		return 0, 0, fmt.Errorf("upstream did not report a whole quota_per_unit")
	}
	fetched, inserted := 0, 0
	now := time.Now().Unix()
	for _, key := range channel.GetKeys() {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		var response struct {
			Success bool   `json:"success"`
			Message string `json:"message"`
			Data    []struct {
				ID               int64  `json:"id"`
				CreatedAt        int64  `json:"created_at"`
				Type             int    `json:"type"`
				ModelName        string `json:"model_name"`
				Quota            int64  `json:"quota"`
				PromptTokens     int    `json:"prompt_tokens"`
				CompletionTokens int    `json:"completion_tokens"`
				Group            string `json:"group"`
				RequestID        string `json:"request_id"`
				Other            string `json:"other"`
			} `json:"data"`
		}
		if err := fetchBeaconUpstreamJSON(ctx, client, baseURL+beaconUpstreamLogPath, key, &response); err != nil {
			return fetched, inserted, fmt.Errorf("upstream log: %w", err)
		}
		if !response.Success {
			return fetched, inserted, fmt.Errorf("upstream log query failed: %s", strings.ToValidUTF8(response.Message[:min(len(response.Message), 200)], ""))
		}
		records := make([]model.BeaconUpstreamRecord, 0, len(response.Data))
		for _, entry := range response.Data {
			if entry.Type != beaconUpstreamConsumeType {
				continue
			}
			record := model.BeaconUpstreamRecord{
				LogID: entry.ID, RequestID: entry.RequestID, OccurredAt: entry.CreatedAt,
				ModelName: entry.ModelName, Group: entry.Group,
				PromptTokens: entry.PromptTokens, CompletionTokens: entry.CompletionTokens, Quota: entry.Quota,
			}
			var other struct {
				GroupRatio          *float64 `json:"group_ratio"`
				BillingMode         string   `json:"billing_mode"`
				ExprB64             string   `json:"expr_b64"`
				ModelRatio          float64  `json:"model_ratio"`
				CompletionRatio     float64  `json:"completion_ratio"`
				CacheRatio          float64  `json:"cache_ratio"`
				CacheCreationRatio  float64  `json:"cache_creation_ratio"`
				ModelPrice          float64  `json:"model_price"`
				CacheTokens         int      `json:"cache_tokens"`
				CacheCreationTokens int      `json:"cache_creation_tokens"`
			}
			if entry.Other != "" && common.UnmarshalJsonStr(entry.Other, &other) == nil {
				record.CacheTokens, record.CacheCreationTokens = other.CacheTokens, other.CacheCreationTokens
				record.Pricing = model.BeaconUpstreamPricing{
					BillingMode: other.BillingMode, ModelRatio: other.ModelRatio, CompletionRatio: other.CompletionRatio,
					CacheRatio: other.CacheRatio, CacheCreationRatio: other.CacheCreationRatio, ModelPrice: other.ModelPrice,
				}
				if other.GroupRatio != nil {
					record.GroupRatio = strconv.FormatFloat(*other.GroupRatio, 'f', -1, 64)
					record.Pricing.GroupRatio, record.Pricing.HasGroupRatio = *other.GroupRatio, true
				}
				if len(other.ExprB64) <= beaconUpstreamExprLimit {
					if decoded, err := base64.StdEncoding.DecodeString(other.ExprB64); err == nil {
						record.Pricing.Expr = string(decoded)
					}
				}
			}
			records = append(records, record)
		}
		fetched += len(records)
		sum := sha256.Sum256([]byte(key))
		count, err := model.StoreBeaconUpstreamCharges(channelID, hex.EncodeToString(sum[:])[:16], quotaPerUnit, records, now)
		inserted += count
		if err != nil {
			return fetched, inserted, err
		}
	}
	return fetched, inserted, nil
}

func fetchBeaconUpstreamJSON(ctx context.Context, client *http.Client, url, key string, target any) error {
	ctx, cancel := context.WithTimeout(ctx, beaconUpstreamTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("status code %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, beaconUpstreamBodyLimit+1))
	if err != nil {
		return err
	}
	if len(body) > beaconUpstreamBodyLimit {
		return fmt.Errorf("response too large")
	}
	if err := common.Unmarshal(body, target); err != nil {
		return fmt.Errorf("unexpected response format")
	}
	return nil
}
