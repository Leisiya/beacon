package model

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func setupBeaconLedgerTest(t *testing.T) (User, User) {
	t.Helper()
	previousDB := DB
	previousRedis, previousBatch := common.RedisEnabled, common.BatchUpdateEnabled
	previousType := common.MainDatabaseType()
	driver := os.Getenv("BEACON_LEDGER_TEST_DRIVER")
	var dialector gorm.Dialector
	databaseType := common.DatabaseTypeSQLite
	switch driver {
	case "", "sqlite":
		dialector = sqlite.Open(filepath.Join(t.TempDir(), "ledger.db") + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	case "mysql":
		require.NotEmpty(t, os.Getenv("BEACON_LEDGER_TEST_DSN"), "use a dedicated disposable test database")
		dialector = mysqlMigrationDialector{mysql.Dialector{Config: &mysql.Config{DSN: os.Getenv("BEACON_LEDGER_TEST_DSN")}}}
		databaseType = common.DatabaseTypeMySQL
	case "postgres":
		require.NotEmpty(t, os.Getenv("BEACON_LEDGER_TEST_DSN"), "use a dedicated disposable test database")
		dialector = postgresMigrationDialector{postgres.Dialector{Config: &postgres.Config{DSN: os.Getenv("BEACON_LEDGER_TEST_DSN"), PreferSimpleProtocol: true}}}
		databaseType = common.DatabaseTypePostgreSQL
	default:
		t.Fatalf("unsupported ledger test driver %q", driver)
	}
	// Random table namespaces keep integration fixtures isolated from all
	// pre-existing data, even if the supplied database contains other tables.
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), NamingStrategy: schema.NamingStrategy{TablePrefix: "bct_" + uuid.NewString()[:8] + "_"}}
	db, err := gorm.Open(dialector, config)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	if databaseType != common.DatabaseTypeSQLite {
		sqlDB.SetMaxOpenConns(4)
	}
	DB = db
	common.SetMainDatabaseType(databaseType)
	common.RedisEnabled, common.BatchUpdateEnabled = false, false
	t.Cleanup(func() {
		if databaseType != common.DatabaseTypeSQLite {
			require.NoError(t, db.Migrator().DropTable(&BeaconLedgerEntry{}, &User{}))
		}
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled, common.BatchUpdateEnabled = previousRedis, previousBatch
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, DB.AutoMigrate(&User{}, &BeaconLedgerEntry{}))
	operator := User{Username: "ledger-root", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AffCode: "ledger-root", AuthVersion: 1}
	user := User{Username: "ledger-customer", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "ledger-customer", AuthVersion: 1}
	require.NoError(t, DB.Create(&operator).Error)
	require.NoError(t, DB.Create(&user).Error)
	return operator, user
}

func beaconReceiptInput(userID int, key string) BeaconLedgerInput {
	return BeaconLedgerInput{
		IdempotencyKey: key, Kind: BeaconReceipt, UserID: userID,
		Amount: "10.05", Currency: "USD", CNYPerUnit: "7.12345", FXSource: "test-confirmed transaction rate",
		Quota: 500, PaymentMethod: "bank", PaymentReference: key,
		OccurredAt: 1792857600, Note: "local test receipt; no real funds",
	}
}

func TestBeaconMoneySnapshot(t *testing.T) {
	for _, tc := range []struct {
		name, amount, currency, rate, source string
		original, cny                        int64
		valid                                bool
	}{
		{"exact CNY", "0.29", "CNY", "1", "same currency", 29, 29, true},
		{"USD snapshot", "10.05", "USD", "7.12345", "receipt FX", 1005, 7159, true},
		{"half cent rounds up", "0.01", "USD", "1.5", "receipt FX", 1, 2, true},
		{"zero", "0", "CNY", "1", "same currency", 0, 0, false},
		{"negative", "-1", "CNY", "1", "same currency", 0, 0, false},
		{"too many decimals", "0.001", "USD", "7", "receipt FX", 0, 0, false},
		{"exponent", "1e9", "CNY", "1", "same currency", 0, 0, false},
		{"NaN", "NaN", "CNY", "1", "same currency", 0, 0, false},
		{"FX exponent", "1", "USD", "1e8", "receipt FX", 0, 0, false},
		{"zero FX", "1", "USD", "0", "receipt FX", 0, 0, false},
		{"missing source", "1", "USD", "7", "", 0, 0, false},
		{"unknown currency", "1", "XYZ", "1", "receipt FX", 0, 0, false},
		{"unsupported precision", "1", "JPY", "0.05", "receipt FX", 0, 0, false},
		{"CNY is not revalued", "1", "CNY", "7", "receipt FX", 0, 0, false},
		{"original overflow", "99999999999999.99", "CNY", "1", "same currency", 0, 0, false},
		{"converted overflow", "90071992547409.91", "USD", "2", "receipt FX", 0, 0, false},
		{"sub-cent conversion", "0.01", "HKD", "0.01", "receipt FX", 0, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			original, cny, _, err := beaconMoneySnapshot(tc.amount, tc.currency, tc.rate, tc.source)
			if !tc.valid {
				require.ErrorIs(t, err, ErrBeaconLedgerInput)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.original, original)
			assert.Equal(t, tc.cny, cny)
		})
	}
}

