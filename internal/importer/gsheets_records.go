package importer

import (
	"fmt"
	"strconv"
)

// RecordsFromSheetValues converts Google Sheets Values responses into importer Records.
// This is factored out for unit testing (no network calls required).
func RecordsFromSheetValues(values [][]interface{}, spreadsheetID, sheetName string) []Record {
	if len(values) < 1 {
		return nil
	}

	headers := make([]string, len(values[0]))
	for i, v := range values[0] {
		headers[i] = fmt.Sprintf("%v", v)
	}

	numericCols := detectNumericSheetColumns(values[1:], headers)

	out := make([]Record, 0, len(values)-1)
	for i, row := range values[1:] {
		fields := make(map[string]any, len(headers))
		for j, h := range headers {
			if j >= len(row) {
				continue
			}
			val := fmt.Sprintf("%v", row[j])
			if numericCols[h] {
				if n, err := strconv.ParseFloat(val, 64); err == nil {
					if n == float64(int64(n)) {
						fields[h] = int64(n)
					} else {
						fields[h] = n
					}
					continue
				}
			}
			fields[h] = val
		}

		pk := fmt.Sprintf("%d", i)
		if id, ok := fields["id"]; ok {
			pk = fmt.Sprintf("%v", id)
		}

		out = append(out, Record{
			SourceID:   fmt.Sprintf("gsheets:%s:%d", sheetName, i),
			SourceDSN:  spreadsheetID,
			Table:      sheetName,
			Fields:     fields,
			PrimaryKey: pk,
		})
	}

	return out
}

