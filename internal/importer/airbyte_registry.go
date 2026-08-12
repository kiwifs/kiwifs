package importer

import "strings"

// AirbyteRegistry maps source type names to their Airbyte Docker image.
// Phase 1: only sources we actively route through Airbyte.
var AirbyteRegistry = map[string]string{
	"firebase-rtdb": "airbyte/source-firebase-realtime-database:latest",
	"notion":        "airbyte/source-notion:latest",
	"airtable":      "airbyte/source-airtable:latest",
}

// SyncableSources marks which sources support periodic auto-sync.
// These are live data sources where content changes over time.
var SyncableSources = map[string]bool{
	"firebase-rtdb": true,
	"firestore":     true,
	"postgres":      true,
	"mysql":         true,
	"mongodb":       true,
	"notion":        true,
	"airtable":      true,
}

// IsSyncable returns true if the source supports auto-sync.
func IsSyncable(sourceType string) bool {
	return SyncableSources[strings.ToLower(strings.TrimSpace(sourceType))]
}

// Future sources (uncomment when ready):
// "postgres":      "airbyte/source-postgres:latest",
// "mysql":         "airbyte/source-mysql:latest",
// "mongodb":       "airbyte/source-mongodb-v2:latest",
// "dynamodb":      "airbyte/source-dynamodb:latest",
// "elasticsearch": "airbyte/source-elasticsearch:latest",
// "cockroachdb":   "airbyte/source-cockroachdb:latest",
// "gsheets":       "airbyte/source-google-sheets:latest",
// "confluence":    "airbyte/source-confluence:latest",
// "github":        "airbyte/source-github:latest",
// "jira":          "airbyte/source-jira:latest",
// "slack":         "airbyte/source-slack:latest",
// "linear":        "airbyte/source-linear:latest",
// "s3":            "airbyte/source-s3:latest",
// "gcs":           "airbyte/source-gcs:latest",
// "mssql":         "airbyte/source-mssql:latest",
// "hubspot":       "airbyte/source-hubspot:latest",
// "salesforce":    "airbyte/source-salesforce:latest",
// "stripe":        "airbyte/source-stripe:latest",
// "zendesk":       "airbyte/source-zendesk-support:latest",
// "intercom":      "airbyte/source-intercom:latest",

// BuiltinSources are handled natively by KiwiFS without Docker/Airbyte.
var BuiltinSources = map[string]bool{
	"markdown":  true,
	"obsidian":  true,
	"csv":       true,
	"json":      true,
	"jsonl":     true,
	"excel":     true,
	"yaml":      true,
	"bibtex":    true,
	"croissant": true,
	"sqlite":    true,
	// Native network sources (Go driver, no Airbyte)
	"postgres":  true,
	"mysql":     true,
	"mongodb":   true,
	"firestore": true,
}

// LookupAirbyteImage returns the Docker image for a given source name.
func LookupAirbyteImage(sourceType string) string {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	if img, ok := AirbyteRegistry[sourceType]; ok {
		return img
	}
	if strings.Contains(sourceType, "/") {
		return sourceType
	}
	return ""
}

// IsBuiltinSource returns true if the source is handled natively.
func IsBuiltinSource(sourceType string) bool {
	return BuiltinSources[strings.ToLower(strings.TrimSpace(sourceType))]
}

// AirbyteCloudDefinitionIDs maps source type names to Airbyte Cloud source definition IDs.
// Phase 1: only sources we actively support via Airbyte Cloud.
var AirbyteCloudDefinitionIDs = map[string]string{
	"firebase-rtdb": "acb5f973-a565-441e-992f-4946f3e65662",
	"notion":        "6e00b415-b02e-4160-bf02-58571571a0b8",
	"airtable":      "14c6e7ea-97ed-4f5e-a7b5-25e9a80b8212",
}

// Future definition IDs (uncomment when ready):
// "postgres":      "decd338e-5647-4c0b-adf4-da0e75f5a750",
// "mysql":         "435bb9a5-7887-4809-aa58-28c27df0d7ad",
// "mongodb":       "b2e713cd-cc36-4c0a-b5bd-b47cb8a0561e",
// "dynamodb":      "50401137-8871-4c5a-abb7-1f5fda35545a",
// "elasticsearch": "b01e2488-3796-44f0-a550-e821a6086ca7",
// "mssql":         "3156776f-a553-4f83-b7be-07e1d515092f",
// "cockroachdb":   "9fa5862c-da7c-11eb-8d19-0242ac130003",
// "confluence":    "cf40a7f8-71f8-45ce-a7fa-fca053e4028c",
// "gsheets":       "71042ef5-cdc9-4005-a397-b5ce5c5b646a",
// "hubspot":       "36c891d9-4bd9-43ac-bad2-10e12756272c",
// "salesforce":    "b117307c-14b6-41aa-9422-947e34922962",
// "stripe":        "e094cb9a-26de-4645-8761-65c0c425d1de",
// "github":        "ef69ef6e-aa7f-4af1-a01d-ef775033524e",
// "jira":          "68e63de2-bb83-4c7e-93fa-a8a9051e3993",
// "slack":         "c2281cee-86f9-4a86-bb48-d23286b4c7bd",
// "zendesk":       "79c1aa37-dae3-42ae-b333-d1c105477715",
// "intercom":      "d8313939-3782-41b0-be29-b3ca20d8dd3a",
// "linear":        "fa234e3b-9c5a-4535-b991-f65e2e01e8db",
// "s3":            "69589781-7828-43c5-9f63-8925b1c1ccc2",
// "gcs":           "2a8c41ae-8c23-4be0-a73f-2ab10ca1a820",

// LookupAirbyteDefinitionID returns the Airbyte Cloud source definition ID for a source type.
func LookupAirbyteDefinitionID(sourceType string) string {
	sourceType = strings.ToLower(strings.TrimSpace(sourceType))
	return AirbyteCloudDefinitionIDs[sourceType]
}

// ListAvailableSources returns all available source names grouped by type.
func ListAvailableSources(airbyteAvailable bool) map[string][]string {
	result := map[string][]string{
		"builtin":  make([]string, 0),
		"syncable": make([]string, 0),
	}

	for name := range BuiltinSources {
		result["builtin"] = append(result["builtin"], name)
	}

	for name := range SyncableSources {
		result["syncable"] = append(result["syncable"], name)
	}

	if airbyteAvailable {
		result["airbyte"] = make([]string, 0)
		for name := range AirbyteRegistry {
			result["airbyte"] = append(result["airbyte"], name)
		}
	}

	return result
}
