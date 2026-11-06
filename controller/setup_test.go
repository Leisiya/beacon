package controller

import (
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupFreshSetupTest(t *testing.T) {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	previousDB, previousType := model.DB, common.MainDatabaseType()
	previousSetup := constant.IsSetupComplete()
	previousSelf, previousDemo := operation_setting.SelfUseModeEnabled, operation_setting.DemoSiteEnabled
	common.OptionMapRWMutex.Lock()
	previousOptions := maps.Clone(common.OptionMap)
	common.OptionMap = map[string]string{"SelfUseModeEnabled": "false", "DemoSiteEnabled": "false"}
	common.OptionMapRWMutex.Unlock()
	kind := os.Getenv("TEST_SECURITY_DIALECT")
	if kind == "" {
		kind = "sqlite"
	}
	db, _ := newAuditTestDatabase(t, kind, os.Getenv("TEST_"+strings.ToUpper(kind)+"_DSN"))
	db.Logger = logger.Default.LogMode(logger.Silent)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.Setup{}, &model.BeaconLedgerEntry{}, &model.Token{}))
	model.DB = db
	switch kind {
	case "sqlite":
		common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	case "mysql":
		common.SetMainDatabaseType(common.DatabaseTypeMySQL)
	case "postgres":
		common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	}
	constant.SetSetupComplete(false)
	operation_setting.SelfUseModeEnabled, operation_setting.DemoSiteEnabled = false, false
	require.NoError(t, db.Create(&model.Option{Key: "SelfUseModeEnabled", Value: "false"}).Error)
	require.NoError(t, db.Create(&model.Option{Key: "DemoSiteEnabled", Value: "false"}).Error)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		constant.SetSetupComplete(previousSetup)
		operation_setting.SelfUseModeEnabled, operation_setting.DemoSiteEnabled = previousSelf, previousDemo
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		require.NoError(t, sqlDB.Close())
	})
}

func freshSetupRequest(t *testing.T, input string) bool {
	t.Helper()
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/setup", strings.NewReader(input))
	c.Request.Header.Set("Content-Type", "application/json")
	PostSetup(c)
	var body struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &body))
	assert.NotContains(t, response.Body.String(), "synthetic-setup-password")
	assert.NotContains(t, response.Body.String(), "$argon2")
	return body.Success
}

const freshSetupBody = `{"username":"beaconroot","password":"synthetic-setup-password","confirmPassword":"synthetic-setup-password","SelfUseModeEnabled":true,"DemoSiteEnabled":true,"quota":100000000,"role":1,"beacon_funding_mode":1}`

