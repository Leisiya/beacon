package controller

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type Setup struct {
	Status       bool   `json:"status"`
	RootInit     bool   `json:"root_init"`
	DatabaseType string `json:"database_type"`
}

type SetupRequest struct {
	Username           string `json:"username"`
	Password           string `json:"password"`
	ConfirmPassword    string `json:"confirmPassword"`
	SelfUseModeEnabled bool   `json:"SelfUseModeEnabled"`
	DemoSiteEnabled    bool   `json:"DemoSiteEnabled"`
}

func GetSetup(c *gin.Context) {
	setup := Setup{
		Status: constant.IsSetupComplete(),
	}
	if constant.IsSetupComplete() {
		c.JSON(200, gin.H{
			"success": true,
			"data":    setup,
		})
		return
	}
	setup.RootInit = model.RootUserExists()
	setup.DatabaseType = string(common.MainDatabaseType())
	c.JSON(200, gin.H{
		"success": true,
		"data":    setup,
	})
}

func PostSetup(c *gin.Context) {
	if constant.IsSetupComplete() {
		common.ApiErrorT(c, "The system is already initialized")
		return
	}
	var req SetupRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(req.Username) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(req.Username) > 12 {
		common.ApiErrorT(c, "Username must be {{max}} characters or fewer", map[string]any{"max": 12})
		return
	}
	if req.Password != req.ConfirmPassword {
		common.ApiErrorT(c, "Passwords do not match")
		return
	}
	if err := common.ValidateNewAccountPassword(req.Password); err != nil {
		c.JSON(200, gin.H{"success": false, "message": err.Error()})
		return
	}
	hashedPassword, err := common.HashAccountPassword(req.Password)
	if err != nil {
		common.ApiErrorT(c, "System error: {{error}}", map[string]any{"error": err.Error()})
		return
	}
	if err := model.InitializeSetup(req.Username, hashedPassword, req.SelfUseModeEnabled, req.DemoSiteEnabled); err != nil {
		if errors.Is(err, model.ErrSetupAlreadyInitialized) {
			common.ApiErrorT(c, "The system is already initialized")
		} else {
			_ = c.Error(err)
			common.ApiErrorT(c, "Failed to initialize the system: {{error}}", map[string]any{"error": "database operation failed"})
		}
		return
	}
	common.ApiSuccessT(c, "System initialized successfully", nil)
}
