package dataview

import "strings"

// metaField describes an implicit metadata field that maps to a direct
// column or expression rather than json_extract on frontmatter.
type metaField struct {
	SQL string // SQL expression for SELECT/WHERE
}

// implicitFields maps _-prefixed field names to their SQL representations.
var implicitFields = map[string]metaField{
	"_path": {
		SQL: "file_meta.path",
	},
	"_name": {
		SQL: "replace(file_meta.path, rtrim(file_meta.path, replace(file_meta.path, '/', '')), '')",
	},
	"_folder": {
		SQL: "rtrim(file_meta.path, replace(file_meta.path, '/', ''))",
	},
	"_updated": {
		SQL: "file_meta.updated_at",
	},
	"_ext": {
		SQL: "CASE WHEN instr(replace(file_meta.path, rtrim(file_meta.path, replace(file_meta.path, '/', '')), ''), '.') > 0 THEN substr(replace(file_meta.path, rtrim(file_meta.path, replace(file_meta.path, '/', '')), ''), instr(replace(file_meta.path, rtrim(file_meta.path, replace(file_meta.path, '/', '')), ''), '.')) ELSE '' END",
	},
}

// recordImplicitFieldsFor overrides the page-grain implicit fields for
// record-grain queries. Path-derived fields read the record table's path — the
// driving table there — so they still resolve when a record's page has no
// file_meta row; _updated still comes from the joined page. The three
// record-only fields have no page-grain equivalent.
//
// It is computed per table rather than per query: there are exactly two
// record-grain tables and both maps are built once at init.
func recordImplicitFieldsFor(table string) map[string]metaField {
	if m, ok := recordImplicitFieldsByTable[table]; ok {
		return m
	}
	return recordImplicitFieldsByTable["page_records"]
}

var recordImplicitFieldsByTable = func() map[string]map[string]metaField {
	out := make(map[string]map[string]metaField, len(recordGrainTables))
	for _, table := range recordGrainTables {
		fields := make(map[string]metaField, len(implicitFields)+3)
		for name, mf := range implicitFields {
			fields[name] = metaField{SQL: strings.ReplaceAll(mf.SQL, "file_meta.path", table+".path")}
		}
		fields["_kind"] = metaField{SQL: table + ".kind"}
		fields["_block"] = metaField{SQL: table + ".block_index"}
		fields["_record"] = metaField{SQL: table + ".record_index"}
		out[table] = fields
	}
	return out
}()

// resolveField returns the SQL expression for a field reference.
// Implicit fields (_path, _name, etc.) resolve to direct column refs.
// Regular fields resolve to json_extract(frontmatter, '$.field').
func resolveField(field string) (sql string, isImplicit bool) {
	if mf, ok := implicitFields[field]; ok {
		return mf.SQL, true
	}
	return "", false
}
