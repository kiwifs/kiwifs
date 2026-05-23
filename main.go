package main

//go:generate swag init

// @title           KiwiFS API
// @version         1.0
// @description     KiwiFS is a content-addressable file system with an API.
// @host            localhost:3333
// @BasePath        /
// @schemes         http https

// @contact.name    KiwiFS Support
// @contact.url     https://github.com/kiwifs/kiwifs

// @license.name    Business Source License 1.1
// @license.url     https://github.com/kiwifs/kiwifs/blob/main/LICENSE

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Type "Bearer " followed by your API key.

import (
	"github.com/kiwifs/kiwifs/cmd"
)

// Version is set via ldflags during build.
var version = "dev"

func init() {
	cmd.Version = version
}

func main() {
	cmd.Execute()
}
