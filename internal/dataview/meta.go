package dataview

// metaField describes an implicit metadata field that maps to a direct
// column or expression rather than json_extract on frontmatter.
type metaField struct {
	SQL      string // SQL expression for SELECT/WHERE
	IsColumn bool   // true = direct column on file_meta
}

// implicitFields maps _-prefixed field names to their SQL representations.
var implicitFields = map[string]metaField{
	"_path": {
		SQL:      "file_meta.path",
		IsColumn: true,
	},
	"_name": {
		SQL: "replace(file_meta.path, rtrim(file_meta.path, replace(file_meta.path, '/', '')), '')",
	},
	"_folder": {
		SQL: "rtrim(file_meta.path, replace(file_meta.path, '/', ''))",
	},
	"_updated": {
		SQL:      "file_meta.updated_at",
		IsColumn: true,
	},
	"_ext": {
		SQL: "'.md'",
	},
}

// resolveField returns the SQL expression for a field reference.
// Implicit fields (_path, _name, etc.) resolve to direct column refs.
// Regular fields resolve to json_extract(frontmatter, '$.field').
func resolveField(field string) (sql string, isImplicit bool) {
	if mf, ok := implicitFields[field]; ok {
		return mf.SQL, true
	}
	return "", false
}