func TestBeaconFreshSetupZeroBalanceAndReplay(t *testing.T) {
	setupFreshSetupTest(t)
	require.True(t, freshSetupRequest(t, freshSetupBody))
	require.True(t, constant.IsSetupComplete())
	var user model.User
	require.NoError(t, model.DB.First(&user).Error)
	assert.Equal(t, common.RoleRootUser, user.Role)
	assert.Equal(t, common.UserStatusEnabled, user.Status)
	assert.Zero(t, user.Quota)
	assert.Zero(t, user.UsedQuota)
	assert.Nil(t, user.AccessToken)
	assert.NotEqual(t, "synthetic-setup-password", user.Password)
	assert.True(t, common.ValidatePasswordAndHash("synthetic-setup-password", user.Password))
	assert.True(t, operation_setting.SelfUseModeEnabled)
	assert.True(t, operation_setting.DemoSiteEnabled)
	for _, table := range []any{&model.BeaconLedgerEntry{}, &model.Token{}} {
		var count int64
		require.NoError(t, model.DB.Model(table).Count(&count).Error)
		assert.Zero(t, count)
	}
	// An existing test wallet must never be reset by a repeated setup request,
	// even if a process has stale in-memory initialization state.
	require.NoError(t, model.DB.Model(&user).Update("quota", 321).Error)
	constant.SetSetupComplete(false)
	assert.False(t, freshSetupRequest(t, freshSetupBody))
	var unchanged model.User
	require.NoError(t, model.DB.First(&unchanged, user.Id).Error)
	assert.Equal(t, 321, unchanged.Quota)
	assert.Equal(t, user.Password, unchanged.Password)
	model.CheckSetup()
	assert.True(t, constant.IsSetupComplete())
	var count int64
	require.NoError(t, model.DB.Model(&model.User{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestBeaconFreshSetupRollsBackAllState(t *testing.T) {
	for _, failAt := range []string{"Setup", "User", "Option"} {
		t.Run(failAt, func(t *testing.T) {
			setupFreshSetupTest(t)
			failure := errors.New("synthetic setup write failure")
			const callback = "beacon_setup_failure"
			inject := func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Name == failAt {
					if option, ok := tx.Statement.Model.(*model.Option); ok && option.Key != "DemoSiteEnabled" {
						return
					}
					tx.AddError(failure)
				}
			}
			require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register(callback, inject))
			require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register(callback, inject))
			t.Cleanup(func() { model.DB.Callback().Create().Remove(callback); model.DB.Callback().Update().Remove(callback) })
			assert.False(t, freshSetupRequest(t, freshSetupBody))
			assert.False(t, constant.IsSetupComplete())
			assert.False(t, operation_setting.SelfUseModeEnabled)
			assert.False(t, operation_setting.DemoSiteEnabled)
			for _, table := range []any{&model.Setup{}, &model.User{}, &model.BeaconLedgerEntry{}} {
				var count int64
				require.NoError(t, model.DB.Model(table).Count(&count).Error)
				assert.Zero(t, count, "failed initialization must leave no partial account or completion marker")
			}
			var options []model.Option
			require.NoError(t, model.DB.Find(&options).Error)
			for _, option := range options {
				assert.Equal(t, "false", option.Value)
			}
			common.OptionMapRWMutex.RLock()
			assert.Equal(t, "false", common.OptionMap["SelfUseModeEnabled"])
			assert.Equal(t, "false", common.OptionMap["DemoSiteEnabled"])
			common.OptionMapRWMutex.RUnlock()
			require.NoError(t, model.DB.Callback().Create().Remove(callback))
			require.NoError(t, model.DB.Callback().Update().Remove(callback))
			assert.True(t, freshSetupRequest(t, freshSetupBody), "same request can succeed after storage recovers")
		})
	}
}

func TestBeaconFreshSetupRejectsExistingAccountsAndInvalidInput(t *testing.T) {
	setupFreshSetupTest(t)
	for _, body := range []string{
		`{`, `{}`, strings.ReplaceAll(freshSetupBody, "beaconroot", ""),
		strings.ReplaceAll(freshSetupBody, "synthetic-setup-password", "short"),
		strings.Replace(freshSetupBody, `"confirmPassword":"synthetic-setup-password"`, `"confirmPassword":"different"`, 1),
	} {
		assert.False(t, freshSetupRequest(t, body))
	}
	existing := model.User{Username: "existing", Password: "untouched-test-hash", Quota: 27, Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(&existing).Error)
	assert.False(t, freshSetupRequest(t, freshSetupBody), "an uninitialized marker must not authorize taking over an existing database")
	var users []model.User
	require.NoError(t, model.DB.Find(&users).Error)
	require.Len(t, users, 1)
	assert.Equal(t, existing, users[0])
	var count int64
	require.NoError(t, model.DB.Model(&model.Setup{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestBeaconFreshSetupConcurrentRequests(t *testing.T) {
	setupFreshSetupTest(t)
	start := make(chan struct{})
	results := make(chan bool, 2)
	var group sync.WaitGroup
	for range 2 {
		group.Go(func() { <-start; results <- freshSetupRequest(t, freshSetupBody) })
	}
	close(start)
	group.Wait()
	close(results)
	succeeded := 0
	for ok := range results {
		if ok {
			succeeded++
		}
	}
	assert.Equal(t, 1, succeeded)
	for _, table := range []any{&model.User{}, &model.Setup{}} {
		var count int64
		require.NoError(t, model.DB.Model(table).Count(&count).Error)
		assert.Equal(t, int64(1), count)
	}
}
