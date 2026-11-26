package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBeaconExpenseAuditNamesTheActionAndAmount(t *testing.T) {
	_, identity, _ := setupAdminUserTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.BeaconExpense{}))
	occurredAt := time.Now().Unix()

	expense := adminUserRequest(http.MethodPost, "/api/beacon/finance/expenses",
		fmt.Sprintf(`{"request_key":"audit-expense-0001","category":"server","amount":"30","occurred_at":%d,"note":"VPS"}`, occurredAt),
		"", identity, common.RoleRootUser, nil, PostBeaconExpense)
	require.Equal(t, http.StatusOK, expense.Code, expense.Body.String())
	reversal := adminUserRequest(http.MethodPost, "/api/beacon/finance/expenses",
		fmt.Sprintf(`{"request_key":"audit-expense-0002","corrects_id":1,"occurred_at":%d,"note":"duplicate"}`, occurredAt),
		"", identity, common.RoleRootUser, nil, PostBeaconExpense)
	require.Equal(t, http.StatusOK, reversal.Code, reversal.Body.String())

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action LIKE ?", "beacon.%").Order("id").Find(&audits).Error)
	require.Len(t, audits, 2)
	assert.Equal(t, "beacon.finance.expense", audits[0].Action)
	assert.Equal(t, "Recorded a server expense of ¥30.00 (expense #1)", audits[0].Content)
	assert.Equal(t, json.RawMessage(`"30.00"`), audits[0].Other.Op.Params["amount"])
	assert.Equal(t, "beacon.finance.expense_reversal", audits[1].Action)
	assert.Equal(t, "Reversed expense #1 of ¥30.00", audits[1].Content)
	assert.Equal(t, json.RawMessage(`"30.00"`), audits[1].Other.Op.Params["amount"], "a reversal shows the amount it cancels, not a negative one")
}