func TestBeaconLedgerIdempotencyAndPaymentIdentity(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	input := beaconReceiptInput(user.Id, "receipt-request-0001")
	entry, created, err := PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	assert.True(t, created)
	assert.Equal(t, int64(1005), entry.OriginalAmountMinor)
	assert.Equal(t, int64(7159), entry.CNYAmountMinor)
	assert.Equal(t, "7.12345", entry.CNYPerUnit)
	assert.Equal(t, 500, getUserQuotaFromDB(t, user.Id))

	input.Amount, input.CNYPerUnit = "10.05", "7.12345000"
	replayed, created, err := PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, entry.ID, replayed.ID)
	input.Quota++
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconLedgerConflict)
	input.Quota--
	input.IdempotencyKey = "receipt-request-0002"
	input.PaymentReference = " RECEIPT-REQUEST-0001 "
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconDuplicatePayment)
	assert.Equal(t, 500, getUserQuotaFromDB(t, user.Id))
	var count int64
	require.NoError(t, DB.Model(&BeaconLedgerEntry{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestBeaconLedgerCorrections(t *testing.T) {
	for _, kind := range []string{BeaconRefund, BeaconReversal} {
		t.Run(kind, func(t *testing.T) {
			operator, user := setupBeaconLedgerTest(t)
			original, _, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "correction-source-01"), operator.Id)
			require.NoError(t, err)
			input := BeaconLedgerInput{IdempotencyKey: "correction-request-01", Kind: kind, CorrectsID: original.ID, OccurredAt: 1792857700, Note: "confirmed correction"}
			if kind == BeaconRefund {
				input.PaymentMethod, input.PaymentReference = "bank", "actual-refund-ref-01"
				input.CNYPerUnit, input.FXSource = "7.2", "refund transaction FX"
			}
			correction, created, err := PostBeaconLedgerEntry(input, operator.Id)
			require.NoError(t, err)
			assert.True(t, created)
			assert.Equal(t, -500, correction.QuotaDelta)
			assert.Equal(t, int64(-1005), correction.OriginalAmountMinor)
			assert.Equal(t, 0, getUserQuotaFromDB(t, user.Id))
			if kind == BeaconRefund {
				assert.Equal(t, int64(-7236), correction.CNYAmountMinor)
				assert.Equal(t, "refund transaction FX", correction.FXSource)
			} else {
				assert.Equal(t, -original.CNYAmountMinor, correction.CNYAmountMinor)
				assert.Equal(t, original.FXSource, correction.FXSource)
			}
			_, created, err = PostBeaconLedgerEntry(input, operator.Id)
			require.NoError(t, err)
			assert.False(t, created)
			input.IdempotencyKey = "correction-request-02"
			input.PaymentReference += "-different"
			if kind == BeaconReversal {
				input.PaymentReference = ""
			}
			_, _, err = PostBeaconLedgerEntry(input, operator.Id)
			require.ErrorIs(t, err, ErrBeaconAlreadyCorrected)
			var unchanged BeaconLedgerEntry
			require.NoError(t, DB.First(&unchanged, original.ID).Error)
			assert.Equal(t, *original, unchanged)
			input.CorrectsID = correction.ID
			_, _, err = PostBeaconLedgerEntry(input, operator.Id)
			require.ErrorIs(t, err, ErrBeaconLedgerInput)
		})
	}
}

func TestBeaconLedgerGiftAndFailedCorrection(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	input := BeaconLedgerInput{IdempotencyKey: "gift-request-00001", Kind: BeaconGift, UserID: user.Id, Quota: 100, OccurredAt: 1792857600, Note: "free test quota"}
	gift, _, err := PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	assert.Zero(t, gift.OriginalAmountMinor)
	assert.Zero(t, gift.CNYAmountMinor)
	assert.Nil(t, gift.PaymentIdentity)
	_, _, err = PostBeaconLedgerEntry(BeaconLedgerInput{
		IdempotencyKey: "gift-cash-refund-01", Kind: BeaconRefund, CorrectsID: gift.ID,
		PaymentMethod: "bank", PaymentReference: "gift-is-not-cash", CNYPerUnit: "1", FXSource: "test",
		OccurredAt: 1792857700, Note: "must reject refund of free quota",
	}, operator.Id)
	require.ErrorIs(t, err, ErrBeaconLedgerInput)
	reserved, err := TryReserveUserQuota(user.Id, 60)
	require.NoError(t, err)
	require.True(t, reserved)
	correction := BeaconLedgerInput{IdempotencyKey: "gift-reversal-0001", Kind: BeaconReversal, CorrectsID: gift.ID, OccurredAt: 1792857700, Note: "wrong grant"}
	_, _, err = PostBeaconLedgerEntry(correction, operator.Id)
	require.ErrorIs(t, err, ErrBeaconInsufficientQuota)
	assert.Equal(t, 40, getUserQuotaFromDB(t, user.Id))
	var count int64
	require.NoError(t, DB.Model(&BeaconLedgerEntry{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	// A failed posting does not consume the request key or correction slot.
	input.IdempotencyKey, input.Quota = "gift-request-00002", 60
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	_, _, err = PostBeaconLedgerEntry(correction, operator.Id)
	require.NoError(t, err)
	assert.Zero(t, getUserQuotaFromDB(t, user.Id))
}

func TestBeaconLedgerRejectsUnsafeInputsAndRollsBack(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*BeaconLedgerInput, *User, *User)
		err    error
	}{
		{"zero quota", func(i *BeaconLedgerInput, _, _ *User) { i.Quota = 0 }, ErrBeaconLedgerInput},
		{"negative quota", func(i *BeaconLedgerInput, _, _ *User) { i.Quota = math.MinInt }, ErrBeaconLedgerInput},
		{"huge quota", func(i *BeaconLedgerInput, _, _ *User) { i.Quota = math.MaxInt }, ErrBeaconLedgerInput},
		{"short request key", func(i *BeaconLedgerInput, _, _ *User) { i.IdempotencyKey = "short" }, ErrBeaconLedgerInput},
		{"missing reason", func(i *BeaconLedgerInput, _, _ *User) { i.Note = " " }, ErrBeaconLedgerInput},
		{"NUL in reason", func(i *BeaconLedgerInput, _, _ *User) { i.Note = "invalid\x00note" }, ErrBeaconLedgerInput},
		{"future time", func(i *BeaconLedgerInput, _, _ *User) { i.OccurredAt = math.MaxInt64 }, ErrBeaconLedgerInput},
		{"missing user", func(i *BeaconLedgerInput, _, _ *User) { i.UserID = 999999 }, gorm.ErrRecordNotFound},
		{"wallet ceiling", func(_ *BeaconLedgerInput, _, u *User) { u.Quota = common.MaxWalletQuota - 1 }, ErrWalletQuotaLimitExceeded},
		{"disabled customer", func(_ *BeaconLedgerInput, _, u *User) { u.Status = common.UserStatusDisabled }, ErrBeaconLedgerInput},
		{"ordinary admin", func(_ *BeaconLedgerInput, o, _ *User) { o.Role = common.RoleAdminUser }, ErrBeaconLedgerActor},
		{"disabled root", func(_ *BeaconLedgerInput, o, _ *User) { o.Status = common.UserStatusDisabled }, ErrBeaconLedgerActor},
	} {
		t.Run(tc.name, func(t *testing.T) {
			operator, user := setupBeaconLedgerTest(t)
			input := beaconReceiptInput(user.Id, "invalid-request-0001")
			tc.change(&input, &operator, &user)
			require.NoError(t, DB.Save(&operator).Error)
			require.NoError(t, DB.Save(&user).Error)
			_, created, err := PostBeaconLedgerEntry(input, operator.Id)
			require.ErrorIs(t, err, tc.err)
			assert.False(t, created)
			assert.Equal(t, user.Quota, getUserQuotaFromDB(t, user.Id))
			var count int64
			require.NoError(t, DB.Model(&BeaconLedgerEntry{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestBeaconLedgerConcurrentDuplicateAndQuotaLimit(t *testing.T) {
	for _, duplicate := range []bool{true, false} {
		t.Run(fmt.Sprintf("duplicate=%t", duplicate), func(t *testing.T) {
			operator, user := setupBeaconLedgerTest(t)
			require.NoError(t, DB.Model(&user).Update("quota", common.MaxWalletQuota-500).Error)
			inputs := []BeaconLedgerInput{beaconReceiptInput(user.Id, "concurrent-post-001"), beaconReceiptInput(user.Id, "concurrent-post-002")}
			if duplicate {
				inputs[1] = inputs[0]
			}
			operators := []int{operator.Id, operator.Id}
			if !duplicate {
				second := User{Username: "ledger-root-2", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AffCode: "ledger-root-2", AuthVersion: 1}
				require.NoError(t, DB.Create(&second).Error)
				operators[1] = second.Id
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			var wg sync.WaitGroup
			for index, input := range inputs {
				wg.Go(func() {
					<-start
					_, _, err := PostBeaconLedgerEntry(input, operators[index])
					results <- err
				})
			}
			close(start)
			wg.Wait()
			close(results)
			failed := 0
			for err := range results {
				if err != nil {
					assert.ErrorIs(t, err, ErrWalletQuotaLimitExceeded)
					failed++
				}
			}
			if duplicate {
				assert.Zero(t, failed)
			} else {
				assert.Equal(t, 1, failed)
			}
			assert.Equal(t, common.MaxWalletQuota, getUserQuotaFromDB(t, user.Id))
			var count int64
			require.NoError(t, DB.Model(&BeaconLedgerEntry{}).Count(&count).Error)
			assert.Equal(t, int64(1), count)
		})
	}
}

func TestBeaconLedgerMigrationPreservesExistingData(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	// Recreate just the new table to simulate adding it to a populated database.
	require.NoError(t, DB.Migrator().DropTable(&BeaconLedgerEntry{}))
	require.NoError(t, DB.Model(&user).Update("quota", 73).Error)
	require.NoError(t, DB.AutoMigrate(&BeaconLedgerEntry{}))
	original, _, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "migration-receipt-01"), operator.Id)
	require.NoError(t, err)
	for range 2 {
		require.NoError(t, DB.AutoMigrate(&BeaconLedgerEntry{}))
	}
	var stored BeaconLedgerEntry
	require.NoError(t, DB.First(&stored, original.ID).Error)
	assert.Equal(t, *original, stored)
	assert.Equal(t, 573, getUserQuotaFromDB(t, user.Id))
	_, created, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "migration-receipt-01"), operator.Id)
	require.NoError(t, err)
	assert.False(t, created)
	input := beaconReceiptInput(user.Id, "migration-receipt-02")
	input.PaymentReference = "migration-receipt-01"
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconDuplicatePayment)
	var version string
	versionQuery := "select version()"
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		versionQuery = "select sqlite_version()"
	}
	require.NoError(t, DB.Raw(versionQuery).Scan(&version).Error)
	t.Logf("%s %s: new table and populated database, repeated migration, data and payment uniqueness preserved", common.MainDatabaseType(), version)
}

func TestBeaconLedgerCursorAndCorrectionVisibility(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	first, _, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "page-receipt-00001"), operator.Id)
	require.NoError(t, err)
	second, _, err := PostBeaconLedgerEntry(beaconReceiptInput(operator.Id, "page-receipt-00002"), operator.Id)
	require.NoError(t, err)
	page, err := ListBeaconLedgerEntries(0, 0, 1)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, second.ID, page.Items[0].ID)
	assert.Equal(t, second.ID, page.NextBefore)
	correction, _, err := PostBeaconLedgerEntry(BeaconLedgerInput{IdempotencyKey: "page-correction-01", Kind: BeaconReversal, CorrectsID: first.ID, OccurredAt: common.GetTimestamp(), Note: "test correction"}, operator.Id)
	require.NoError(t, err)
	older, err := ListBeaconLedgerEntries(0, page.NextBefore, 1)
	require.NoError(t, err)
	require.Len(t, older.Items, 1)
	assert.Equal(t, first.ID, older.Items[0].ID)
	require.NotNil(t, older.Items[0].CorrectionID)
	assert.Equal(t, correction.ID, *older.Items[0].CorrectionID)
	assert.Zero(t, older.NextBefore)
	filtered, err := ListBeaconLedgerEntries(operator.Id, 0, 25)
	require.NoError(t, err)
	require.Len(t, filtered.Items, 1)
	assert.Equal(t, second.ID, filtered.Items[0].ID)
	_, err = ListBeaconLedgerEntries(0, 0, 101)
	require.ErrorIs(t, err, ErrBeaconLedgerInput)
	_, err = ListBeaconLedgerEntries(-1, 0, 25)
	require.ErrorIs(t, err, ErrBeaconLedgerInput)
}

func TestBeaconLedgerSQLiteContendingTransactions(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	if !common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		t.Skip("SQLite snapshot write-contention regression")
	}
	sqlDB, err := DB.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(4)
	// Force both transactions past the missing-key lookup before either
	// inserts, exercising distinct connections and SQLite's stale snapshot.
	var arrivals sync.WaitGroup
	arrivals.Add(2)
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register("beacon_insert_barrier", func(tx *gorm.DB) {
		if tx.Statement.Schema.Name == "BeaconLedgerEntry" {
			arrivals.Done()
			arrivals.Wait()
		}
	}))
	t.Cleanup(func() { DB.Callback().Create().Remove("beacon_insert_barrier") })
	input := beaconReceiptInput(user.Id, "contending-receipt-01")
	results := make(chan error, 2)
	var callers sync.WaitGroup
	for range 2 {
		callers.Go(func() {
			_, _, err := PostBeaconLedgerEntry(input, operator.Id)
			results <- err
		})
	}
	callers.Wait()
	close(results)
	require.NoError(t, DB.Callback().Create().Remove("beacon_insert_barrier"))
	succeeded := 0
	for err := range results {
		if err == nil {
			succeeded++
		} else {
			assert.Contains(t, err.Error(), "SQLITE_BUSY")
		}
	}
	assert.GreaterOrEqual(t, succeeded, 1)
	// A busy client retries its original command, not a freshly generated key.
	_, created, err := PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, 500, getUserQuotaFromDB(t, user.Id))
	var count int64
	require.NoError(t, DB.Model(&BeaconLedgerEntry{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestBeaconLedgerRejectsUnsupportedModesAndRevokedActor(t *testing.T) {
	operator, user := setupBeaconLedgerTest(t)
	input := beaconReceiptInput(user.Id, "mode-test-receipt-01")
	_, _, err := PostBeaconLedgerEntry(input, 0)
	require.ErrorIs(t, err, ErrBeaconLedgerActor)
	common.RedisEnabled = true
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconLedgerMode)
	common.RedisEnabled, common.BatchUpdateEnabled = false, true
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconLedgerMode)
	common.BatchUpdateEnabled = false
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&operator).Update("role", common.RoleCommonUser).Error)
	_, _, err = PostBeaconLedgerEntry(input, operator.Id)
	require.ErrorIs(t, err, ErrBeaconLedgerActor)
	assert.Equal(t, 500, getUserQuotaFromDB(t, user.Id))
}

