package model

import (
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
)

var ErrSetupAlreadyInitialized = errors.New("setup requires an empty account database")
var setupInitializationMutex sync.Mutex

type Setup struct {
	ID            uint   `json:"id" gorm:"primaryKey"`
	Version       string `json:"version" gorm:"type:varchar(50);not null"`
	InitializedAt int64  `json:"initialized_at" gorm:"type:bigint;not null"`
}

func GetSetup() *Setup {
	var setup Setup
	err := DB.First(&setup).Error
	if err != nil {
		return nil
	}
	return &setup
}

// InitializeSetup creates the first administrator and operation settings as
// one commit. Beacon starts with zero quota; credits belong in the ledger.
// The fixed setup ID serializes competing initializers across processes too.
// Existing users are never reset or adopted by this anonymous first-run API.
func InitializeSetup(username, passwordHash string, selfUse, demo bool) error {
	setupInitializationMutex.Lock()
	defer setupInitializationMutex.Unlock()
	values := []Option{
		{Key: "SelfUseModeEnabled", Value: strconv.FormatBool(selfUse)},
		{Key: "DemoSiteEnabled", Value: strconv.FormatBool(demo)},
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Setup{}).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrSetupAlreadyInitialized
		}
		if err := tx.Unscoped().Model(&User{}).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrSetupAlreadyInitialized
		}
		if err := tx.Create(&Setup{ID: 1, Version: common.Version, InitializedAt: time.Now().Unix()}).Error; err != nil {
			return err
		}
		root := User{Username: username, Password: passwordHash, Role: common.RoleRootUser,
			Status: common.UserStatusEnabled, DisplayName: "Root User", Quota: 0}
		if err := tx.Create(&root).Error; err != nil {
			return err
		}
		for _, option := range values {
			if err := tx.Save(&option).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	// Publish process state only after all durable setup writes committed.
	for _, option := range values {
		if err := updateOptionMap(option.Key, option.Value); err != nil {
			return err
		}
	}
	constant.SetSetupComplete(true)
	return nil
}