// Run with the verified, pinned release binary and a fresh disposable upgrade
// DSN. This verifies real release-created schemas, rather than approximating
// an upgrade by merely constructing the current Go model in a test fixture.
func TestBeaconLedgerReleasedDatabaseUpgrade(t *testing.T) {
	binary := os.Getenv("BEACON_LEDGER_RELEASE_BINARY")
	if binary == "" {
		t.Skip("set BEACON_LEDGER_RELEASE_BINARY for the release upgrade matrix")
	}
	directory := t.TempDir()
	dsn := os.Getenv("BEACON_LEDGER_UPGRADE_DSN")
	driver := os.Getenv("BEACON_LEDGER_TEST_DRIVER")
	sqlitePath := filepath.Join(directory, "release.db")
	var dialector gorm.Dialector
	databaseType := common.DatabaseTypeSQLite
	switch driver {
	case "", "sqlite":
		require.Empty(t, dsn, "SQLite release fixture must use its temporary path")
		dialector = sqlite.Open(sqlitePath)
	case "mysql":
		require.NotEmpty(t, dsn, "supply a fresh disposable upgrade database")
		dialector = mysqlMigrationDialector{mysql.Dialector{Config: &mysql.Config{DSN: dsn}}}
		databaseType = common.DatabaseTypeMySQL
	case "postgres":
		require.NotEmpty(t, dsn, "supply a fresh disposable upgrade database")
		dialector = postgresMigrationDialector{postgres.Dialector{Config: &postgres.Config{DSN: dsn, PreferSimpleProtocol: true}}}
		databaseType = common.DatabaseTypePostgreSQL
	default:
		t.Fatalf("unsupported upgrade driver %q", driver)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "--port", "-1", "--log-dir", filepath.Join(directory, "logs"))
	command.Dir = directory
	command.Env = []string{
		"PATH=/usr/bin:/bin", "LANG=C", "TMPDIR=" + os.TempDir(),
		"SQL_DSN=" + dsn, "SQLITE_PATH=" + sqlitePath,
		"SESSION_SECRET=beacon-upgrade-local-fixture-only",
	}
	output, exitErr := command.CombinedOutput()
	require.NoError(t, ctx.Err(), "release fixture timed out")
	// The invalid port lets initialization finish without ever opening an
	// HTTP listener. Do not print release logs, which can contain credentials.
	require.Error(t, exitErr)
	require.True(t, strings.Contains(string(output), "invalid port"), "release fixture failed before the disabled-listener stage")
	db, err := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(databaseType)
	initCol()
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		require.NoError(t, sqlDB.Close())
	})
	require.True(t, DB.Migrator().HasTable(&User{}))
	require.True(t, DB.Migrator().HasTable(&TopUp{}))
	require.False(t, DB.Migrator().HasTable(&BeaconLedgerEntry{}), "upgrade DSN must be fresh")
	operator := User{Username: "upgrade-root", Password: "unused", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AffCode: "upgrade-root", AuthVersion: 1}
	user := User{Username: "upgrade-customer", Password: "unused", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "upgrade-customer", AuthVersion: 1, Quota: 73}
	require.NoError(t, DB.Create(&operator).Error)
	require.NoError(t, DB.Create(&user).Error)
	legacy := TopUp{UserId: user.Id, TradeNo: "beacon-upgrade-legacy", Amount: 20, Money: 10, PaymentMethod: "test", Status: common.TopUpStatusSuccess}
	require.NoError(t, DB.Create(&legacy).Error)
	beforeIndexes, err := DB.Migrator().GetIndexes(&User{})
	require.NoError(t, err)
	for range 2 {
		require.NoError(t, migrateDB())
	}
	assert.Equal(t, 73, getUserQuotaFromDB(t, user.Id))
	var legacyAfter TopUp
	require.NoError(t, DB.First(&legacyAfter, legacy.Id).Error)
	assert.Equal(t, legacy, legacyAfter)
	for _, index := range beforeIndexes {
		assert.True(t, DB.Migrator().HasIndex(&User{}, index.Name()), "existing user index %s was lost", index.Name())
	}
	duplicateLegacy := legacy
	duplicateLegacy.Id = 0
	require.Error(t, DB.Create(&duplicateLegacy).Error, "legacy top-up reference must remain unique")
	entry, _, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "release-upgrade-0001"), operator.Id)
	require.NoError(t, err)
	require.NoError(t, migrateDB())
	replayed, created, err := PostBeaconLedgerEntry(beaconReceiptInput(user.Id, "release-upgrade-0001"), operator.Id)
	require.NoError(t, err)
	assert.False(t, created)
	assert.Equal(t, entry.ID, replayed.ID)
	assert.Equal(t, 573, getUserQuotaFromDB(t, user.Id))
	t.Logf("%s: pinned v1.0.0-rc.46 schema, existing user/top-up preserved, full startup migration repeated, new posting replay safe", databaseType)
}
